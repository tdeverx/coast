import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { requestList } from '$lib/server/queries/requests';
import { pageNumberSchema } from '$lib/server/queries/pagination';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) error(401, 'Sign in to browse your requests.');
  const page = url.searchParams.has('page') ? Number(url.searchParams.get('page')) : 1;
  if (!v.safeParse(pageNumberSchema, page).success) error(400, 'Choose a positive page number.');
  const requestId = url.searchParams.get('request') ?? undefined;
  if (requestId && !v.safeParse(v.pipe(v.string(), v.uuid()), requestId).success)
    error(400, 'Choose a valid request.');
  const data = await requestList(locals.user.id, page, requestId);
  if (requestId && !data.total) error(404, 'This request was not found.');
  return { ...data, requestId };
};
