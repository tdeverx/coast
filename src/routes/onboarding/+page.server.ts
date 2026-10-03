import {profileAvatarChoices} from '$lib/core/profile/avatars.server';
import {updateProfile} from '$lib/core/profile/service';
import {fail,redirect,isRedirect} from '@sveltejs/kit';
import {requireUser} from '$lib/server/auth';
import {onboardingPending,onboardingServices,onboardingTraktServices,onboardingStatus,linkOnboarding,retryInitialImports,startOnboardingTrakt,pollOnboardingTrakt,beginOnboardingImports} from '$lib/server/auth/onboarding';
import {AppError} from '$lib/server/security/errors';
import type {Actions,PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,depends,url})=>{
 depends('coast:onboarding');const status=await onboardingStatus(requireUser(locals.user).id);
 if(status.complete)redirect(303,'/for-you');
 const canContinue=status.requiredProvider==='none'||status.requiredProvider==='jellyfin'&&status.linked||status.requiredProvider==='trakt'&&status.traktLinked||status.requiredProvider==='either'&&(status.linked||status.traktLinked);
 if(url.searchParams.get('step')==='picture'&&!canContinue)redirect(303,'/onboarding');
 return {...status,picture:url.searchParams.get('step')==='picture',avatarChoices:url.searchParams.get('step')==='picture'?await profileAvatarChoices(requireUser(locals.user).id):[],profile:requireUser(locals.user).settings.profile??{},username:requireUser(locals.user).username,services:await onboardingServices(),traktServices:await onboardingTraktServices()};
};
function failure(cause:unknown){return fail(cause instanceof AppError?cause.status:400,{error:cause instanceof Error?cause.message:'Could not complete this step.'});}
export const actions:Actions={
 connect:async({locals,request})=>{try{await linkOnboarding(requireUser(locals.user).id,Object.fromEntries(await request.formData()));return {success:true};}catch(cause){return failure(cause);}},
 trakt:async({locals,request})=>{try{return {device:await startOnboardingTrakt(requireUser(locals.user).id,Object.fromEntries(await request.formData()))};}catch(cause){return failure(cause);}},
 poll:async({locals,request})=>{try{return await pollOnboardingTrakt(requireUser(locals.user).id,Object.fromEntries(await request.formData()));}catch(cause){return failure(cause);}},
 picture:async({locals,request})=>{try{const user=requireUser(locals.user);if(!await onboardingPending(user.id))throw new AppError(409,'Onboarding is already complete.');const input=await request.formData();await updateProfile(user.id,{action:'edit',displayName:user.settings.profile?.displayName??user.username,bio:user.settings.profile?.bio??'',avatar:input.get('avatar')||null});await beginOnboardingImports(user.id);redirect(303,'/onboarding');}catch(cause){if(isRedirect(cause))throw cause;return failure(cause);}},
 begin:async({locals})=>{try{await beginOnboardingImports(requireUser(locals.user).id);return {success:true};}catch(cause){return failure(cause);}},
 retry:async({locals})=>{try{await retryInitialImports(requireUser(locals.user).id);return {success:true};}catch(cause){return failure(cause);}}
};
