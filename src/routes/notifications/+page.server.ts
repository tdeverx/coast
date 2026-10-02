import type { PageServerLoad } from './$types';
import { inbox } from '$lib/server/notifications';
export const load = (async ({ locals,url,depends }) => {
  depends('coast:notifications');
  return {
  inbox: await inbox(locals.user, 100,{kind:url.searchParams.get('kind')??'all',unread:url.searchParams.get('unread')==='true'}),
}; }) satisfies PageServerLoad;
