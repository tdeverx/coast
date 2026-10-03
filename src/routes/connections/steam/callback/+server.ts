import { error, redirect } from '@sveltejs/kit';
import { finishSteam } from '$lib/providers/steam/connection.server';
import { AppError } from '$lib/server/security/errors';
import * as v from 'valibot';
import type { RequestHandler } from './$types';
export const GET:RequestHandler=async ({locals,url})=>{
  if(!locals.user)error(401,'Sign in to Coast before linking Steam.');
  try {await finishSteam(locals.user.id,url);} catch(cause) {
    if(cause instanceof AppError)error(cause.status,cause.message);
    if(v.isValiError(cause))error(400,'Invalid Steam linking response. Start linking again.');
    throw cause;
  }
  redirect(303,'/settings/connections');
};
