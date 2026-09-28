import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { login } from '$lib/server/auth';
import { setSessionCookie } from '$lib/server/auth/cookies';
export const load = (({ locals }) => {
  if (locals.user) redirect(303, '/for-you');
  return {};
}) satisfies PageServerLoad;
export const actions = {
  default: async ({ request, cookies, url, getClientAddress }) => {
    const form = await request.formData();
    let session;
    try {
      session = await login(
        { username: form.get('username'), password: form.get('password') },
        getClientAddress()
      );
    } catch (e) {
      return fail(400, { error: e instanceof Error ? e.message : 'Sign in failed.' });
    }
    setSessionCookie(cookies, session.token, session.expiresAt, url);
    const next = new URL(url.searchParams.get('next') || '/for-you', url);
    redirect(303, next.origin === url.origin ? next.pathname + next.search : '/for-you');
  },
} satisfies Actions;
