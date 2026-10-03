import { registrationSchema } from '$lib/auth/registration';
import * as v from 'valibot';
import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { createFirstAdmin } from '$lib/server/auth';
import { setSessionCookie } from '$lib/server/auth/cookies';
export const load = (({ locals }) => {
  if (!locals.setup) redirect(303, locals.user ? '/for-you' : '/login');
  return {};
}) satisfies PageServerLoad;
export const actions = {
  default: async ({ request, cookies, url }) => {
    const form = await request.formData();
    let session;
    try {
      session = await createFirstAdmin({...v.parse(registrationSchema,Object.fromEntries(form)),email:form.get('email')||undefined});
    } catch (e) {
      return fail(400, { error: v.isValiError(e) ? e.issues[0].message : e instanceof Error ? e.message : 'Setup could not be completed.' });
    }
    setSessionCookie(cookies, session.token, session.expiresAt, url);
    redirect(303, '/for-you');
  },
} satisfies Actions;
