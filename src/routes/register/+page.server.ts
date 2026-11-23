import { authArtwork } from '#lib/auth/artwork.server.js';
import * as v from 'valibot';
import {getConfig} from '#lib/server/config.js';
import { fail, redirect } from '@sveltejs/kit';
import { registerAccount } from '#lib/server/auth/onboarding.js';
import { setSessionCookie } from '#lib/server/auth/cookies.js';
import { AppError } from '#lib/server/security/errors.js';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({locals}) => {
  if (locals.user) redirect(303,'/onboarding');
  const [config, artwork] = await Promise.all([getConfig(),authArtwork()]);
  return {registrationMode:config.registrationMode,authArtwork:artwork};
};
export const actions: Actions = { default: async ({request,getClientAddress,cookies,url}) => {
  const form=await request.formData();
  try {
    const fields = Object.fromEntries(form);
    fields.displayName ??= fields.username;
    const session=await registerAccount(fields,getClientAddress());
    setSessionCookie(cookies,session.token,session.expiresAt,url);
  } catch(cause) { return fail(cause instanceof AppError?cause.status:400,{error:cause instanceof AppError?cause.message:v.isValiError(cause)?cause.issues[0].message:'Could not create your account.'}); }
  redirect(303,'/onboarding');
}};
