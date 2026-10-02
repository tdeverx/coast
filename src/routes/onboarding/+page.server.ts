import {fail,redirect} from '@sveltejs/kit';
import {requireUser} from '$lib/server/auth';
import {onboardingServices,onboardingStatus,linkOnboarding,retryOnboarding} from '$lib/server/auth/onboarding';
import {AppError} from '$lib/server/security/errors';
import type {Actions,PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,depends,url})=>{
  depends('coast:onboarding'); const user=requireUser(locals.user),status=await onboardingStatus(user.id);
  if(status.complete)redirect(303,'/for-you');
  return {...status,reconnect:status.reconnect||url.searchParams.get('reconnect')==='1',services:await onboardingServices()};
};
export const actions:Actions={
  connect:async({locals,request})=>{try{await linkOnboarding(requireUser(locals.user).id,Object.fromEntries(await request.formData()));return {success:true};}catch(cause){return fail(cause instanceof AppError?cause.status:400,{error:cause instanceof Error?cause.message:'Could not connect Jellyfin.'});}},
  retry:async({locals})=>{try{await retryOnboarding(requireUser(locals.user).id);return {success:true};}catch(cause){return fail(400,{error:cause instanceof Error?cause.message:'Could not retry the import.'});}}
};
