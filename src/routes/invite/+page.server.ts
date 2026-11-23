import { authArtwork } from '#lib/auth/artwork.server.js';
import * as v from 'valibot';
import { fail, redirect } from '@sveltejs/kit';
import { registerAccount } from '#lib/server/auth/onboarding.js';
import { previewInvite } from '#lib/server/auth/invites.server.js';
import { setSessionCookie } from '#lib/server/auth/cookies.js';
import { AppError } from '#lib/server/security/errors.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({locals}) => {
  if (locals.user) redirect(303,'/');
  return {authArtwork:await authArtwork()};
};

function feedback(cause: unknown, fallback: string) {
  return fail(cause instanceof AppError ? cause.status : 400,{error:cause instanceof AppError ? cause.message :
    v.isValiError(cause) ? cause.issues[0].message : fallback});
}

export const actions: Actions = {
  verify: async ({request,getClientAddress}) => {
    try {
      return {invite:await previewInvite((await request.formData()).get('code'),getClientAddress())};
    } catch (cause) { return feedback(cause,'Could not verify the invitation.'); }
  },
  claim: async ({request,getClientAddress,cookies,url}) => {
    const data = Object.fromEntries(await request.formData());
    data.displayName ??= data.username;
    try {
      const session = await registerAccount(data,getClientAddress(),true);
      setSessionCookie(cookies,session.token,session.expiresAt,url);
    } catch (cause) {
      const result = feedback(cause,'Could not create your account.');
      return fail(result.status,{...result.data,retry:true});
    }
    redirect(303,'/onboarding');
  },
};
