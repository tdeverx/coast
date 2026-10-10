import { error } from '@sveltejs/kit';
import { AppError } from '$lib/server/security/errors';
import * as v from 'valibot';
import { listGames } from '$lib/core/games/service.server';
import { searchIgdb } from '$lib/providers/igdb/service.server';
import { listProviders } from '$lib/providers/instances.server';
import { gameCard } from '$lib/games/presentation';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({locals, url, depends}) => {
  depends('coast:tracking');

  depends('coast:games');
  if (!locals.user) error(401, 'Sign in to browse games.');
  const parsed = v.safeParse(
    v.object({
      personal: v.boolean(),
      view: v.picklist(['library', 'igdb']),
      scope: v.picklist(['all', 'available']),
      state: v.picklist(['all', 'planned', 'in-progress', 'completed', 'paused', 'dropped']),
      search: v.pipe(v.string(), v.maxLength(250)),
      page: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
    }),
    {
      personal: url.searchParams.get('personal') === 'true',
      view: url.searchParams.get('view') ?? 'library',
      scope: url.searchParams.get('scope') ?? 'all',
      state: url.searchParams.get('state') ?? 'all',
      search: (url.searchParams.get('search') ?? '').trim(),
      page: Number(url.searchParams.get('page') ?? 1),
    }
  );
  if (!parsed.success) error(400, 'Check the games filters.');
  const filters = parsed.output;
  const sources = (await listProviders(locals.user.id)).filter(
    (item) => item.provider === 'igdb' && item.enabled && item.configured
  );
  const instanceId = url.searchParams.get('instance') ?? sources[0]?.id ?? '';
  if (filters.view === 'igdb' && instanceId && !sources.some((source) => source.id === instanceId))
    error(404, 'This IGDB integration is unavailable.');
  if (filters.view === 'library') {
    const result = await listGames(
      filters.search,
      filters.page,
      { userId: locals.user.id, personal: filters.personal, availableOnly: filters.scope === 'available', ...(filters.state !== 'all' ? { status: filters.state } : {}) }
    );
    return {
      ...result,
      items: result.items.map((item) => gameCard(item)),
      filters,
      sources,
      instanceId,
      failure: '',
    };
  }
  let failure = '';
  let items: ReturnType<typeof gameCard>[] = [],
    hasMore = false;
  if (instanceId && filters.search) {
    try {
      const result = await searchIgdb(instanceId, filters.search, filters.page);
      items = result.items.map((item) =>
        gameCard({ ...item, id: item.externalId }, `/games/igdb/${instanceId}/${item.externalId}`)
      );
      hasMore = result.hasMore;
    } catch (cause) {
      failure = cause instanceof AppError
        ? cause.message
        : 'IGDB search could not be loaded. Please try again.';
    }
  }
  return {
    items,
    total: items.length,
    page: filters.page,
    pages: filters.page + (hasMore && filters.page < 1000 ? 1 : 0),
    filters,
    sources,
    instanceId,
    failure,
  };
};
