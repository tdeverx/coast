import { rankSearch, searchFallback, searchScore } from '$lib/search';
import { musicRow } from './media-rows';
import { listGames } from '$lib/core/games/service.server';
import { listProviders } from '$lib/providers/instances.server';
import { searchIgdb } from '$lib/providers/igdb/service.server';
import { gameCard } from '$lib/games/presentation';
import * as v from 'valibot';
import { getConfig } from '$lib/server/config';
import { AppError } from '$lib/server/security/errors';
import { ProviderHttpError } from '$lib/server/security/provider-fetch';
import { providerApiError } from '$lib/server/security/provider-api-error';
import { pageNumberSchema } from '$lib/server/queries/pagination';
import { readingProviderConfigured, searchReading } from '$lib/providers/reading.server';
import { readingCatalogue, readingCards, readingProviderCards } from '$lib/reading/query.server';
import { READING_PROVIDER_PAGE_LIMIT, type ReadingKind, type ReadingMetadata } from '$lib/reading/model';
import type { MediaCardPresentation } from '$lib/ui/types';

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
  await searchKinds(input.kind);
  const empty = { items: [], failure: '', notice: '', truncated: false, page: input.page, pages: 1, total: 0 };
  if (!input.query) return empty;
  // Local pages remain bounded and appear first. Do not repeat a clamped last page
  // while providers still have more results.
  const local = await readingCatalogue(userId, { kind: input.kind, search: input.query, page: input.page, personal: false });
  const localCards = input.page <= local.pages ? await readingCards(userId, userId, local.items) : [];
  const pages = Math.min(READING_PROVIDER_PAGE_LIMIT, local.pages);
  return { ...empty, items: localCards, total: local.total, pages, truncated: input.page < pages };
}

async function searchKinds(kind: 'all' | ReadingKind) {
  const config = await getConfig();
  const kinds = (['book', 'comic'] as const).filter(value =>
    (kind === 'all' || kind === value) && (value === 'book' ? config.experimentalBooks : config.experimentalComics));
  if (!kinds.length) throw new AppError(404, 'This reading type is unavailable.', 'experimental_disabled');
  return kinds;
}

/** One search combines local metadata and enabled providers; reads never import titles.
 * Routes pass their already-rendered local page to avoid reading it a second time. */
export async function readingSearch(userId: string, raw: unknown, initial?: ReadingSearchContent): Promise<ReadingSearchContent> {
  const input = v.parse(inputSchema, raw);
  const kinds = await searchKinds(input.kind);
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
  kind: string
): Promise<SearchPresentations> {
  if (!query || surface === 'watch')
    return { items: [], discover: [], failure: '', truncated: false };
  if (surface === 'listen') {
    let result = await musicRow(userId, query, kind as 'all' | 'album' | 'artist' | 'track', 100);
    const fallback = searchFallback(query);
    if (!result.items.length && !result.failure && fallback) {
      const broader = await musicRow(userId, fallback, kind as 'all' | 'album' | 'artist' | 'track', 100);
      result = { ...broader, items: broader.items.filter(item => searchScore(query, item) >= 550) };
    }
    return { ...result, items: rankSearch(result.items, query), discover: [], truncated: result.items.length >= 100 };
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
          items: response.items.map((item) =>
            gameCard(
              { ...item, id: item.externalId },
              `/games/igdb/${source.id}/${item.externalId}`
            )
          ),
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
  return {
    items: local.items.map((item) => gameCard(item)),
    discover: rankSearch(result.flatMap((row) => row.items), query),
    failure: result
      .map((row) => row.failure)
      .filter(Boolean)
      .join(' '),
    truncated: local.total > local.items.length || result.some((row) => row.truncated),
  };
}
