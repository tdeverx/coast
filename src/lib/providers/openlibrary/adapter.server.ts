import * as v from 'valibot';
import type { ProviderTransport } from '../contracts';
import { AppError } from '../../server/security/errors';
import { ProviderHttpError } from '../../server/security/provider-fetch';
import { rankSearch, searchFallback, searchScore } from '../../search';
import { openLibraryIdSchema, openLibraryKind, comicVineIdSchema, READING_PROVIDER_PAGE_LIMIT, readingPlainText, type ReadingMetadata, type ReadingPage } from '../../reading/model';

export const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
export const OPEN_LIBRARY_PAGE_SIZE = 20;
const workKey = v.pipe(v.string(), v.regex(/^(?:\/works\/)?OL[1-9][0-9]{0,19}W$/));
const editionKey = v.pipe(v.string(), v.regex(/^(?:\/books\/)?OL[1-9][0-9]{0,19}M$/));
const label = v.pipe(v.string(), v.maxLength(1000));
const labels = v.pipe(v.array(label), v.maxLength(5000));
const year = v.pipe(v.number(), v.integer(), v.minValue(-9999), v.maxValue(9999));
const coverId = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER));
const querySchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(250), v.check(value => !/[\u0000-\u001f]/.test(value)));
const pageSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(READING_PROVIDER_PAGE_LIMIT));
const documentSchema = v.object({
  key: workKey,
  title: v.pipe(label, v.minLength(1)),
  author_name: v.optional(labels, []),
  subject: v.optional(labels, []),
  first_publish_year: v.optional(year),
  cover_i: v.optional(coverId),
  edition_key: v.optional(v.pipe(v.array(editionKey), v.maxLength(10000))),
});
const total = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER));
const searchSchema = v.object({
  docs: v.pipe(v.array(documentSchema), v.maxLength(OPEN_LIBRARY_PAGE_SIZE)),
  numFound: v.optional(total),
  num_found: v.optional(total),
});
const description = v.union([
  v.pipe(v.string(), v.maxLength(100000)),
  v.object({ value: v.pipe(v.string(), v.maxLength(100000)) }),
]);
const workSchema = v.object({
  key: workKey,
  title: v.pipe(label, v.minLength(1)),
  description: v.optional(description),
  subjects: v.optional(labels, []),
  covers: v.optional(v.pipe(v.array(v.pipe(v.number(), v.integer())), v.maxLength(1000)), []),
  first_publish_date: v.optional(label),
  links: v.optional(v.pipe(v.array(v.object({ title: v.optional(label), url: v.pipe(v.string(), v.maxLength(2000)) })), v.maxLength(100)), []),
});
const fields = 'key,title,author_name,subject,first_publish_year,cover_i,edition_key';

const canonicalWorkId = (key: string) => key.replace(/^\/works\//, '');
function cleanLabels(values: string[], limit = 100) {
  return [...new Set(values.map(value => readingPlainText(value).slice(0, 500)).filter(Boolean))].slice(0, limit);
}
function mapDocument(document: v.InferOutput<typeof documentSchema>): ReadingMetadata {
  const externalId = canonicalWorkId(document.key);
  const title = readingPlainText(document.title).slice(0, 500);
  if (!title) throw new AppError(502, 'Open Library returned an empty book title.', 'openlibrary_unavailable');
  return {
    provider: 'openlibrary', externalId, kind: openLibraryKind(document.subject), title,
    sourceUrl: `${OPEN_LIBRARY_BASE_URL}/works/${externalId}`,
    authors: cleanLabels(document.author_name, 50), subjects: cleanLabels(document.subject),
    publishedYear: document.first_publish_year && document.first_publish_year > 0 ? document.first_publish_year : undefined,
    coverUrl: document.cover_i ? `https://covers.openlibrary.org/b/id/${document.cover_i}-L.jpg?default=false` : undefined,
    // Edition references do not replace the canonical work identity or its progress.
    editionIds: document.edition_key ? [...new Set(document.edition_key.map(key => key.replace(/^\/books\//, '')))].slice(0, 100) : undefined,
  };
}
function providerError(error: unknown): never {
  if (error instanceof ProviderHttpError || error instanceof AppError) throw error;
  throw new AppError(502, 'Open Library could not return valid book metadata. Try again later.', 'openlibrary_unavailable');
}

export class OpenLibraryAdapter {
  constructor(private request: ProviderTransport, private userAgent = 'Coast (+https://github.com/tdeverx/coast)') {}
  private async searchRequest(query: string, page: number, limit = OPEN_LIBRARY_PAGE_SIZE, sort?: string) {
    const params = new URLSearchParams({ q: query, page: String(page), limit: String(limit), fields });
    if (sort) params.set('sort', sort);
    return v.parse(searchSchema, await this.request(`/search.json?${params}`, {
      headers: { accept: 'application/json', 'User-Agent': this.userAgent },
    }));
  }
  async search(query: string, page = 1): Promise<ReadingPage> {
    const search = v.parse(querySchema, query);
    v.parse(pageSchema, page);
    try {
      let result = await this.searchRequest(search, page);
      const fallback = searchFallback(search);
      let broadened = false;
      if (page === 1 && !result.docs.length && fallback) {
        result = await this.searchRequest(fallback === search.toLowerCase() ? fallback : `${fallback}*`, 1);
        broadened = true;
      }
      const count = result.numFound ?? result.num_found;
      if (count === undefined) throw new AppError(502, 'Open Library returned invalid search pagination.', 'openlibrary_unavailable');
      const items = rankSearch(result.docs.map(mapDocument), search).filter(item => !broadened || searchScore(search, item) >= 550);
      return { items, total: broadened ? items.length : count, page, nextPage: !broadened && page < READING_PROVIDER_PAGE_LIMIT && result.docs.length > 0 && page * OPEN_LIBRARY_PAGE_SIZE < count ? page + 1 : null };
    } catch (error) { providerError(error); }
  }
  /** Official search sorts: current attention, or first publication year (not edition additions). */
  async discover(section: 'trending' | 'recent', page = 1): Promise<ReadingPage> {
    v.parse(v.picklist(['trending', 'recent']), section);
    v.parse(pageSchema, page);
    try {
      const query = section === 'trending' ? 'trending_z_score:[1 TO *]' : `first_publish_year:[1 TO ${new Date().getUTCFullYear()}]`;
      const result = await this.searchRequest(query, page, OPEN_LIBRARY_PAGE_SIZE, section === 'trending' ? 'trending' : 'new');
      const count = result.numFound ?? result.num_found;
      if (count === undefined) throw new AppError(502, 'Open Library returned invalid discovery pagination.', 'openlibrary_unavailable');
      return { items: result.docs.map(mapDocument), total: count, page, nextPage: page < READING_PROVIDER_PAGE_LIMIT && result.docs.length > 0 && page * OPEN_LIBRARY_PAGE_SIZE < count ? page + 1 : null };
    } catch (error) { providerError(error); }
  }
  async workForEdition(id:string):Promise<string|null> {
    const identifier=v.parse(v.pipe(v.string(),v.regex(/^(?:OL[1-9][0-9]{0,19}M|[0-9]{9}[0-9X]|[0-9]{13})$/)),id);
    try {
      const result=v.parse(v.object({key:editionKey,works:v.optional(v.pipe(v.array(v.object({key:workKey})),v.maxLength(10)),[])}),await this.request(`${identifier.startsWith('OL')?'/books/':'/isbn/'}${identifier}.json`,{headers:{accept:'application/json','User-Agent':this.userAgent}}));
      if(identifier.startsWith('OL')&&result.key.replace(/^\/books\//,'')!==identifier)throw new AppError(502,'Open Library returned a different edition identity.','openlibrary_unavailable');
      const ids=[...new Set(result.works.map(work=>canonicalWorkId(work.key)))];return ids.length===1?ids[0]:null;
    }catch(cause){if(cause instanceof ProviderHttpError&&cause.status===404)return null;providerError(cause);}
  }
  async details(id: string): Promise<ReadingMetadata> {
    v.parse(openLibraryIdSchema, id);
    try {
      const work = v.parse(workSchema, await this.request(`/works/${id}.json`, {
        headers: { accept: 'application/json', 'User-Agent': this.userAgent },
      }));
      if (canonicalWorkId(work.key) !== id) throw new AppError(502, 'Open Library returned a different work identity.', 'openlibrary_unavailable');
      // Work JSON contains author references. One exact indexed lookup supplies
      // names and edition references without requesting every author or edition.
      const result = await this.searchRequest(`key:/works/${id}`, 1, 1);
      const indexed = result.docs.find(document => canonicalWorkId(document.key) === id);
      const metadata = mapDocument(indexed ?? { key: work.key, title: work.title, author_name: [], subject: [] });
      const overview = work.description ? readingPlainText(typeof work.description === 'string' ? work.description : work.description.value).slice(0, 5000) : undefined;
      const cover = work.covers.find(value => Number.isSafeInteger(value) && value > 0);
      const title = readingPlainText(work.title).slice(0, 500);
      if (!title) throw new AppError(502, 'Open Library returned an empty book title.', 'openlibrary_unavailable');
      const subjects = work.subjects.length ? cleanLabels(work.subjects) : metadata.subjects;
      const identities = work.links.flatMap(link => {
        // Only a dedicated metadata link to an issue is a cross-reference.
        // Volume/series links, arbitrary description links and editions cannot merge works.
        if (!/^comic\s*vine$/i.test(link.title ?? '') || openLibraryKind(subjects) !== 'comic') return [];
        try {
          const url = new URL(link.url);
          const id = url.pathname.match(/\/(4000-[1-9][0-9]*)\/?$/)?.[1];
          return url.origin === 'https://comicvine.gamespot.com' && !url.username && !url.password && !url.search && !url.hash && id && v.safeParse(comicVineIdSchema, id).success
            ? [{ provider: 'comic-vine' as const, externalId: id }] : [];
        } catch { return []; }
      });
      return {
        ...metadata, title, overview: overview || undefined,
        subjects, kind: openLibraryKind(subjects),
        ...(identities.length === 1 ? { identities } : {}),
        coverUrl: cover ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg?default=false` : metadata.coverUrl,
      };
    } catch (error) { providerError(error); }
  }
  async verify() { await this.search('books', 1); }
}
