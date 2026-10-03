import {fail,redirect} from '@sveltejs/kit';
import {requireUser} from '$lib/server/auth';
import {onboardingServices,onboardingTraktServices,onboardingStatus,linkOnboarding,retryInitialImports,startOnboardingTrakt,pollOnboardingTrakt,beginOnboardingImports} from '$lib/server/auth/onboarding';
import {AppError} from '$lib/server/security/errors';
import type {Actions,PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,depends})=>{
 depends('coast:onboarding');const status=await onboardingStatus(requireUser(locals.user).id);
 if(status.complete)redirect(303,'/for-you');
 return {...status,services:await onboardingServices(),traktServices:await onboardingTraktServices()};
};
function failure(cause:unknown){return fail(cause instanceof AppError?cause.status:400,{error:cause instanceof Error?cause.message:'Could not complete this step.'});}
export const actions:Actions={
 connect:async({locals,request})=>{try{await linkOnboarding(requireUser(locals.user).id,Object.fromEntries(await request.formData()));return {success:true};}catch(cause){return failure(cause);}},
 trakt:async({locals,request})=>{try{return {device:await startOnboardingTrakt(requireUser(locals.user).id,Object.fromEntries(await request.formData()))};}catch(cause){return failure(cause);}},
 poll:async({locals,request})=>{try{return await pollOnboardingTrakt(requireUser(locals.user).id,Object.fromEntries(await request.formData()));}catch(cause){return failure(cause);}},
 begin:async({locals})=>{try{await beginOnboardingImports(requireUser(locals.user).id);return {success:true};}catch(cause){return failure(cause);}},
 retry:async({locals})=>{try{await retryInitialImports(requireUser(locals.user).id);return {success:true};}catch(cause){return failure(cause);}}
};
