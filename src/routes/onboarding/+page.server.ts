import { provisioningOffer,provisionOnboarding } from '#lib/providers/jellyfin/provisioning.server.js';
import {profileAvatarChoices} from '#lib/core/profile/avatars.server.js';
import {updateProfile} from '#lib/core/profile/service.server.js';
import {fail,redirect,isRedirect} from '@sveltejs/kit';
import {requireUser} from '#lib/server/auth/index.js';
import {onboardingPending,onboardingServices,onboardingTraktServices,onboardingStatus,linkOnboarding,retryInitialImports,startOnboardingTrakt,pollOnboardingTrakt,beginOnboardingImports,backgroundOnboardingImports,retryBackgroundOnboardingImports} from '#lib/server/auth/onboarding.js';
import {AppError} from '#lib/server/security/errors.js';
import type {Actions,PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,depends,url})=>{
 depends('coast:onboarding');
 const user=requireUser(locals.user);
 const status=await onboardingStatus(user.id);
 const background=status.complete&&url.searchParams.get('step')==='imports';
 if(status.complete&&!background)redirect(303,'/library');
 if(background)return {...status,background,imports:await backgroundOnboardingImports(user.id),provisioning:null,
   picture:false,avatarChoices:[],profile:user.settings.profile??{},username:user.username,services:[],traktServices:[]};
 const canContinue=status.requiredProvider==='none'||status.requiredProvider==='jellyfin'&&status.linked||status.requiredProvider==='trakt'&&status.traktLinked||status.requiredProvider==='either'&&(status.linked||status.traktLinked);
 const picture=url.searchParams.get('step')==='picture';
 if(picture&&!canContinue)redirect(303,'/onboarding');
 return {...status,background,provisioning:await provisioningOffer(user.id),picture,avatarChoices:picture?await profileAvatarChoices(user.id):[],
   profile:user.settings.profile??{},username:user.username,services:await onboardingServices(user.id),traktServices:await onboardingTraktServices()};
};
function failure(cause:unknown){return fail(cause instanceof AppError?cause.status:400,{error:cause instanceof Error?cause.message:'Could not complete this step.'});}
export const actions:Actions={
 provision:async({locals,request})=>{try{await provisionOnboarding(requireUser(locals.user).id,(await request.formData()).get('password'));return {success:true};}catch(cause){return failure(cause);}},
 connect:async({locals,request})=>{try{await linkOnboarding(requireUser(locals.user).id,Object.fromEntries(await request.formData()));return {success:true};}catch(cause){return failure(cause);}},
 trakt:async({locals,request})=>{
   try {
     const fields=Object.fromEntries(await request.formData());
     return {device:await startOnboardingTrakt(requireUser(locals.user).id,{
       instanceId:fields.instanceId,traktAccess:{import:fields.import==='true',export:fields.export==='true'}
     })};
   }catch(cause){return failure(cause);}
 },
 poll:async({locals,request})=>{try{return await pollOnboardingTrakt(requireUser(locals.user).id,Object.fromEntries(await request.formData()));}catch(cause){return failure(cause);}},
 picture:async({locals,request})=>{try{const user=requireUser(locals.user);if(!await onboardingPending(user.id))throw new AppError(409,'Onboarding is already complete.');const input=await request.formData();await updateProfile(user.id,{action:'edit',displayName:user.settings.profile?.displayName??user.username,bio:user.settings.profile?.bio??'',avatar:input.get('avatar')||null});await beginOnboardingImports(user.id);redirect(303,'/onboarding');}catch(cause){if(isRedirect(cause))throw cause;return failure(cause);}},
 begin:async({locals})=>{try{await beginOnboardingImports(requireUser(locals.user).id);return {success:true};}catch(cause){return failure(cause);}},
 retry:async({locals})=>{try{await retryInitialImports(requireUser(locals.user).id);return {success:true};}catch(cause){return failure(cause);}},
 retryBackground:async({locals})=>{try{await retryBackgroundOnboardingImports(requireUser(locals.user).id);return {success:true};}catch(cause){return failure(cause);}}
};
