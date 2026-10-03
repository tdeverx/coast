import * as v from 'valibot';
import {getConfig} from '$lib/server/config';
import { fail, redirect } from '@sveltejs/kit';
import { registerAccount } from '$lib/server/auth/onboarding';
import { setSessionCookie } from '$lib/server/auth/cookies';
import { AppError } from '$lib/server/security/errors';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({locals}) => { if(locals.user) redirect(303,'/onboarding'); const config=await getConfig();return {registrationMode:config.registrationMode}; };
export const actions: Actions = { default: async ({request,getClientAddress,cookies,url}) => {
  const form=await request.formData();
  try {
    const session=await registerAccount(Object.fromEntries(form),getClientAddress());
    setSessionCookie(cookies,session.token,session.expiresAt,url);
  } catch(cause) { return fail(cause instanceof AppError?cause.status:400,{error:cause instanceof AppError?cause.message:v.isValiError(cause)?cause.issues[0].message:'Could not create your account.'}); }
  redirect(303,'/onboarding');
}};
