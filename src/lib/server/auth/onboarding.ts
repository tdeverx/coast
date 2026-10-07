import { provisioningAuthority } from '$lib/providers/jellyfin/provisioning.server';
import * as v from 'valibot';
import { getSql } from '../db';
import { registrationSchema } from '$lib/auth/registration';
import { getConfig } from '../config';
import { startTraktDevice, finishTraktDevice } from '$lib/providers/trakt/connection.server';
import { hashToken, randomToken, newSession, requireAdmin, checkLoginRate, type SessionUser } from './index';
import { AppError } from '../security/errors';
import { connectJellyfin } from '$lib/providers/jellyfin/connection.server';
import { libraryScanProgress } from '$lib/sync/jellyfin';
import { jellyfinImportStage } from '$lib/sync/jellyfin-progress';
import { enqueueAction } from '../queue';

export async function listInvites(actor: SessionUser | null) {
  requireAdmin(actor);
  return getSql()`SELECT i.id, i.provision_connection_id AS "provisionConnectionId", i.expires_at AS "expiresAt", i.used_at AS "usedAt", i.revoked_at AS "revokedAt", u.username FROM registration_invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created_at DESC LIMIT 100`;
}
export async function createInvite(actor: SessionUser | null, input: unknown) {
  const admin = requireAdmin(actor);
  const { days,provisionConnectionId,folders } = v.parse(v.strictObject({ days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(30)),provisionConnectionId:v.optional(v.pipe(v.string(),v.uuid())),folders:v.optional(v.pipe(v.array(v.pipe(v.string(),v.regex(/^(?:[a-f0-9]{32}|[a-f0-9-]{36})$/i))),v.maxLength(100)),[]) }), input);
  const authority=provisionConnectionId?await provisioningAuthority(admin.id,provisionConnectionId):null;
  if(authority){const known=await authority.adapter.virtualFolders();if(!folders.length||folders.some(id=>!known.some(folder=>folder.ItemId===id)))throw new AppError(400,'Select at least one existing Jellyfin library for the invitation.');}

  const code = randomToken();
  const expiresAt = new Date(Date.now() + days * 86400000);
  const [row] = await getSql()`INSERT INTO registration_invites (token_hash,created_by,expires_at,provision_connection_id,provision_generation,provision_folders) VALUES (${await hashToken(code)},${admin.id},${expiresAt},${provisionConnectionId??null},${authority?.connection.accountGeneration??null},${authority?JSON.stringify(folders):null}::text::jsonb) RETURNING id`;
  return { id: row.id, code, expiresAt };
}
export async function revokeInvite(actor: SessionUser | null, id: string) {
  requireAdmin(actor);
  await getSql()`UPDATE registration_invites SET revoked_at=NOW() WHERE id=${v.parse(v.pipe(v.string(),v.uuid()),id)} AND used_at IS NULL`;
}
export async function registerAccount(input: unknown, client: string) {
  checkLoginRate(`register:${client}`);
  const data = v.parse(registrationSchema, input);
  const config=await getConfig();
  if(config.registrationMode==='invite'&&!/^[A-Za-z0-9_-]{43}$/.test(data.code))throw new AppError(400,'Enter a valid invite code.');
  const tokenHash = await hashToken(data.code);
  const passwordHash = await Bun.password.hash(data.password, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 });
  try {
    const user = await getSql().begin(async sql => {
      const current=await getConfig(sql);
      const [invite]=data.code?await sql`SELECT * FROM registration_invites WHERE token_hash=${tokenHash} AND used_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE`:[];
      if((data.code||current.registrationMode==='invite')&&!invite)throw new AppError(400,'This invite code has expired, was used, or is invalid.');
      const [row] = await sql`INSERT INTO users (username,password_hash,role,settings) VALUES (${data.username},${passwordHash},'user',${{profile:{displayName:data.displayName}}}::jsonb) RETURNING id,username,email,role,settings`;
      await sql`INSERT INTO user_onboarding (user_id,required_provider) VALUES (${row.id},${invite?.provision_generation?'jellyfin':current.registrationProvider})`;
      if(invite?.provision_generation){if(!invite.provision_connection_id)throw new AppError(409,'This invitation’s provisioning account is unavailable.');await sql`insert into onboarding_provisioning(user_id,connection_id,account_generation,folders) values(${row.id},${invite.provision_connection_id},${invite.provision_generation},${JSON.stringify(invite.provision_folders)}::text::jsonb)`;}
      if(invite)await sql`UPDATE registration_invites SET used_by=${row.id},used_at=NOW() WHERE id=${invite.id}`;
      return row as SessionUser;
    });
    return newSession(user);
  } catch (cause) {
    if ((cause as { errno?: string }).errno === '23505') throw new AppError(409, 'That username is already in use.');
    throw cause;
  }
}
export async function onboardingPending(userId: string) {
  const [row] = await getSql()`SELECT user_id FROM user_onboarding WHERE user_id=${userId} AND completed_at IS NULL`;
  return !!row;
}
export async function onboardingServices() {
  return getSql()`SELECT id,name FROM provider_instances WHERE provider='jellyfin' AND enabled=TRUE AND server_identity IS NOT NULL AND settings->>'approved'='true' ORDER BY name`;
}
export async function linkOnboarding(userId: string, input: unknown) {
  if (!await onboardingPending(userId)) throw new AppError(409, 'Onboarding is already complete.');
  checkLoginRate(`onboarding:${userId}`);
  const data = v.parse(v.object({ instanceId:v.pipe(v.string(),v.uuid()),username:v.pipe(v.string(),v.minLength(1),v.maxLength(250)),password:v.pipe(v.string(),v.maxLength(4096)) }),input);
  const instance=(await onboardingServices()).find((entry:{id:string})=>entry.id===data.instanceId);
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
 await pendingOnboarding(userId);
 const {instanceId}=v.parse(v.object({instanceId:v.pipe(v.string(),v.uuid())}),input);
 if(!(await onboardingTraktServices()).some((entry:{id:string})=>entry.id===instanceId))throw new AppError(403,'Trakt is unavailable.');
 checkLoginRate(`onboarding-trakt:${userId}`);
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
 t.status as trakt_status,t.account_generation as current_trakt_generation from user_onboarding o
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
   const [checkpoint]=await getSql()`select completed_at from sync_checkpoints where connection_id=${row.connection_id} and kind='jellyfin-personal' and completed_at>=${row.requested_at} and scan_id is null`;
   const done=jf&&!!checkpoint;
   if(!done&&jf){await enqueueAction({userId,connectionId:row.connection_id,kind:'jellyfin.bootstrap',payload:{},compactionKey:'jellyfin.bootstrap'});progress=await libraryScanProgress(userId,row.connection_id,new Date(row.requested_at),true);}
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
    const done=trakt&&job?.state==='succeeded';ready&&=done;
    imports.push({label:kind==='trakt.import'?'Trakt tracking':'Trakt lists',state:trakt?job?.state??'pending':'failed',processed:0,total:null,stage:kind==='trakt.import'?'Importing history, progress and favourites':'Importing saved titles and lists',error:trakt?job?.last_error??null:'Reconnect Trakt to continue.'});
   }
  }
  if(ready&&requiredConnection(row.required_provider,jf,trakt)){
   const completed=await getSql()`update user_onboarding set completed_at=now() where user_id=${userId} and completed_at is null and date_trunc('milliseconds',requested_at)=${row.requested_at} and account_generation is not distinct from ${row.account_generation}::uuid and trakt_account_generation is not distinct from ${row.trakt_account_generation}::uuid and (account_generation is null or exists(select 1 from provider_connections c where c.id=user_onboarding.connection_id and c.account_generation=user_onboarding.account_generation and c.status='connected')) and (trakt_account_generation is null or exists(select 1 from provider_connections c where c.id=user_onboarding.trakt_connection_id and c.account_generation=user_onboarding.trakt_account_generation and c.status='connected')) returning user_id`;
   if(completed.length)return {...await onboardingStatus(userId)};
  }
 }
 return {complete:false,phase:row.imports_started_at?'importing' as const:'connections' as const,progress,imports,reconnect,linked:jf&&!jfAuthFailed,traktLinked:trakt&&!traktAuthFailed,requiredProvider:row.required_provider};
}
export async function retryInitialImports(userId:string) {
 const row=await pendingOnboarding(userId);
 for(const id of Object.values(row.import_jobs??{}) as string[])await getSql()`update outbox_actions set state='pending',next_attempt_at=now(),last_error=null,updated_at=now() where id=${id} and user_id=${userId} and connection_id=${row.trakt_connection_id} and account_generation=${row.trakt_account_generation} and state in ('failed','cancelled')`;
 if(row.connection_id){const [checkpoint]=await getSql()`select completed_at from sync_checkpoints where connection_id=${row.connection_id} and kind='jellyfin-personal' and completed_at>=${row.requested_at} and scan_id is null`;if(!checkpoint)await retryOnboarding(userId);}
 return onboardingStatus(userId);
}
