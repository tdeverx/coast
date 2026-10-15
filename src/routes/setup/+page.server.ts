import { registrationSchema } from '$lib/auth/registration';
import * as v from 'valibot';
import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { createFirstAdmin, checkLoginRate } from '$lib/server/auth';
import { AppError } from '$lib/server/security/errors';
import { setSessionCookie } from '$lib/server/auth/cookies';
export const load = (({ locals }) => {
  if (!locals.setup) redirect(303, locals.user ? '/for-you' : '/login');
  return {};
}) satisfies PageServerLoad;
export const actions = {
  default: async ({ request, cookies, url, locals, getClientAddress }) => {
    if (!locals.setup) return fail(409, {error: 'Coast is already configured.'});
    let session;
    try {
      checkLoginRate(`setup:${getClientAddress()}`);
      const form = await request.formData();
      session = await createFirstAdmin({...v.parse(registrationSchema,Object.fromEntries(form)),email:form.get('email')||undefined});
    } catch (e) {
      return fail(e instanceof AppError ? e.status : 400, { error: v.isValiError(e) ? e.issues[0].message : e instanceof Error ? e.message : 'Setup could not be completed.' });
    }
    setSessionCookie(cookies, session.token, session.expiresAt, url);
    redirect(303, '/for-you');
  },
} satisfies Actions;
