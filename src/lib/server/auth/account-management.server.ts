import * as v from 'valibot';
import { sql } from 'drizzle-orm';
import { getDb, getSql, type Database } from '../db';
import { AppError } from '../security/errors';
import { hashToken, requireAdmin, type SessionUser } from './index';
import { inviteDefaultsSchema, inviteLimit, jellyfinUserId, uuid, type CoastAccess, type InviteDefaults } from '#lib/auth/invites.js';
import { jellyfinItemKey } from '#lib/providers/jellyfin/paging.js';
import { applyJellyfinPreset, managedAccountAuthority, validatePresetLibraries } from '#lib/providers/jellyfin/provisioning.server.js';
import { enqueueInTransaction } from '#lib/sync/changes.server.js';
import type { OutboxAction } from '../queue';
import { assertJobLease } from '../queue/execution';
import { recordAccountEvent } from './invites.server';
import { notifyMany } from '../notifications';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Remote = {user_id:string;connection_id:string|null;authority_instance_id:string|null;account_generation:string;remote_id:string|null;lifecycle:string;admin_id:string|null;version:string};
type RemoteOperation = 'disable'|'restore'|'apply';
const idBatch = v.pipe(v.array(uuid),v.minLength(1),v.maxLength(20));
const timestamp = v.pipe(v.string(),v.isoTimestamp());
const remoteInTransaction = async (tx:Tx,userId:string) => [...await tx.execute<Remote>(sql`select p.user_id,p.connection_id,p.authority_instance_id,p.account_generation,p.remote_id,p.lifecycle,c.user_id as admin_id,p.xmin::text as version
  from onboarding_provisioning p left join provider_connections c on c.id=p.connection_id
  where p.user_id=${userId} and p.state='complete' for no key update of p`)] as Remote[];

async function stopLocalSessions(tx:Tx,userId:string) {
  await tx.execute(sql`delete from sessions where user_id=${userId}`);
  await tx.execute(sql`update api_tokens set revoked_at=now() where user_id=${userId} and revoked_at is null`);
  await tx.execute(sql`update playback_sessions set state='stopped',cleanup_pending=true
    where user_id=${userId} and state in ('active','paused','prepared') and expires_at>now()`);
}

async function queueRemote(tx:Tx,target:Remote,operation:RemoteOperation,reason:'manual'|'expiry'|'access',defaults?:InviteDefaults,actorId?:string) {
  const owner=target.authority_instance_id?target.user_id:target.admin_id;
  if (!owner || !target.remote_id || !target.authority_instance_id&&!target.connection_id) {
    await tx.execute(sql`update onboarding_provisioning set lifecycle='failed' where user_id=${target.user_id}`);
    return;
  }
  const [change]=await tx.execute<{version:string}>(sql`update onboarding_provisioning set lifecycle=${operation+'-pending'},updated_at=now()
    where user_id=${target.user_id} returning xmin::text as version`);
  await enqueueInTransaction(tx,{userId:owner,connectionId:target.connection_id??undefined,kind:'jellyfin.member-policy',
    payload:{userId:target.user_id,actorId,version:change.version,operation,reason,previousVersion:target.version,restoreExpiry:target.lifecycle==='disabled-expiry',...(defaults ? {defaults} : {})},
    compactionKey:'member-policy:'+target.user_id});
}

function writeAccess(tx:Tx,userId:string,access:CoastAccess,sharingGrant:boolean|null) {
  return tx.execute(sql`update users set access_defaults=${access}::jsonb,settings=case
    when ${sharingGrant}::boolean is null then settings
    else settings || jsonb_build_object('allowPlaybackSharing', ${sharingGrant}::boolean,
      'featurePermissions',coalesce(settings->'featurePermissions','{}'::jsonb)||jsonb_build_object('sharing',${sharingGrant}::boolean))
    end where id=${userId}`);
}

function shareGrant(defaults:InviteDefaults) {
  if(defaults.access.sharing===false)return false;
  return defaults.sharingGrant??null;
}

export async function accountDetails(actor:SessionUser|null,userId:string) {
  requireAdmin(actor);
  const db = getSql();
  const [data]=await db<{
    id:string;username:string;role:'admin'|'user';disabled:boolean;access:CoastAccess;expiresAt:Date|null;expired:boolean;provisioning:string|null;
    remote:string|null;remoteState:string|null;setupStarted:Date|null;readyAt:Date|null;inviter:string|null;lastActiveAt:Date|null;
    memberPreset:string|null;quota:number|null;remoteFailure:boolean;source:string;defaults:InviteDefaults|null;authority:string|null;authorityName:string|null;presetName:string|null;sharingGranted:boolean;
  }[]>`select u.id,u.username,u.role,u.disabled,u.access_defaults as access,u.membership_expires_at as "expiresAt",
    coalesce(u.settings#>>'{featurePermissions,sharing}',u.settings->>'allowPlaybackSharing','false')='true' as "sharingGranted",
    coalesce(u.membership_expires_at<=now(),false) as expired,
    p.state as provisioning,p.remote_id as remote,p.lifecycle as "remoteState",p.active_defaults as defaults,coalesce(p.authority_instance_id,p.connection_id) as authority,server.name as "authorityName",i.preset_name as "presetName",o.requested_at as "setupStarted",o.completed_at as "readyAt",
    issuer.username as inviter,seen.active_at as "lastActiveAt",g.preset_id as "memberPreset",g.quota,
    case when claim.id is not null then 'Invitation' when o.user_id is not null then 'Registration' else 'Administrator' end as source,
    exists(select 1 from outbox_actions task where task.user_id=case when p.authority_instance_id is not null then p.user_id else authority.user_id end and task.connection_id is not distinct from p.connection_id
      and task.compaction_key='member-policy:'||p.user_id::text and task.kind='jellyfin.member-policy' and task.state='failed'
      and task.payload->>'version'=p.xmin::text) as "remoteFailure"
    from users u left join user_onboarding o on o.user_id=u.id left join onboarding_provisioning p on p.user_id=u.id
    left join provider_connections authority on authority.id=p.connection_id
    left join provider_instances server on server.id=coalesce(p.authority_instance_id,authority.instance_id)
    left join user_presence seen on seen.user_id=u.id
    left join invite_claims claim on claim.user_id=u.id left join registration_invites i on i.id=claim.invite_id left join users issuer on issuer.id=i.created_by
    left join member_invite_grants g on g.user_id=u.id where u.id=${v.parse(uuid,userId)}`;
  if(!data)throw new AppError(404,'Account not found.');
  const [connections,audit]=await Promise.all([
    db<{name:string;username:string|null;status:string}[]>`select i.name,c.username,c.status
      from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=${data.id} order by i.name,c.id limit 20`,
    db<{id:string;event:string;createdAt:Date}[]>`select id,event,created_at as "createdAt" from account_audit
      where subject_id=${data.id} order by created_at desc,id desc limit ${inviteLimit}`,
  ]);
  return {...data,connections,audit};
}

export async function manageAccount(actor:SessionUser|null,userId:string,raw:unknown) {
  const admin=requireAdmin(actor);
  v.parse(uuid,userId);
  const {action,expiresAt}=v.parse(v.strictObject({action:v.picklist(['revoke-sessions','membership','jellyfin-disable','jellyfin-restore']),
    expiresAt:v.optional(v.nullable(timestamp))}),raw);
  if(admin.id===userId)throw new AppError(400,'Choose another account.');
  if(action==='membership' && expiresAt && Date.parse(expiresAt)<=Date.now())throw new AppError(400,'Choose a future membership expiry.');
  await getDb().transaction(async tx=>{
    const [user]=await tx.execute<{role:string;expired:boolean;applied:boolean}>(sql`select role,
      coalesce(membership_expires_at<=now(),false) as expired,membership_expired_at is not null as applied
      from users where id=${userId} for no key update`);
    if(!user)throw new AppError(404,'Account not found.');
    if(action==='revoke-sessions')await stopLocalSessions(tx,userId);
    else {
      if(user.role!=='user')throw new AppError(409,'This operation is available for member accounts.');
      const [remote]=await remoteInTransaction(tx,userId);
      if(action==='membership') {
        if(expiresAt===undefined)throw new AppError(400,'Choose an expiry date, or clear expiry.');
        const changed=await tx.execute(sql`update users set membership_expires_at=${expiresAt}::timestamptz,membership_expired_at=null
          where id=${userId} and membership_expires_at is distinct from ${expiresAt}::timestamptz returning id`);
        if(!changed.length)return;
        await tx.execute(sql`delete from notifications where user_id=${userId} and kind='membership-expiry'`);
        if(user.expired||user.applied)await stopLocalSessions(tx,userId);
        if(remote && (user.expired||user.applied)){
          const [pending]=remote.lifecycle==='disable-pending' ? await tx.execute<{eligible:boolean}>(sql`select true as eligible from outbox_actions
            where user_id=${remote.authority_instance_id?remote.user_id:remote.admin_id} and connection_id is not distinct from ${remote.connection_id}::uuid and compaction_key=${'member-policy:'+userId}
              and payload->>'version'=${remote.version} and payload->>'reason'='expiry' limit 1`) : [];
          if(remote.lifecycle==='disabled-expiry'||pending?.eligible)await queueRemote(tx,remote,'restore','expiry',undefined,admin.id);
        }
      } else {
        if(!remote)throw new AppError(409,'This Jellyfin account is managed outside Coast.');
        if(action==='jellyfin-restore'&&user.expired)throw new AppError(409,'Renew the membership before restoring Jellyfin access.');
        await queueRemote(tx,remote,action==='jellyfin-disable'?'disable':'restore','manual',undefined,admin.id);
        if(action==='jellyfin-disable')await stopLocalSessions(tx,userId);
      }
    }
    await tx.execute(sql`insert into account_audit(event,actor_id,subject_id) values(${'account.'+action},${admin.id},${userId})`);
  });
  return {ok:true};
}

export async function expireMemberships() {
  await getDb().transaction(async tx=>{
    const [sweep]=await tx.execute<{locked:boolean}>(sql`select pg_try_advisory_xact_lock(hashtextextended('coast:membership-expiry',0)) as locked`);
    if(!sweep.locked)return;
    const approaching=await tx.execute<{id:string;key:string}>(sql`
      select id,'membership-expiry:'||extract(epoch from membership_expires_at)::text as key
      from users where membership_expires_at>now() and membership_expires_at<=now()+interval '7 days'
        and membership_expired_at is null and not disabled and not exists(
          select 1 from notifications where user_id=users.id
            and source_key='membership-expiry:'||extract(epoch from users.membership_expires_at)::text)
      order by membership_expires_at,id limit 20 for no key update of users skip locked`);
    await notifyMany(approaching.map(({id,key})=>({userId:id,sourceKey:key,kind:'membership-expiry',
      title:'Your Coast membership expires soon',body:'Ask a Coast administrator to renew your membership.',level:'persistent'})),tx);
    const rows=await tx.execute<{id:string}>(sql`select id from users where membership_expires_at<=now() and membership_expired_at is null
      order by membership_expires_at,id limit 20 for no key update skip locked`);
    for (const {id} of rows) {
      await tx.execute(sql`update users set membership_expired_at=now() where id=${id}`);
      await stopLocalSessions(tx,id);
      await tx.execute(sql`update registration_invites set revoked_at=now()
        where created_by=${id} and member_issued and revoked_at is null and claim_count<max_uses`);
      const [remote]=await remoteInTransaction(tx,id);
      if(remote && !['disabled-manual','disabled-external','disable-pending','disabled-expiry'].includes(remote.lifecycle))await queueRemote(tx,remote,'disable','expiry');
      await tx.execute(sql`insert into account_audit(event,subject_id) values('account.expired',${id})`);
    }
  });
}

export async function executeMemberPolicy(job:OutboxAction) {
  const {userId,actorId,version,operation,reason,defaults,previousVersion,restoreExpiry}=v.parse(v.object({userId:uuid,actorId:v.optional(uuid),version:v.string(),operation:v.picklist(['disable','restore','apply']),
    reason:v.picklist(['manual','expiry','access']),defaults:v.optional(inviteDefaultsSchema),previousVersion:v.optional(v.string()),restoreExpiry:v.optional(v.boolean())}),job.payload);
  const db=getSql();
  const [target]=await db`select p.*,c.user_id as admin_id,u.disabled,u.membership_expired_at,coalesce(u.membership_expires_at<=now(),false) as expired
    from onboarding_provisioning p join users u on u.id=p.user_id left join provider_connections c on c.id=p.connection_id
    where p.user_id=${userId} and p.connection_id is not distinct from ${job.connectionId??null}::uuid
      and case when p.authority_instance_id is not null then p.user_id else c.user_id end=${job.userId}::uuid
      and p.xmin::text=${version} and p.state='complete'`;
  if(!target)return;
  const authority=await managedAccountAuthority(target as Parameters<typeof managedAccountAuthority>[0]);
  const remote=await authority.adapter.userForProvisioning(target.remote_id);
  if(remote.Policy.IsAdministrator!==false)throw new AppError(403,'Managed accounts must be non-administrators.');
  let lifecycle='active';
  if(operation==='disable') {
    if(reason==='expiry'&&!target.expired)return;
    if(remote.Policy.IsDisabled===true)lifecycle=reason==='manual'?'disabled-manual':'disabled-external';
    else {
      // Record ownership before calling Jellyfin so a lost response is safe to retry.
      const marked=await stampDisableOwnership(job.id,version,userId,reason);
      if(!marked)return;
      await authority.adapter.setProvisionPolicy(target.remote_id,{...remote.Policy,IsDisabled:true});
      lifecycle=reason==='manual'?'disabled-manual':'disabled-expiry';
    }
    if(reason==='expiry'&&lifecycle==='disabled-external'){
      const [evidence]=await db`select payload->>'disabledByCoast' as owned from outbox_actions where id=${job.id}`;
      if(evidence?.owned==='true')lifecycle='disabled-expiry';
    }
  } else if(operation==='restore') {
    if(target.expired)throw new AppError(409,'Renew this membership first.');
    const wasDisabled = remote.Policy.IsDisabled===true;
    const [previous]=reason==='expiry' && previousVersion ? await db`select 1 from outbox_actions
      where user_id=${job.userId} and connection_id is not distinct from ${job.connectionId??null}::uuid and compaction_key=${'member-policy:'+userId}
      and payload->>'version'=${previousVersion} and payload->>'disabledByCoast'='true' limit 1` : [];
    if(wasDisabled && (reason==='manual'||restoreExpiry||previous))
      await authority.adapter.setProvisionPolicy(target.remote_id,{...remote.Policy,IsDisabled:false});
    else if(wasDisabled)lifecycle='disabled-external';
  } else if(defaults) {
    await validatePresetLibraries(authority.adapter,defaults.folders,defaults.jellyfin);
    await applyJellyfinPreset(authority.adapter,target.remote_id,remote,defaults,userId,remote.Policy.IsDisabled===true,target.active_defaults?.jellyfin);
    if(remote.Policy.IsDisabled===true)lifecycle='disabled-external';
  }
  await getDb().transaction(async tx=>{
    await assertJobLease(tx,true);
    await tx.execute(sql`select id from users where id=${userId} for no key update`);
    const rows=await tx.execute(sql`update onboarding_provisioning set lifecycle=${lifecycle},updated_at=now(),
      access_after=case when ${operation}<>'disable' then now() else access_after end,
      active_defaults=case when ${operation}='apply' then ${defaults??null}::jsonb else active_defaults end
      where user_id=${userId} and xmin::text=${version} returning user_id`);
    if(!rows.length)return;
    if (operation==='apply' && defaults) {
      await writeAccess(tx,userId,defaults.access,shareGrant(defaults));
      const [member]=await tx.execute<{id:string}>(sql`select c.id from provider_connections c
        where c.instance_id=${authority.instance.id} and c.user_id=${userId} and c.status='connected' limit 1`);
      if(member && lifecycle==='active')await enqueueInTransaction(tx,{userId,connectionId:member.id,kind:'jellyfin.sync',
        payload:{_jobPurpose:'scheduled'},compactionKey:'jellyfin.sync'});
    }
    await tx.execute(sql`insert into account_audit(event,actor_id,subject_id)
      values(${'jellyfin.'+operation},(select id from users where id=${actorId??target.admin_id??null}::uuid),${userId})`);
  });
}

async function stampDisableOwnership(jobId:string, version:string,userId:string, reason:string) {
  const rows=await getSql()`update outbox_actions set payload=payload||jsonb_build_object('disabledByCoast',${reason==='expiry'}::boolean)
    where id=${jobId} and exists(select 1 from onboarding_provisioning where user_id=${userId} and xmin::text=${version}) returning id`;
  return rows.length>0;
}

export async function reviewProvisioning(actor:SessionUser|null,userId:string,raw:unknown) {
  const admin=requireAdmin(actor);
  const {remoteId,verifiedAbsent}=v.parse(v.pipe(v.strictObject({
    remoteId:v.optional(jellyfinUserId),
    verifiedAbsent:v.optional(v.literal(true)),
  }),v.check(value=>!!value.remoteId!==!!value.verifiedAbsent,'Choose one reviewed outcome.')),raw);
  const db=getSql();
  const [target]=await db`select p.*,u.username,c.user_id as admin_id from onboarding_provisioning p
    join users u on u.id=p.user_id left join provider_connections c on c.id=p.connection_id
    where p.user_id=${v.parse(uuid,userId)} and p.remote_id is null and (p.state='uncertain' or p.state='creating' and p.updated_at<now()-interval '2 minutes')`;
  if(!target)throw new AppError(409,'This account has no uncertain Jellyfin creation to review.');
  const {adapter,instance}=await managedAccountAuthority(target as Parameters<typeof managedAccountAuthority>[0]);
  if(verifiedAbsent)return db.begin(async tx=>{
    const [reviewed]=await tx`update onboarding_provisioning set state='pending',updated_at=now()
      where user_id=${userId} and remote_id is null and state=${target.state} and date_trunc('milliseconds',updated_at)=${target.updated_at} returning user_id`;
    if(!reviewed)throw new AppError(409,'This claim was updated. Reload and try again.');
    await recordAccountEvent(tx,'invite.provisioning-retry-approved',admin.id,userId);
    return {ok:true};
  });
  const remote=await adapter.userForProvisioning(remoteId!);
  if(remote.Policy.IsAdministrator!==false || remote.Name.toLowerCase()!==target.username.toLowerCase() || jellyfinItemKey(remote.Id)!==jellyfinItemKey(remoteId!))
    throw new AppError(409,'That Jellyfin account does not match this claim.');
  return db.begin(async tx=>{
    const [bound]=await tx`select user_id from provider_connections where instance_id=${instance.id} and replace(lower(external_user_id),'-','')=${jellyfinItemKey(remote.Id)}`;
    if(bound)throw new AppError(409,'That Jellyfin user is already connected.');
    const [reviewed]=await tx`update onboarding_provisioning set remote_id=${remote.Id},state='configuring',updated_at=now()
      where user_id=${userId} and remote_id is null and state=${target.state} returning user_id`;
    if(!reviewed)throw new AppError(409,'This claim was updated. Reload and try again.');
    await recordAccountEvent(tx,'invite.provisioning-reviewed',admin.id,userId);
    return {ok:true};
  });
}

const accessRequest = v.pipe(v.strictObject({users:idBatch,presetId:v.optional(uuid),defaults:v.optional(inviteDefaultsSchema),
  confirm:v.optional(v.record(uuid,v.string()))}),
  v.check(input=>!!input.presetId!==!!input.defaults, 'Choose a preset or edit the account directly.'));
export async function changeMemberAccess(actor:SessionUser|null,raw:unknown) {
  const admin=requireAdmin(actor);
  const input=v.parse(accessRequest,raw);
  const ids=[...new Set(input.users)].sort();
  if(ids.includes(admin.id))throw new AppError(400,'Choose other accounts.');
  if(input.defaults&&ids.length!==1)throw new AppError(400,'Edit one account or use a saved preset for bulk changes.');
  const draftVersion=input.defaults ? await hashToken(JSON.stringify(input.defaults)) : null;
  return getDb().transaction(async tx=>{
    const [preset]=input.presetId ? await tx.execute<{defaults:InviteDefaults;name:string;version:string}>(sql`
      select defaults,name,xmin::text as version from invite_presets where id=${input.presetId}`) : [];
    if(input.presetId&&!preset)throw new AppError(404,'Preset not found.');
    const defaults=input.defaults??v.parse(inviteDefaultsSchema,preset.defaults);
    const revision=draftVersion??preset.version;
    const targets=await tx.execute<{id:string;username:string;access:CoastAccess;version:string;authority:string|null;managed:boolean;current:InviteDefaults|null;lifecycle:string|null;sharing_granted:boolean}>(sql`
      select u.id,u.username,u.access_defaults as access,concat(u.xmin::text,'/',p.xmin::text,'/',${revision}::text) as version,
       coalesce(p.authority_instance_id,p.connection_id) as authority,p.lifecycle,coalesce(u.settings#>>'{featurePermissions,sharing}',u.settings->>'allowPlaybackSharing','false')='true' as sharing_granted,coalesce(p.state='complete',false) as managed,p.active_defaults as current
      from users u left join onboarding_provisioning p on p.user_id=u.id
      where u.id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}) and u.role='user'
      order by u.id ${input.confirm ? sql`for no key update of u` : sql``}`);
    if(targets.length!==ids.length)throw new AppError(409,'Choose current member accounts.');
    const provider=defaults.account!=='coast';
    if(provider && targets.some(item=>!item.managed||item.authority!==defaults.connectionId||!['','active','apply-pending'].includes(item.lifecycle??'')))
      throw new AppError(409,'Select managed accounts on the Jellyfin authority used by the preset.');
    if(!provider && targets.some(item=>item.lifecycle==='apply-pending'))
      throw new AppError(409,'Wait for the current Jellyfin access change before editing Coast permissions.');
    if(defaults.sharingGrant&&!provider&&targets.some(item=>item.current?.access.libraryOnly))
      throw new AppError(409,'This account’s Jellyfin restrictions block playback sharing.');
    const grant=shareGrant(defaults);
    const versions=Object.fromEntries(targets.map(item=>[item.id,item.version]));
    const changes=targets.map(item=>{
      // A Coast-only edit cannot lift the restrictions of the applied Jellyfin policy.
      const after=!provider && item.current?.access.libraryOnly ? {...defaults.access,libraryOnly:true} : defaults.access;
      return {id:item.id,username:item.username,before:item.access,after,
        sharing:{before:item.sharing_granted,after:grant??item.sharing_granted},jellyfin:provider ? {
        before:item.current?.jellyfin??{},after:defaults.jellyfin,foldersBefore:item.current?.folders??[],foldersAfter:defaults.folders,
        preferencesBefore:item.current?.jellyfinConfiguration??{},preferencesAfter:defaults.jellyfinConfiguration??{},
      } : null};
    });
    if(!input.confirm)return {versions,changes};
    if(ids.some(id=>input.confirm?.[id]!==versions[id])||Object.keys(input.confirm).length!==ids.length)
      throw new AppError(409,'The accounts or preset changed. Preview the changes again.');
    for(const item of changes) {
      if(provider){
        // Keep all existing restrictions until Jellyfin verifies the requested policy.
        const fenced:CoastAccess={...item.before,...item.after};
        if(item.before.libraryOnly||item.after.libraryOnly)fenced.libraryOnly=true;
        await writeAccess(tx,item.id,fenced,grant===false ? false : null);
        const [remote]=await remoteInTransaction(tx,item.id);
        await queueRemote(tx,remote,'apply','access',defaults,admin.id);
      } else {
        await writeAccess(tx,item.id,item.after,grant);
      }
      const changesForAudit={preset:preset?.name??null,access:describeChanges({...item.before,sharingGrant:item.sharing.before},{...item.after,sharingGrant:item.sharing.after}),
        ...item.jellyfin && {
          jellyfin:describeChanges({...item.jellyfin.before,EnabledFolders:item.jellyfin.foldersBefore},
            {...item.jellyfin.after,EnabledFolders:item.jellyfin.foldersAfter}),
          preferences:describeChanges(item.jellyfin.preferencesBefore,item.jellyfin.preferencesAfter),
        }};
      await tx.execute(sql`insert into account_audit(event,actor_id,subject_id,details)
        values('account.access-updated',${admin.id},${item.id},${changesForAudit}::jsonb)`);
    }
    return {ok:true};
  });
}

function describeChanges(before:Record<string,unknown>,after:Record<string,unknown>) {
  return Object.fromEntries([...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>
    JSON.stringify(before[key])===JSON.stringify(after[key]) ? [] : [[key,{before:before[key]??null,after:after[key]??null}]]));
}
