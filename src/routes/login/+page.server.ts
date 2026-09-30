import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { login } from '$lib/server/auth';
import { jellyfinSignInServices, loginJellyfin } from '$lib/server/auth/jellyfin';
import { getConfig } from '$lib/server/config';
import { AppError } from '$lib/server/security/errors';
import * as v from 'valibot';
import { setSessionCookie } from '$lib/server/auth/cookies';
export const load = (async ({ locals }) => {
  if (locals.user) redirect(303, '/for-you');
  return {
    services: await jellyfinSignInServices(),
    autoCreateUsers: (await getConfig()).jellyfinAutoCreateUsers,
  };
}) satisfies PageServerLoad;
export const actions = {
  default: async ({ request, cookies, url, getClientAddress }) => {
    const form = await request.formData();
    let session;
    const service = String(form.get('service') || 'coast');
    try {
      session =
        service === 'coast'
          ? await login(
              { username: form.get('username'), password: form.get('password') },
              getClientAddress()
            )
          : await loginJellyfin(
              {
                instanceId: service,
                username: form.get('username'),
                password: form.get('password') ?? '',
              },
              getClientAddress()
            );
    } catch (e) {
      return fail(e instanceof AppError ? e.status : 400, {
        service,
        error: v.isValiError(e)
          ? 'Check your username and password.'
          : e instanceof Error
            ? e.message
            : 'Sign in failed.',
      });
    }
    setSessionCookie(cookies, session.token, session.expiresAt, url);
    const next = new URL(url.searchParams.get('next') || '/for-you', url);
    redirect(303, next.origin === url.origin ? next.pathname + next.search : '/for-you');
  },
} satisfies Actions;
