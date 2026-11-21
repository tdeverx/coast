import { registrationSchema } from '#lib/auth/registration.js';
import * as v from 'valibot';
import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { createFirstAdmin, checkLoginRate, requireAdmin } from '#lib/server/auth/index.js';
import { AppError } from '#lib/server/security/errors.js';
import { setSessionCookie } from '#lib/server/auth/cookies.js';
import { tmdbCredential } from '#lib/providers/tmdb/credentials.js';
import { configureInstance } from '#lib/providers/instances.server.js';
import { setInstanceEnabled } from '#lib/application/provider-sources.server.js';
import { getSql } from '#lib/server/db/index.js';
export const load = (({ locals }) => {
  if (!locals.setup && !locals.user) redirect(303, '/login');
  if (!locals.setup && !locals.needsTmdb) redirect(303, '/for-you');
  return { accountRequired: locals.setup, canConfigureTmdb: locals.user?.role === 'admin' };
}) satisfies PageServerLoad;
export const actions = {
  account: async ({ request, cookies, url, locals, getClientAddress }) => {
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
    redirect(303, '/setup');
  },
  tmdb: async ({ request, locals }) => {
    try {
      const admin = requireAdmin(locals.user);
      if (!locals.needsTmdb) return fail(409, {error:'TMDB is already configured.'});
      checkLoginRate(`setup-tmdb:${admin.id}`);
      const fields = await request.formData();
      const credential = tmdbCredential(fields.get('tmdbCredential'));
      if (!credential.apiKey && !credential.accessToken) return fail(400, {error:'Enter your TMDB API key or read access token.'});
      const [existing] = await getSql()`select id,name,enabled from provider_instances where provider='tmdb' order by enabled desc,id limit 1`;
      const saved = await configureInstance(admin.id, {
        provider:'tmdb',name:existing?.name ?? 'TMDB',id:existing?.id,...credential,
      }, request.signal);
      if (existing && !existing.enabled) await setInstanceEnabled(admin.id,saved.id,true);
    } catch (cause) {
      return fail(cause instanceof AppError ? cause.status : 400, {
        error:cause instanceof AppError ? cause.message : 'Coast could not connect to TMDB.',
      });
    }
    redirect(303,'/for-you');
  },
} satisfies Actions;
