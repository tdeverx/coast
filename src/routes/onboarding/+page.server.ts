import { fail, redirect, isRedirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { initialTraktSync } from '#lib/providers/trakt/access.js';
import { updateSyncPreferences } from '#lib/providers/trakt/connection.server.js';
import { provisioningOffer, provisionOnboarding } from '#lib/providers/jellyfin/provisioning.server.js';
import { disconnectProvider } from '#lib/application/provider-sources.server.js';
import { updateProfile } from '#lib/core/profile/service.server.js';
import { requireUser } from '#lib/server/auth/index.js';
import { getConfig } from '#lib/server/config.js';
import { getSql } from '#lib/server/db/index.js';
import { onboardingPending, onboardingServices, onboardingTraktServices, onboardingStatus, onboardingConnections, linkOnboarding, retryInitialImports, startOnboardingTrakt, pollOnboardingTrakt, beginOnboardingImports, backgroundOnboardingImports, retryBackgroundOnboardingImports } from '#lib/server/auth/onboarding.js';
import { AppError } from '#lib/server/security/errors.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({locals,depends,url}) => {
  depends('coast:onboarding');
  const user = requireUser(locals.user);
  const status = await onboardingStatus(user.id);
  const requested = url.searchParams.get('step');
  const background = status.complete && requested === 'imports';
  if (status.complete && !background) redirect(303,'/library');
  const libraryOnly = !!user.access?.libraryOnly;
  const canContinue = !status.reconnect && (status.requiredProvider === 'none' || status.requiredProvider !== 'trakt' && status.linked || status.requiredProvider !== 'jellyfin' && status.traktLinked);
  const skipServices = libraryOnly && status.linked && !status.reconnect;
  let step: 'imports'|'services'|'profile' = 'services';
  if (background || status.phase === 'importing' && !(status.reconnect && requested === 'services')) step = 'imports';
  else if (canContinue && (skipServices || requested === 'profile' || requested === 'picture')) step = 'profile';
  if (step === 'imports' && requested !== 'imports') redirect(303,'/onboarding?step=imports');
  const [imports,serviceSetup] = await Promise.all([
    background ? backgroundOnboardingImports(user.id) : status.imports,
    step === 'services' ? loadServiceSetup(user.id,libraryOnly) : null,
  ]);
  const {displayName,bio} = user.settings.profile ?? {};
  return {
    step, imports, background, canContinue, skipServices, libraryOnly, serviceSetup,
    invited:status.invited, complete:status.complete, phase:status.phase, reconnect:status.reconnect,
    linked:status.linked, traktLinked:status.traktLinked, requiredProvider:status.requiredProvider,
    profile:{displayName,bio}, username:user.username,
  };
};

async function loadServiceSetup(userId:string, libraryOnly:boolean) {
  const [connections,provisioning,services,traktServices,config] = await Promise.all([
    onboardingConnections(userId), provisioningOffer(userId), onboardingServices(userId),
    libraryOnly ? [] : onboardingTraktServices(), getConfig(),
  ]);
  return {connections, provisioning, services, traktServices,
    allowServerUrl:config.allowArbitraryServers && !provisioning && connections.inviteAccount === 'coast'};
}

function failure(cause:unknown) {
  return fail(cause instanceof AppError ? cause.status : 400,{error:v.isValiError(cause) ? cause.issues[0].message : cause instanceof Error ? cause.message : 'Could not complete this step.'});
}
function syncChoices(fields:FormData) {
  const defaults = initialTraktSync();
  const choices = (direction:keyof typeof defaults) => Object.fromEntries(Object.keys(defaults[direction]).map(key=>[key,fields.get(direction+'.'+key)==='on']));
  return {import:choices('import'),export:choices('export')};
}
async function pendingMember(locals:App.Locals, allowLibraryOnly=true) {
  const user = requireUser(locals.user);
  if (!allowLibraryOnly && user.access?.libraryOnly) throw new AppError(403,'Unavailable to library-only accounts.');
  if (!await onboardingPending(user.id)) throw new AppError(409,'Onboarding is already complete.');
  return user;
}

export const actions = {
  provision:async({locals,request})=>{try{await provisionOnboarding(requireUser(locals.user).id,(await request.formData()).get('password'));return {success:true};}catch(cause){return failure(cause);}},
  connect:async({locals,request})=>{try{await linkOnboarding(requireUser(locals.user).id,Object.fromEntries(await request.formData()));return {success:true};}catch(cause){return failure(cause);}},
  trakt:async({locals,request})=>{
    try {
      const user=await pendingMember(locals,false),fields=await request.formData();
      return {device:await startOnboardingTrakt(user.id,{instanceId:fields.get('instanceId'),traktSync:syncChoices(fields)})};
    }catch(cause){return failure(cause);}
  },
  poll:async({locals,request})=>{
    try {
      const user=await pendingMember(locals,false), fields=await request.formData();
      const result=await pollOnboardingTrakt(user.id,Object.fromEntries(fields));
      if(result.pending && fields.has('manual')) return {pending:true,manualPoll:{
        instanceId:String(fields.get('instanceId')),challengeId:String(fields.get('challengeId')),
      }};
      return result;
    }catch(cause){return failure(cause);}
  },
  preferences:async({locals,request})=>{
    try {
      const user=await pendingMember(locals,false), fields=await request.formData(), connection=await onboardingConnections(user.id);
      if(!connection.traktId) throw new AppError(409,'Connect Trakt first.');
      await updateSyncPreferences(user.id,connection.traktId,{accountGeneration:fields.get('generation'),traktSync:syncChoices(fields)});
      return {success:true};
    }catch(cause){return failure(cause);}
  },
  disconnect:async({locals,request})=>{
    try {
      const user=await pendingMember(locals,false), fields=await request.formData(), connection=await onboardingConnections(user.id);
      const trakt=fields.get('service')==='trakt', id=trakt ? connection.traktId : connection.jellyfinId;
      if (!id || id!==fields.get('connectionId')) throw new AppError(409,'The connection changed. Reload and try again.');
      if (!trakt && (await provisioningOffer(user.id))?.state==='complete') throw new AppError(403,'This account uses an assigned Jellyfin connection.');
      await disconnectProvider(user.id,id);
      const db=getSql();
      if (trakt) await db`update user_onboarding set trakt_connection_id=null,trakt_account_generation=null,import_jobs='{}'::jsonb where user_id=${user.id} and trakt_connection_id=${id} and completed_at is null`;
      else await db`update user_onboarding set connection_id=null,account_generation=null where user_id=${user.id} and connection_id=${id} and completed_at is null`;
      return {success:true};
    }catch(cause){return failure(cause);}
  },
  picture:async({locals,request})=>{
    try {
      const user=await pendingMember(locals), fields=await request.formData();
      await updateProfile(user.id,{action:'details',displayName:fields.get('displayName') ?? user.username,bio:fields.get('bio') ?? ''});
      await beginOnboardingImports(user.id);
      redirect(303,'/onboarding?step=imports');
    }catch(cause){if(isRedirect(cause))throw cause;return failure(cause);}
  },
  begin:async({locals})=>{try{await beginOnboardingImports(requireUser(locals.user).id);redirect(303,'/onboarding?step=imports');}catch(cause){if(isRedirect(cause))throw cause;return failure(cause);}},
  retry:async({locals,request})=>{try{await retryInitialImports(requireUser(locals.user).id,String((await request.formData()).get('kind')??''));return {success:true};}catch(cause){return failure(cause);}},
  retryBackground:async({locals,request})=>{try{await retryBackgroundOnboardingImports(requireUser(locals.user).id,String((await request.formData()).get('kind')??''));return {success:true};}catch(cause){return failure(cause);}},
} satisfies Actions;
