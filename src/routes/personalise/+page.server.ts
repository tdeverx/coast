import { error, redirect } from '@sveltejs/kit';
import { detailPanelUrl } from '#lib/media/detail-target.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  if (!locals.user) redirect(303, '/login?next=/personalise');
  if (!(await parent()).capabilities.cardLayouts) error(403, 'Media card layouts are turned off for this account.');
  const destination = detailPanelUrl(new URL('/library', url), '/personalise');
  redirect(303, destination.pathname + destination.search);
};
