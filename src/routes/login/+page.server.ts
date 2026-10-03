import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { login } from '$lib/server/auth';
import { AppError } from '$lib/server/security/errors';
import { setSessionCookie } from '$lib/server/auth/cookies';
export const load:PageServerLoad=({locals})=>{if(locals.user)redirect(303,'/for-you');};
export const actions = {
 default: async ({request,cookies,url,getClientAddress})=>{
  const form=await request.formData();let session;
  try{session=await login({username:form.get('username'),password:form.get('password')},getClientAddress());}
  catch(cause){return fail(cause instanceof AppError?cause.status:400,{error:cause instanceof AppError?cause.message:'Check your username and password.'});}
  setSessionCookie(cookies,session.token,session.expiresAt,url);
  const next=new URL(url.searchParams.get('next')||'/for-you',url);
  redirect(303,next.origin===url.origin?next.pathname+next.search:'/for-you');
 }
} satisfies Actions;
