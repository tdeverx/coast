import { provisionOnboarding } from '#lib/providers/jellyfin/provisioning.server.js';
import * as v from 'valibot';
import { getSql } from '../db';
import { registrationSchema } from '#lib/auth/registration.js';
import { getConfig } from '../config';
import { startTraktDevice, finishTraktDevice } from '#lib/providers/trakt/connection.server.js';
import { hashToken, newSession, checkLoginRate, type SessionUser } from './index';
import { AppError } from '../security/errors';
import { connectJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import { libraryScanProgress } from '#lib/sync/jellyfin.server.js';
import { jellyfinImportStage } from '#lib/sync/jellyfin-progress.js';
import { enqueueAction } from '../queue';
import { findRedeemableInvite, recordAccountEvent } from './invites.server';
import { lockFeaturePolicyInTransaction } from '#lib/server/features.js';
import { addInviterFriend } from '#lib/social/service.server.js';

export async function registerAccount(input: unknown, client: string, inviteOnly = false) {
  checkLoginRate(`register:${client}`);
  const data = v.parse(registrationSchema, input);
  const choices=v.parse(v.object({addInviter:v.optional(v.literal('on')),existingJellyfin:v.optional(v.literal('on'))}),input);
  const config = await getConfig();
  if ((inviteOnly || config.registrationMode === 'invite' || data.code) && !/^[A-Za-z0-9_-]{43}$/.test(data.code))
    throw new AppError(400,'Enter a valid invite code.');
  const tokenHash = data.code ? await hashToken(data.code) : '';
  const db = getSql();
  if (data.code && !await findRedeemableInvite(db,tokenHash)) throw new AppError(400,'This invite code has expired, was used, or is invalid.');
  const passwordHash = await Bun.password.hash(data.password, { algorithm:'argon2id',memoryCost:19456,timeCost:2 });
  let registered: {user:SessionUser;provision:boolean};
  try {
    registered = await db.begin(async sql => {
      const current = await getConfig(sql);
      const invite = data.code ? await findRedeemableInvite(sql,tokenHash,true) : undefined;
      if ((data.code || inviteOnly || current.registrationMode === 'invite') && !invite)
        throw new AppError(400,'This invite code has expired, was used, or is invalid.');
      if (choices.existingJellyfin && invite?.defaults?.account !== 'choice')
        throw new AppError(400,'This invite does not allow an existing Jellyfin account.');
      const defaults = invite?.defaults;
      const [row] = await sql`insert into users (username,password_hash,role,settings,access_defaults,membership_expires_at)
        values (${data.username},${passwordHash},'user',${{...defaults?.preferences,profile:{displayName:data.displayName}}}::jsonb,
        ${defaults?.access ?? {}}::jsonb,now()+${defaults?.membershipDays ?? null}::integer*interval '1 day')
        returning id,username,email,role,settings,access_defaults`;
      await sql`insert into user_onboarding(user_id,required_provider)
        values(${row.id},${invite?.provision_generation ? 'jellyfin' : current.registrationProvider})`;
      const provision = !!invite?.provision_generation && !choices.existingJellyfin;
      if (provision) {
        if (!invite?.provision_connection_id) throw new AppError(409,'This invitation’s provisioning account is unavailable.');
        await sql`insert into onboarding_provisioning(user_id,connection_id,account_generation,folders)
          values(${row.id},${invite.provision_connection_id},${invite.provision_generation},${invite.provision_folders}::jsonb)`;
      }
      if (invite) {
        await sql`update registration_invites set claim_count=claim_count+1,used_at=coalesce(used_at,now()),used_by=coalesce(used_by,${row.id})
          where id=${invite.id}`;
        await sql`insert into invite_claims(invite_id,user_id,username,add_inviter)
          values(${invite.id},${row.id},${data.username},${choices.addInviter==='on' && !!invite.inviter})`;
        await recordAccountEvent(sql,'invite.claimed',row.id,invite.id);
      }
      const {access_defaults:access,...user}=row;
      return {user:{...user,access} as SessionUser,provision};
    });
  } catch (cause) {
    if ((cause as { errno?: string }).errno === '23505') throw new AppError(409,'That username is already in use.');
    throw cause;
  }
  const session = await newSession(registered.user);
  if (registered.provision) {
    try {
      await provisionOnboarding(registered.user.id,data.password);
    } catch {
      // The account and claim are committed. Onboarding presents the stored
      // recovery state and can accept the original password again if needed.
    }
  }
  return session;
}

export async function onboardingPending(userId: string) {
  const [row] = await getSql()`SELECT user_id FROM user_onboarding WHERE user_id=${userId} AND completed_at IS NULL`;
  return !!row;
}
export async function onboardingServices(userId: string) {
  return getSql()`select p.id,p.name from provider_instances p where p.provider='jellyfin' and p.enabled
    and p.server_identity is not null and p.settings->>'approved'='true'
    and not exists(select 1 from onboarding_provisioning job where job.user_id=${userId} and job.state<>'complete')
    and not exists(select 1 from invite_claims c join registration_invites i on i.id=c.invite_id
      where c.user_id=${userId} and i.provision_generation is not null and not exists(
        select 1 from provider_connections a where a.id=i.provision_connection_id and a.instance_id=p.id and a.account_generation=i.provision_generation))
    order by p.name`;
}
export async function linkOnboarding(userId: string, input: unknown) {
  if (!await onboardingPending(userId)) throw new AppError(409, 'Onboarding is already complete.');
  checkLoginRate(`onboarding:${userId}`);
  const data = v.parse(v.object({ instanceId:v.pipe(v.string(),v.uuid()),username:v.pipe(v.string(),v.minLength(1),v.maxLength(250)),password:v.pipe(v.string(),v.maxLength(4096)) }),input);
  const instance=(await onboardingServices(userId)).find((entry:{id:string})=>entry.id===data.instanceId);
  if(!instance)throw new AppError(403,'Choose an enabled, approved Jellyfin server.');
  const started = new Date();
  const connection = await connectJellyfin(userId,data);
  // Read the stored generation: it is deliberately separate from authentication binding.
  await getSql()`UPDATE user_onboarding o SET connection_id=c.id,account_generation=c.account_generation,requested_at=${started}
    FROM provider_connections c WHERE o.user_id=${userId} AND c.id=${connection.id} AND c.user_id=o.user_id AND o.completed_at IS NULL`;
}
export async function retryOnboarding(userId: string) {
  if (!await onboardingPending(userId)) return;
  // Existing queue serialization/deduplication and service cooldowns still apply.
  await getSql().begin(async sql => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('provider-maintenance',0))`;
    const [o] = await sql`SELECT o.connection_id,c.instance_id FROM user_onboarding o JOIN provider_connections c ON c.id=o.connection_id
      WHERE o.user_id=${userId} AND o.account_generation=c.account_generation AND c.status='connected' AND o.completed_at IS NULL`;
    if (!o) throw new AppError(409, 'Reconnect Jellyfin before retrying the import.');
    const [busy] = await sql`SELECT a.id FROM outbox_actions a JOIN provider_connections c ON c.id=a.connection_id WHERE a.connection_id=${o.connection_id} AND a.user_id=${userId} AND a.kind='jellyfin.bootstrap' AND a.state IN ('pending','running') LIMIT 1`;
    if (busy) throw new AppError(409,'Your Jellyfin import is already queued or running. Retry when it finishes.');
    await sql`UPDATE outbox_actions SET state='pending',next_attempt_at=NOW(),updated_at=NOW() WHERE id=(SELECT id FROM outbox_actions WHERE user_id=${userId} AND connection_id=${o.connection_id} AND kind='jellyfin.bootstrap' AND state='failed' AND account_generation=(SELECT account_generation FROM provider_connections WHERE id=${o.connection_id}) ORDER BY created_at DESC LIMIT 1)`;
  });
  const [o] = await getSql()`SELECT connection_id FROM user_onboarding WHERE user_id=${userId}`;
  if (o?.connection_id) await enqueueAction({userId,connectionId:o.connection_id,kind:'jellyfin.bootstrap',payload:{},compactionKey:'jellyfin.bootstrap'});
}

export async function onboardingTraktServices() {
 if(!(await getConfig()).enableTrakt)return [];
 return getSql()`select id,name from provider_instances where provider='trakt' and enabled and credentials is not null order by name`;
}
async function pendingOnboarding(userId:string) {
 const [row]=await getSql()`select * from user_onboarding where user_id=${userId} and completed_at is null`;
 if(!row)throw new AppError(409,'Onboarding is already complete.');
 return row;
}
export async function startOnboardingTrakt(userId:string,input:unknown) {
 const onboarding=await pendingOnboarding(userId);
 const {instanceId}=v.parse(v.object({instanceId:v.pipe(v.string(),v.uuid())}),input);
 if(!(await onboardingTraktServices()).some((entry:{id:string})=>entry.id===instanceId))throw new AppError(403,'Trakt is unavailable.');
 checkLoginRate(`onboarding-trakt:${userId}`);
 if(onboarding.trakt_connection_id){
  const [failed]=await getSql()`select c.id from provider_connections c where c.id=${onboarding.trakt_connection_id}
    and c.user_id=${userId} and c.instance_id=${instanceId} and c.account_generation=${onboarding.trakt_account_generation}
    and exists(select 1 from outbox_actions a where a.connection_id=c.id and a.account_generation=c.account_generation
      and a.user_id=${userId} and a.state='failed' and a.payload->'_jobFailure'->>'code'='provider.authentication')`;
  if(failed)await (await import('#lib/application/provider-sources.server.js')).disconnectProvider(userId,failed.id);
 }
 return {...await startTraktDevice(userId,instanceId),instanceId};
}
export async function pollOnboardingTrakt(userId:string,input:unknown) {
 await pendingOnboarding(userId);
 const {instanceId}=v.parse(v.object({instanceId:v.pipe(v.string(),v.uuid())}),input);
 const result=await finishTraktDevice(userId,instanceId);
 if(!result.pending && result.connection)await getSql()`update user_onboarding o set trakt_connection_id=c.id,trakt_account_generation=c.account_generation,import_jobs='{}'::jsonb from provider_connections c where o.user_id=${userId} and o.completed_at is null and c.id=${result.connection.id} and c.user_id=o.user_id`;
 return {pending:result.pending};
}
function requiredConnection(required:string,jellyfin:boolean,trakt:boolean) {
 return required==='none'||required==='jellyfin'&&jellyfin||required==='trakt'&&trakt||required==='either'&&(jellyfin||trakt);
}
async function onboardingRow(userId:string) {
 const [row]=await getSql()`select o.*,c.status as connection_status,c.account_generation as current_generation,
 t.status as trakt_status,t.account_generation as current_trakt_generation,case when i.defaults is not null then claim.id end as claim_id from user_onboarding o
 left join invite_claims claim on claim.user_id=o.user_id left join registration_invites i on i.id=claim.invite_id
 left join provider_connections c on c.id=o.connection_id and c.user_id=o.user_id
 left join provider_connections t on t.id=o.trakt_connection_id and t.user_id=o.user_id where o.user_id=${userId}`;
 return row;
}
export async function beginOnboardingImports(userId:string) {
 const row=await onboardingRow(userId);
 if(!row||row.completed_at)throw new AppError(409,'Onboarding is already complete.');
 const jf=row.connection_status==='connected'&&row.current_generation===row.account_generation;
 const trakt=row.trakt_status==='connected'&&row.current_trakt_generation===row.trakt_account_generation;
 if(!requiredConnection(row.required_provider,jf,trakt))throw new AppError(400,'Connect the required service before continuing.');
 if(row.account_generation&&!jf||row.trakt_account_generation&&!trakt)throw new AppError(409,'Reconnect your selected services before continuing.');
 await getSql()`update user_onboarding set imports_started_at=coalesce(imports_started_at,now()) where user_id=${userId} and completed_at is null`;
 return onboardingStatus(userId);
}
async function ensureTraktImports(userId:string,row:any) {
 const db=getSql();
 for(const kind of ['trakt.import','trakt.lists-import']) {
  if(row.import_jobs?.[kind])continue;
  const id=await enqueueAction({userId,connectionId:row.trakt_connection_id,kind,payload:{initialImport:true},compactionKey:kind});
  // An integration-wide existing task may belong to another user. Never use its
  // outcome, or an ordinary import with unselected categories, as our evidence.
  const [job]=await db`select id,state,payload from outbox_actions where id=${id} and user_id=${userId} and connection_id=${row.trakt_connection_id} and account_generation=${row.trakt_account_generation}`;
  if(job?.payload?.initialImport===true)await db`update user_onboarding set import_jobs=import_jobs||${{[kind]:id}}::jsonb where user_id=${userId} and trakt_account_generation=${row.trakt_account_generation} and completed_at is null`;
 }
}
type OnboardingImport={label:string;state:string;processed:number;total:number|null;error:string|null;stage:string};
type OnboardingStatus={complete:boolean;phase:'complete'|'connections'|'importing';progress:Awaited<ReturnType<typeof libraryScanProgress>>|null;imports:OnboardingImport[];reconnect:boolean;linked:boolean;traktLinked:boolean;requiredProvider:string};
export async function onboardingStatus(userId:string):Promise<OnboardingStatus> {
 let row=await onboardingRow(userId);
 if(!row||row.completed_at)return {complete:true,phase:'complete' as const,progress:null,imports:[],reconnect:false,linked:false,traktLinked:false,requiredProvider:'none'};
 const jf=row.connection_status==='connected'&&row.current_generation===row.account_generation;
 const trakt=row.trakt_status==='connected'&&row.current_trakt_generation===row.trakt_account_generation;
 let jfAuthFailed=false,traktAuthFailed=false;
 let reconnect=!!row.account_generation&&!jf || !!row.trakt_account_generation&&!trakt;
 const imports:OnboardingImport[]=[];
 let ready=true,progress=null;
 if(row.imports_started_at){
  if(row.account_generation){
   let done=jf&&await jellyfinReady(row);
   if(!done&&jf){
    const since=new Date(row.requested_at);
    progress=await libraryScanProgress(userId,row.connection_id,since,true);
    if(progress?.state==='succeeded')done=await jellyfinReady(row);
    if(!done&&!row.claim_id&&(!progress||progress.state==='cancelled'||progress.state==='succeeded')){
     await enqueueAction({userId,connectionId:row.connection_id,kind:'jellyfin.bootstrap',payload:{},compactionKey:'jellyfin.bootstrap'});
     progress=await libraryScanProgress(userId,row.connection_id,since,true);
    }
   }
   jfAuthFailed=!!progress?.authenticationFailed;reconnect||=jfAuthFailed;
   const jfReconnect=!jf||jfAuthFailed;
   imports.push({label:'Jellyfin',state:done?'succeeded':jfReconnect?'failed':progress?.state??'pending',processed:progress?.stageProcessed??0,total:progress?.stageTotal??null,stage:done?'Complete':jellyfinImportStage(progress?.phase??'scanning'),error:jfReconnect?'Reconnect Jellyfin to continue.':progress?.error??null});ready&&=done;
  }
  if(row.trakt_account_generation){
   if(trakt)await ensureTraktImports(userId,row);
   const refreshed=await onboardingRow(userId);
   if(refreshed.account_generation!==row.account_generation||refreshed.trakt_account_generation!==row.trakt_account_generation||new Date(refreshed.requested_at).getTime()!==new Date(row.requested_at).getTime())return onboardingStatus(userId);
   row.import_jobs=refreshed.import_jobs;
   for(const kind of ['trakt.import','trakt.lists-import']){
    const id=row.import_jobs?.[kind];
    const [job]=id?await getSql()`select state,last_error,payload from outbox_actions where id=${id} and user_id=${userId} and connection_id=${row.trakt_connection_id} and account_generation=${row.trakt_account_generation}`:[];
    traktAuthFailed||=job?.payload?._jobFailure?.code==='provider.authentication';reconnect||=traktAuthFailed;
    const done=trakt&&job?.state==='succeeded';ready&&=row.claim_id&&row.account_generation ? !!job : done;
    imports.push({label:kind==='trakt.import'?'Trakt tracking':'Trakt lists',state:trakt?job?.state??'pending':'failed',processed:0,total:null,stage:kind==='trakt.import'?'Importing history, progress and favourites':'Importing saved titles and lists',error:trakt?job?.last_error??null:'Reconnect Trakt to continue.'});
   }
  }
  if(ready&&requiredConnection(row.required_provider,jf,trakt)){
   const outcome=await getSql().begin(async db=>{
     const [inviter]=await db`select i.created_by from invite_claims c join registration_invites i on i.id=c.invite_id
       where c.user_id=${userId} and c.add_inviter and c.ready_at is null`;
     if(inviter?.created_by)for(const id of [userId,String(inviter.created_by)].sort())await lockFeaturePolicyInTransaction(db,id);
     const completed=await db`update user_onboarding set completed_at=now() where user_id=${userId} and completed_at is null and date_trunc('milliseconds',requested_at)=${row.requested_at} and account_generation is not distinct from ${row.account_generation}::uuid and trakt_account_generation is not distinct from ${row.trakt_account_generation}::uuid and (account_generation is null or exists(select 1 from provider_connections c where c.id=user_onboarding.connection_id and c.account_generation=user_onboarding.account_generation and c.status='connected')) and (trakt_account_generation is null or exists(select 1 from provider_connections c where c.id=user_onboarding.trakt_connection_id and c.account_generation=user_onboarding.trakt_account_generation and c.status='connected')) returning user_id`;
     if(!completed.length)return false;
     const [claim]=await db`update invite_claims set ready_at=now() where user_id=${userId} and ready_at is null returning add_inviter,invite_id`;
     if(claim){
       await recordAccountEvent(db,'invite.ready',userId,claim.invite_id);
       if(inviter?.created_by)await addInviterFriend(db,userId,inviter.created_by);
     }
     return true;
   });
   if(outcome)return onboardingStatus(userId);
  }
 }
 return {complete:false,phase:row.imports_started_at?'importing' as const:'connections' as const,progress,imports,reconnect,linked:jf&&!jfAuthFailed,traktLinked:trakt&&!traktAuthFailed,requiredProvider:row.required_provider};
}
async function jellyfinReady(row:Awaited<ReturnType<typeof onboardingRow>>) {
 const [checkpoint]=row.claim_id
   ? await getSql()`select completed_at from sync_checkpoints where connection_id=${row.connection_id}
     and kind='jellyfin-seed' and cursor=${row.account_generation} and completed_at is not null`
   : await getSql()`select completed_at from sync_checkpoints where connection_id=${row.connection_id}
     and kind='jellyfin-personal' and completed_at>=${row.requested_at} and scan_id is null`;
 return !!checkpoint;
}

export async function retryInitialImports(userId:string) {
 const row=await onboardingRow(userId);
 if(!row||row.completed_at)throw new AppError(409,'Onboarding is already complete.');
 for(const id of Object.values(row.import_jobs??{}) as string[])await getSql()`update outbox_actions set state='pending',next_attempt_at=now(),last_error=null,updated_at=now() where id=${id} and user_id=${userId} and connection_id=${row.trakt_connection_id} and account_generation=${row.trakt_account_generation} and state in ('failed','cancelled')`;
 if(row.connection_id&&!await jellyfinReady(row))await retryOnboarding(userId);
 return onboardingStatus(userId);
}
