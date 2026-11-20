import { error, redirect } from '@sveltejs/kit';
import { loadProfileDetails, loadProfileRow } from '#lib/profile/details.server.js';
import { profilePath } from '#lib/profile/url.js';
import { AppError } from '#lib/server/security/errors.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, params, depends, request }) => {
  depends('coast:tracking', 'coast:social');
  try {
    const row = await loadProfileRow(params.username, locals.user?.id ?? null, url, request.signal);
    if (row) {
      if (params.username !== row.username) redirect(307, row.href);
      return { row };
    }
    const data = await loadProfileDetails(params.username, locals.user?.id ?? null, url, request.signal);
    if (params.username !== data.username) redirect(307, profilePath(data.username) + url.search);
    return { profile: data };
  } catch (cause) {
    if (cause instanceof AppError) error(cause.status, cause.message);
    throw cause;
  }
};
