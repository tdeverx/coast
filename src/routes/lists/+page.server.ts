import { getLists } from '$lib/core/lists/service';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { listsData, listsOptionsSchema } from '$lib/server/queries/lists';
import { AppError } from '$lib/server/security/errors';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) error(401, 'Sign in to browse your lists.');
  const parameters = url.searchParams;
  if (!parameters.has('view')) return { lists: await getLists(locals.user.id), detail: null };
  const parsed = v.safeParse(listsOptionsSchema, {
    view: parameters.get('view') ?? undefined,
    scope: parameters.get('scope') ?? undefined,
    filter: 'all',
    kind: parameters.get('kind') ?? undefined,
    page: parameters.has('page') ? Number(parameters.get('page')) : undefined,
  });
  if (!parsed.success) error(400, 'Choose a valid list, filter and positive page number.');
  try {
    const detail = await listsData(locals.user.id, parsed.output);
    return { lists: detail.lists, detail };
  } catch (cause) {
    if (cause instanceof AppError) error(cause.status, cause.message);
    throw cause;
  }
};
