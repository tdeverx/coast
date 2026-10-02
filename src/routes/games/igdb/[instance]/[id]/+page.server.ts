import { error } from '@sveltejs/kit';
import { igdbDetails } from '$lib/providers/igdb/service.server';
import { AppError } from '$lib/server/security/errors';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({locals, params, depends}) => {
  depends('coast:tracking');

  if (!locals.user) error(401, 'Sign in to browse games.');
  try { return { item: await igdbDetails(params.instance, params.id), instanceId: params.instance }; }
  catch (cause) { if (cause instanceof AppError) error(cause.status, cause.message); error(502, 'Game details could not be loaded.'); }
};
