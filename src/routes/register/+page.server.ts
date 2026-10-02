import { fail, redirect } from '@sveltejs/kit';
import { redeemInvite } from '$lib/server/auth/onboarding';
import { setSessionCookie } from '$lib/server/auth/cookies';
import { AppError } from '$lib/server/security/errors';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = ({locals}) => { if(locals.user) redirect(303,'/onboarding'); };
export const actions: Actions = { default: async ({request,getClientAddress,cookies,url}) => {
  const form=await request.formData();
  try {
    const session=await redeemInvite(Object.fromEntries(form),getClientAddress());
    setSessionCookie(cookies,session.token,session.expiresAt,url);
  } catch(cause) { return fail(cause instanceof AppError?cause.status:400,{error:cause instanceof AppError?cause.message:'Check your invite code, username, and password (at least 12 characters).'}); }
  redirect(303,'/onboarding');
}};
