import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { gameDetails, playthroughDetails } from '$lib/core/games/service.server';
import { listProviders } from '$lib/providers/instances.server';
import { DomainError } from '$lib/core/errors';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({locals, params, url, depends}) => {
  depends('coast:tracking');

  depends('coast:games');
  try {
    const item = await gameDetails(locals.user?.id??null, params.id);
    const id = url.searchParams.get('playthrough') ?? item.playthroughs[0]?.id;
    const playthrough = id && locals.user ? await playthroughDetails(locals.user.id, id, Number(url.searchParams.get('page') ?? 1)) : null;
    if (playthrough && playthrough.gameId !== item.id) error(404, 'Playthrough not found.');
    const sources = (locals.user ? await listProviders(locals.user.id) : []).filter((provider) => provider.provider === 'igdb' && provider.configured);
    return { item, playthrough, sources };
  } catch (cause) {
    if (v.isValiError(cause)) error(400, 'Check the game and playthrough identifiers.');
    if (cause instanceof DomainError) error(cause.status, cause.message);
    throw cause;
  }
};
