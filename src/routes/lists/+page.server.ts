import { error, redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { listsData, listsOptionsSchema } from '#lib/server/queries/lists.js';
import { AppError } from '#lib/server/security/errors.js';
import { profileListsPath } from '#lib/profile/url.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({locals, url, depends}) => {
  depends('coast:tracking');

  if (!locals.user) error(401, 'Sign in to browse your lists.');
  const parameters = url.searchParams;
  const overviewHref = profileListsPath(locals.user.username);
  if (!parameters.has('view')) redirect(307, overviewHref);
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
    return { detail, overviewHref };
  } catch (cause) {
    if (cause instanceof AppError) error(cause.status, cause.message);
    throw cause;
  }
};
