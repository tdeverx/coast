import { getFeatureConfig } from '#lib/server/features.js';
import {getDb} from '#lib/server/db/index.js';
import {sql} from 'drizzle-orm';
import {presentationSearch} from '#lib/catalogue/overrides/presentation.server.js';
import {workAssessments,workCards} from '#lib/collection/query.server.js';
import { rankSearch, searchFallback, searchScore } from '#lib/search.js';
import { musicRow } from './media-rows';
import { listGames } from '#lib/core/games/service.server.js';
import { listProviders } from '#lib/providers/instances.server.js';
import { searchIgdb } from '#lib/providers/igdb/service.server.js';
import { gameCard } from '#lib/games/presentation.js';
import { providerGameCards } from '#lib/games/presentation.server.js';
import * as v from 'valibot';
import { AppError } from '#lib/server/security/errors.js';
import { ProviderHttpError } from '#lib/server/security/provider-fetch.js';
import { providerApiError } from '#lib/server/security/provider-api-error.js';
import { pageNumberSchema } from '#lib/server/queries/pagination.js';
import { readingProviderConfigured, searchReading } from '#lib/providers/reading.server.js';
import { readingCatalogue, readingCards, readingProviderCards } from '#lib/reading/query.server.js';
import { READING_PROVIDER_PAGE_LIMIT, type ReadingKind, type ReadingMetadata } from '#lib/reading/model.js';
import type { MediaCardPresentation } from '#lib/ui/types.js';

export type ReadingSearchContent = {
  items: MediaCardPresentation[];
  failure: string;
  notice: string;
  truncated: boolean;
  page: number;
  pages: number;
  total: number;
};
const inputSchema = v.object({
  query: v.pipe(v.string(), v.trim(), v.maxLength(200)),
  kind: v.optional(v.picklist(['all', 'book', 'comic']), 'all'),
  page: v.optional(v.pipe(pageNumberSchema, v.maxValue(READING_PROVIDER_PAGE_LIMIT)), 1),
});

/** Local results can render while the route streams its provider search. */
export async function readingSearchInitial(userId: string, raw: unknown): Promise<ReadingSearchContent> {
  const input = v.parse(inputSchema, raw);
  await searchKinds(userId, input.kind);
  const empty = { items: [], failure: '', notice: '', truncated: false, page: input.page, pages: 1, total: 0 };
  if (!input.query) return empty;
  // Local pages remain bounded and appear first. Do not repeat a clamped last page
  // while providers still have more results.
  const local = await readingCatalogue(userId, { kind: input.kind, search: input.query, page: input.page, personal: false });
  const localCards = input.page <= local.pages ? await readingCards(userId, userId, local.items) : [];
  const pages = Math.min(READING_PROVIDER_PAGE_LIMIT, local.pages);
  return { ...empty, items: localCards, total: local.total, pages, truncated: input.page < pages };
}

async function searchKinds(userId: string, kind: 'all' | ReadingKind) {
  const config = await getFeatureConfig(userId);
  const kinds = (['book', 'comic'] as const).filter(value =>
    (kind === 'all' || kind === value) && (value === 'book' ? config.experimentalBooks : config.experimentalComics));
  if (!kinds.length) throw new AppError(404, 'This reading type is unavailable.', 'experimental_disabled');
  return kinds;
}

/** One search combines local metadata and enabled providers; reads never import titles.
 * Routes pass their already-rendered local page to avoid reading it a second time. */
export async function readingSearch(userId: string, raw: unknown, initial?: ReadingSearchContent): Promise<ReadingSearchContent> {
  const input = v.parse(inputSchema, raw);
  const kinds = await searchKinds(userId, input.kind);
  const local = initial ?? await readingSearchInitial(userId, input);
  if (!input.query) return local;
  const empty = { items: [] as ReadingMetadata[], failure: '', notice: '', truncated: false, page: input.page, pages: 1, total: 0 };
  // Open Library also supplies graphic novels/comics; fetch it once, even when Books is disabled.
  const providerKinds: ReadingKind[] = ['book', ...(kinds.includes('comic') ? ['comic' as const] : [])];
  const results = await Promise.all(providerKinds.map(async (kind: ReadingKind) => {
    const label = kind === 'book' ? 'Open Library' : 'Comic Vine';
    try {
      if (!await readingProviderConfigured(kind)) return { ...empty, notice: 'An administrator can connect Comic Vine in Integrations to search comics.' };
      const result = await searchReading(kind, input.query, input.page);
      const pageSize = kind === 'book' ? 20 : 10;
      return {
        ...empty,
        items: result.items,
        total: result.total,
        pages: Math.max(input.page, Math.min(READING_PROVIDER_PAGE_LIMIT, Math.ceil(result.total / pageSize))),
        truncated: result.nextPage !== null,
      };
    } catch (cause) {
      return { ...empty, failure: cause instanceof AppError ? cause.message : cause instanceof ProviderHttpError ? providerApiError(cause).body.error : `${label} search could not be loaded. Please try again.` };
    }
  }));
  const cards = await readingProviderCards(userId, results.flatMap(result => result.items).filter(item => kinds.includes(item.kind)));
  return {
    ...empty,
    items: rankSearch([...new Map([...local.items, ...cards].map(item => [item.id, item])).values()], input.query),
    total: results.reduce((total, result) => total + result.total, local.total),
    pages: Math.max(local.pages, ...results.map(result => result.pages)),
    truncated: input.page < READING_PROVIDER_PAGE_LIMIT && (local.truncated || results.some(result => result.truncated)),
    failure: results.map(result => result.failure).filter(Boolean).join(' '),
    notice: results.map(result => result.notice).filter(Boolean).join(' '),
  };
}

type SearchPresentations = {
  items: MediaCardPresentation[];
  discover: MediaCardPresentation[];
  failure: string;
  truncated: boolean;
};
export async function searchPresentations(
  userId: string,
  surface: string,
  query: string,
  kind: string,
  signal?:AbortSignal
): Promise<SearchPresentations> {
  signal?.throwIfAborted();
  if (!query || surface === 'watch')
    return { items: [], discover: [], failure: '', truncated: false };
  if (surface === 'listen') {
    const aliases=presentationSearch(userId,sql`m.id`,query);
    const rows=await getDb().execute<{id:string}>(sql`select m.id from music_works m where (${kind}='all' or m.kind=${kind}) and ${aliases.matches()} order by ${aliases.rank} desc,m.id limit 60`);
    const ids=Array.from(rows).map(row=>row.id);
    const [cards,assessments]=await Promise.all([workCards(userId,userId,ids),workAssessments(userId,userId,ids)]);
    const availability=new Map(assessments.map(row=>[row.id,row.availability]));
    const personal=cards.map(item=>({...item,available:['available','partial'].includes(availability.get(('workId' in item?item.workId:undefined)??item.id)??'unknown')}));
    let result = await musicRow(userId, query, kind as 'all' | 'album' | 'artist' | 'track', 100,false,signal);
    const fallback = searchFallback(query);
    if (!result.items.length && !result.failure && fallback) {
      const broader = await musicRow(userId, fallback, kind as 'all' | 'album' | 'artist' | 'track', 100,false,signal);
      result = { ...broader, items: broader.items.filter(item => searchScore(query, item) >= 550) };
    }
    return { ...result, items: rankSearch([...new Map([...personal,...result.items].map(item=>[('workId' in item?item.workId:undefined)??item.id,item])).values()] as MediaCardPresentation[], query), discover: [], truncated: rows.length >= 60 || result.items.length >= 100 };
  }
  const local = await listGames(query,1,{userId,personal:false});
  const sources = (await listProviders(userId)).filter(
    (source) => source.provider === 'igdb' && source.enabled && source.configured
  );
  const result = await Promise.all(
    sources.map(async (source) => {
      try {
        let response = await searchIgdb(source.id, query);
        const fallback = searchFallback(query);
        if (!response.items.length && fallback) {
          const broader = await searchIgdb(source.id, fallback);
          response = { ...broader, items: broader.items.filter(item => searchScore(query, item) >= 550) };
        }
        return {
          items: await providerGameCards(userId,response.items.map(item=>({...item,instanceId:source.id}))),
          failure: '',
          truncated: response.hasMore,
        };
      } catch {
        return {
          items: [],
          failure: `Game discovery from ${source.name} is temporarily unavailable.`,
          truncated: false,
        };
      }
    })
  );
  const localCards=local.items.map(item=>gameCard(item));
  const localIds=new Set(localCards.map(item=>item.id));
  return {
    items: localCards,
    discover: rankSearch([...new Map(result.flatMap(row=>row.items).filter(item=>!localIds.has(item.id)).map(item=>[item.id,item])).values()], query),
    failure: result
      .map((row) => row.failure)
      .filter(Boolean)
      .join(' '),
    truncated: local.total > local.items.length || result.some((row) => row.truncated),
  };
}
