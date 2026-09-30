import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { collectionData, collectionOptionsSchema, collectionParameters } from '$lib/collection/query.server';
import { missingDemand } from '$lib/collection/demand.server';
import { profileUser } from '$lib/server/queries/profile-user';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) error(401, 'Sign in to browse Collection.');
  const view = url.searchParams.get('view') ?? 'overview';
  if (!['overview', 'watch', 'listen', 'play'].includes(view)) error(400, 'Choose a valid Collection view.');
  const username = url.searchParams.get('username') || undefined;
  const profile = username ? await profileUser(username) : null;
  const category = view === 'listen' ? 'music' : view === 'play' ? 'game' : 'screen';
  const parsed = v.safeParse(collectionOptionsSchema, { ...collectionParameters(url), category, level: 'root' });
  if (!parsed.success) error(400, 'Choose valid Collection filters and a positive page number.');
  return {
    view,
    filters: parsed.output,
    username: profile?.username ?? null,
    owner: !profile || profile.id === locals.user.id,
    content: view === 'overview' ? null : await collectionData(locals.user.id, parsed.output, username),
    missing: profile ? null : missingDemand(locals.user.id, new URL(`http://coast/missing?page=${url.searchParams.get('missingPage')??1}`)),
  };
};
