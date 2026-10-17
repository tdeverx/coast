import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import {gameDetailData} from '$lib/games/detail.server';
import { DomainError } from '$lib/core/errors';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({locals, params, url, depends}) => {
  depends('coast:tracking');

  depends('coast:games');
  try {
    return await gameDetailData(locals.user?.id??null,params.id,url.searchParams.get('playthrough'));
  } catch (cause) {
    if (v.isValiError(cause)) error(400, 'Check the game and playthrough identifiers.');
    if (cause instanceof DomainError) error(cause.status, cause.message);
    throw cause;
  }
};
