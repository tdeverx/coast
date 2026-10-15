import * as v from 'valibot';
import type { ProviderTransport } from '../contracts';
import { AppError } from '../../server/security/errors';
import { ProviderHttpError } from '../../server/security/provider-fetch';
import { comicVineIdSchema, READING_PROVIDER_PAGE_LIMIT, readingPlainText, type ReadingMetadata, type ReadingPage } from '../../reading/model';
import { rankSearch, searchScore, searchFallback } from '../../search';

export const COMIC_VINE_BASE_URL = 'https://comicvine.gamespot.com';
// The official search resource caps its page size at ten, independently of lists.
export const COMIC_VINE_PAGE_SIZE = 10;
const apiKey = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(250), v.regex(/^[A-Za-z0-9_-]+$/));
export const comicVineCredentialsSchema = v.object({ apiKey });
const idSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER));
const label = v.pipe(v.string(), v.maxLength(1000));
const nullableLabel = v.optional(v.nullable(label));
const description = v.optional(v.nullable(v.pipe(v.string(), v.maxLength(100000))));
const issueSchema = v.object({
  id: idSchema,
  site_detail_url: v.pipe(v.string(), v.maxLength(2000)),
  resource_type: v.optional(v.literal('issue')),
  name: nullableLabel,
  issue_number: nullableLabel,
  deck: description,
  description,
  cover_date: nullableLabel,
  store_date: nullableLabel,
  image: v.optional(v.nullable(v.object({
    small_url: nullableLabel, medium_url: nullableLabel, super_url: nullableLabel,
  }))),
  volume: v.optional(v.nullable(v.object({ id: idSchema, name: label }))),
  person_credits: v.optional(v.nullable(v.pipe(v.array(v.object({ name: label, role: nullableLabel })), v.maxLength(1000)))),
});
const envelope = v.object({ status_code: v.pipe(v.number(), v.integer()) });
const total = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER));
const searchSchema = v.object({
  status_code: v.literal(1), number_of_total_results: total,
  results: v.pipe(v.array(issueSchema), v.maxLength(COMIC_VINE_PAGE_SIZE)),
});
const detailSchema = v.object({ status_code: v.literal(1), results: issueSchema });
const volumesSchema = v.object({ status_code: v.literal(1), results: v.pipe(v.array(v.object({
  id: idSchema, name: label, resource_type: v.optional(v.literal('volume')),
})), v.maxLength(COMIC_VINE_PAGE_SIZE)) });
const querySchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(250), v.check(value => !/[\u0000-\u001f]/.test(value)));
const pageSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(READING_PROVIDER_PAGE_LIMIT));
const fields = 'id,name,issue_number,deck,description,cover_date,store_date,image,volume,person_credits,resource_type,site_detail_url';

function coverUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'comicvine.gamespot.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/a\/uploads\/[A-Za-z0-9_./-]+$/.test(url.pathname)
      ? url.href : undefined;
  } catch { return undefined; }
}
function mapIssue(issue: v.InferOutput<typeof issueSchema>): ReadingMetadata {
  const externalId = `4000-${issue.id}`;
  let sourceUrl: string;
  try {
    const source = new URL(issue.site_detail_url);
    if (source.origin !== COMIC_VINE_BASE_URL || source.username || source.password || source.search || source.hash || !source.pathname.endsWith(`/${externalId}/`)) throw new Error('Invalid source link');
    sourceUrl = source.href;
  } catch {
    throw new AppError(502, 'Comic Vine returned an invalid issue source link.', 'comic_vine_unavailable');
  }
  const seriesTitle = issue.volume ? readingPlainText(issue.volume.name).slice(0, 500) : undefined;
  const issueNumber = issue.issue_number ? readingPlainText(issue.issue_number).slice(0, 100) : undefined;
  const title = (readingPlainText(issue.name ?? '') || `${seriesTitle || 'Comic'}${issueNumber ? ` #${issueNumber}` : ''}`).slice(0, 500);
  const date = issue.store_date || issue.cover_date;
  const publishedYear = date?.match(/^([0-9]{4})(?:-|$)/)?.[1];
  const summary = readingPlainText(issue.description || issue.deck || '').slice(0, 5000);
  const authors = [...new Set((issue.person_credits ?? []).filter(person => !person.role || /\b(writer|script|story)\b/i.test(person.role)).map(person => readingPlainText(person.name).slice(0, 500)).filter(Boolean))].slice(0, 50);
  return {
    provider: 'comic-vine', externalId, kind: 'comic', title,
    sourceUrl,
    overview: summary || undefined,
    coverUrl: coverUrl(issue.image?.super_url) ?? coverUrl(issue.image?.medium_url) ?? coverUrl(issue.image?.small_url),
    ...(issue.store_date&&v.safeParse(v.pipe(v.string(),v.isoDate()),issue.store_date).success?{releaseDate:issue.store_date}:{}),
    authors, subjects: [], publishedYear: publishedYear && Number(publishedYear) > 0 ? Number(publishedYear) : undefined,
    seriesTitle: seriesTitle || undefined, issueNumber: issueNumber || undefined,
  };
}
function providerError(error: unknown): never {
  if (error instanceof ProviderHttpError || error instanceof AppError) throw error;
  throw new AppError(502, 'Comic Vine could not return valid comic metadata. Try again later.', 'comic_vine_unavailable');
}

export class ComicVineAdapter {
  private apiKey: string;
  constructor(key: string, private request: ProviderTransport, private userAgent = 'Coast experimental comic discovery') {
    this.apiKey = v.parse(apiKey, key);
  }
  private async read(path: string, params: URLSearchParams, requestedFields = fields) {
    params.set('api_key', this.apiKey);
    params.set('format', 'json');
    params.set('field_list', requestedFields);
    const raw = await this.request(`${path}?${params}`, { headers: { accept: 'application/json', 'User-Agent': this.userAgent } });
    const response = v.parse(envelope, raw);
    if (response.status_code === 100) throw new AppError(502, 'Comic Vine rejected its API key.', 'comic_vine_authentication');
    if (response.status_code === 101) throw new AppError(404, 'Comic Vine issue not found.', 'not_found');
    if (response.status_code !== 1) throw new AppError(502, 'Comic Vine could not complete this metadata request.', 'comic_vine_unavailable');
    return raw;
  }
  async search(query: string, page = 1): Promise<ReadingPage> {
    const search = v.parse(querySchema, query);
    v.parse(pageSchema, page);
    try {
      const params = new URLSearchParams({ query: search, resources: 'issue', limit: String(COMIC_VINE_PAGE_SIZE), offset: String((page - 1) * COMIC_VINE_PAGE_SIZE) });
      // Preserve ordinary issue paging. Each bounded page also resolves series names,
      // so unnamed/story-named issues can be found without one request per card.
      const result = v.parse(searchSchema, await this.read('/api/search/', params));
      let seriesIssues: v.InferOutput<typeof issueSchema>[] = [];
      let seriesTotal = 0;
      {
        try {
          let volumes = v.parse(volumesSchema, await this.read('/api/search/', new URLSearchParams({
            query: search, resources: 'volume', limit: String(COMIC_VINE_PAGE_SIZE), offset: '0',
          }), 'id,name,resource_type'));
          const fallback = searchFallback(search);
          if (page === 1 && !result.results.length && !volumes.results.length && fallback)
            volumes = v.parse(volumesSchema, await this.read('/api/search/', new URLSearchParams({ query: fallback, resources: 'volume', limit: String(COMIC_VINE_PAGE_SIZE), offset: '0' }), 'id,name,resource_type'));
          const selected = rankSearch(volumes.results.map(volume => ({ ...volume, title: volume.name })), search)
            .filter(volume => searchScore(search, volume) >= 550).slice(0, 2);
          if (selected.length) {
            const issues = v.parse(searchSchema, await this.read('/api/issues/', new URLSearchParams({
              filter: `volume:${selected.map(volume => volume.id).join('|')}`, limit: String(COMIC_VINE_PAGE_SIZE), offset: String((page - 1) * COMIC_VINE_PAGE_SIZE), sort: 'store_date:asc',
            })));
            const ids = new Set(selected.map(volume => volume.id));
            // Never accept unrelated issues if the upstream ignored our filter.
            if (issues.results.some(issue => !issue.volume || !ids.has(issue.volume.id))) throw new Error('Unexpected comic series.');
            seriesIssues = issues.results;
            seriesTotal = issues.number_of_total_results;
          }
        } catch (cause) {
          // Optional series enrichment cannot discard successful issue results.
          // Do not retry or bypass transport cooldowns on an upstream failure.
          if (!result.results.length) throw cause;
        }
      }
      const items = rankSearch([...new Map([...result.results, ...seriesIssues].map(issue => [issue.id, mapIssue(issue)])).values()], search);
      return { items, total: Math.max(result.number_of_total_results, seriesTotal, items.length), page, nextPage: page < READING_PROVIDER_PAGE_LIMIT && page * COMIC_VINE_PAGE_SIZE < Math.max(result.number_of_total_results, seriesTotal) && items.length > 0 ? page + 1 : null };
    } catch (error) { providerError(error); }
  }
  /** Comic Vine lists expose release dates, not a popularity ranking. */
  async discover(section: 'trending' | 'recent', page = 1): Promise<ReadingPage> {
    v.parse(v.picklist(['trending', 'recent']), section);
    v.parse(pageSchema, page);
    if (section === 'trending') throw new AppError(409, 'Comic Vine does not provide a trending feed. Browse Recently released for new comics.', 'discovery_unsupported');
    try {
      const today = new Date().toISOString().slice(0, 10);
      const params = new URLSearchParams({ sort: 'store_date:desc', filter: `store_date:1900-01-01|${today}`, limit: String(COMIC_VINE_PAGE_SIZE), offset: String((page - 1) * COMIC_VINE_PAGE_SIZE) });
      const result = v.parse(searchSchema, await this.read('/api/issues/', params));
      return { items: result.results.map(mapIssue), total: result.number_of_total_results, page, nextPage: page < READING_PROVIDER_PAGE_LIMIT && result.results.length > 0 && page * COMIC_VINE_PAGE_SIZE < result.number_of_total_results ? page + 1 : null };
    } catch (error) { providerError(error); }
  }
  async details(id: string): Promise<ReadingMetadata> {
    v.parse(comicVineIdSchema, id);
    try {
      const result = v.parse(detailSchema, await this.read(`/api/issue/${id}/`, new URLSearchParams()));
      if (`4000-${result.results.id}` !== id) throw new AppError(502, 'Comic Vine returned a different issue identity.', 'comic_vine_unavailable');
      return mapIssue(result.results);
    } catch (error) { providerError(error); }
  }
  async verify() { await this.search('comics', 1); }
}
