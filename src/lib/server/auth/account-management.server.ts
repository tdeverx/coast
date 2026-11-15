import * as v from 'valibot';
import { sql } from 'drizzle-orm';
import { getDb, getSql, type Database } from '../db';
import { AppError } from '../security/errors';
import { requireAdmin, type SessionUser } from './index';
import { inviteDefaultsSchema, inviteLimit, jellyfinUserId, uuid, type CoastAccess, type InviteDefaults } from '#lib/auth/invites.js';
import { jellyfinItemKey } from '#lib/providers/jellyfin/paging.js';
import { provisionPolicy, provisioningAuthority, verifyProvisionPolicy } from '#lib/providers/jellyfin/provisioning.server.js';
import { enqueueInTransaction } from '#lib/sync/changes.server.js';
import type { OutboxAction } from '../queue';
import { assertJobLease } from '../queue/execution';
import { recordAccountEvent } from './invites.server';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Remote = {user_id:string;connection_id:string|null;account_generation:string;remote_id:string|null;lifecycle:string;admin_id:string|null;version:string};
type RemoteOperation = 'disable'|'restore'|'apply';
const idBatch = v.pipe(v.array(uuid),v.minLength(1),v.maxLength(20));
const timestamp = v.pipe(v.string(),v.isoTimestamp());
const remoteInTransaction = async (tx:Tx,userId:string) => [...await tx.execute<Remote>(sql`select p.user_id,p.connection_id,p.account_generation,p.remote_id,p.lifecycle,c.user_id as admin_id,p.xmin::text as version
  from onboarding_provisioning p left join provider_connections c on c.id=p.connection_id
  where p.user_id=${userId} and p.state='complete' for no key update of p`)] as Remote[];

async function stopLocalSessions(tx:Tx,userId:string) {
  await tx.execute(sql`delete from sessions where user_id=${userId}`);
  await tx.execute(sql`update api_tokens set revoked_at=now() where user_id=${userId} and revoked_at is null`);
  await tx.execute(sql`update playback_sessions set state='stopped',cleanup_pending=true
    where user_id=${userId} and state in ('active','paused','prepared') and expires_at>now()`);
}

async function queueRemote(tx:Tx,target:Remote,operation:RemoteOperation,reason:'manual'|'expiry'|'access',defaults?:InviteDefaults) {
  if (!target.admin_id || !target.connection_id || !target.remote_id) {
    await tx.execute(sql`update onboarding_provisioning set lifecycle='failed' where user_id=${target.user_id}`);
    return;
  }
  const [change]=await tx.execute<{version:string}>(sql`update onboarding_provisioning set lifecycle=${operation+'-pending'},updated_at=now()
    where user_id=${target.user_id} returning xmin::text as version`);
  await enqueueInTransaction(tx,{userId:target.admin_id,connectionId:target.connection_id,kind:'jellyfin.member-policy',
    payload:{userId:target.user_id,version:change.version,operation,reason,previousVersion:target.version,restoreExpiry:target.lifecycle==='disabled-expiry',...(defaults ? {defaults} : {})},
    compactionKey:'member-policy:'+target.user_id});
}

export async function accountDetails(actor:SessionUser|null,userId:string) {
  requireAdmin(actor);
  const db = getSql();
  const [data]=await db<{
    id:string;username:string;role:'admin'|'user';disabled:boolean;access:CoastAccess;expiresAt:Date|null;expired:boolean;provisioning:string|null;
    remote:string|null;remoteState:string|null;setupStarted:Date|null;readyAt:Date|null;inviter:string|null;lastActiveAt:Date|null;
    memberPreset:string|null;quota:number|null;remoteFailure:boolean;source:string;
  }[]>`select u.id,u.username,u.role,u.disabled,u.access_defaults as access,u.membership_expires_at as "expiresAt",
    coalesce(u.membership_expires_at<=now(),false) as expired,
    p.state as provisioning,p.remote_id as remote,p.lifecycle as "remoteState",o.requested_at as "setupStarted",o.completed_at as "readyAt",
    issuer.username as inviter,seen.active_at as "lastActiveAt",g.preset_id as "memberPreset",g.quota,
    case when claim.id is not null then 'Invitation' when o.user_id is not null then 'Registration' else 'Administrator' end as source,
    exists(select 1 from outbox_actions task where task.user_id=authority.user_id and task.connection_id=p.connection_id
      and task.compaction_key='member-policy:'||p.user_id::text and task.kind='jellyfin.member-policy' and task.state='failed'
      and task.payload->>'version'=p.xmin::text) as "remoteFailure"
    from users u left join user_onboarding o on o.user_id=u.id left join onboarding_provisioning p on p.user_id=u.id
    left join provider_connections authority on authority.id=p.connection_id
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
        await tx.execute(sql`update users set membership_expires_at=${expiresAt}::timestamptz,membership_expired_at=null where id=${userId}`);
        if(user.expired||user.applied)await stopLocalSessions(tx,userId);
        if(remote && (user.expired||user.applied)){
          const [pending]=remote.lifecycle==='disable-pending' ? await tx.execute<{eligible:boolean}>(sql`select true as eligible from outbox_actions
            where user_id=${remote.admin_id} and connection_id=${remote.connection_id} and compaction_key=${'member-policy:'+userId}
              and payload->>'version'=${remote.version} and payload->>'reason'='expiry' limit 1`) : [];
          if(remote.lifecycle==='disabled-expiry'||pending?.eligible)await queueRemote(tx,remote,'restore','expiry');
        }
      } else {
        if(!remote)throw new AppError(409,'This Jellyfin account is managed outside Coast.');
        if(action==='jellyfin-restore'&&user.expired)throw new AppError(409,'Renew the membership before restoring Jellyfin access.');
        await queueRemote(tx,remote,action==='jellyfin-disable'?'disable':'restore','manual');
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
  const {userId,version,operation,reason,defaults,previousVersion,restoreExpiry}=v.parse(v.object({userId:uuid,version:v.string(),operation:v.picklist(['disable','restore','apply']),
    reason:v.picklist(['manual','expiry','access']),defaults:v.optional(inviteDefaultsSchema),previousVersion:v.optional(v.string()),restoreExpiry:v.optional(v.boolean())}),job.payload);
  const db=getSql();
  const [target]=await db`select p.*,u.disabled,u.membership_expired_at,coalesce(u.membership_expires_at<=now(),false) as expired
    from onboarding_provisioning p join users u on u.id=p.user_id where p.user_id=${userId} and p.connection_id=${job.connectionId}
      and p.xmin::text=${version} and p.state='complete'`;
  if(!target)return;
  const authority=await provisioningAuthority(job.userId,target.connection_id,target.account_generation);
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
      where user_id=${job.userId} and connection_id=${job.connectionId} and compaction_key=${'member-policy:'+userId}
      and payload->>'version'=${previousVersion} and payload->>'disabledByCoast'='true' limit 1` : [];
    if(wasDisabled && (reason==='manual'||restoreExpiry||previous))
      await authority.adapter.setProvisionPolicy(target.remote_id,{...remote.Policy,IsDisabled:false});
    else if(wasDisabled)lifecycle='disabled-external';
  } else if(defaults) {
    const folders=new Set((await authority.adapter.virtualFolders()).map(folder=>folder.ItemId));
    if(defaults.folders.some(folder=>!folders.has(folder)))throw new AppError(409,'A selected Jellyfin library no longer exists.');
    const expected={...provisionPolicy(remote.Policy,defaults.folders,defaults.jellyfin),IsDisabled:remote.Policy.IsDisabled===true};
    await authority.adapter.setProvisionPolicy(target.remote_id,expected);
    verifyProvisionPolicy((await authority.adapter.userForProvisioning(target.remote_id)).Policy,expected,defaults.jellyfin);
    if(expected.IsDisabled)lifecycle='disabled-external';
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
      await tx.execute(sql`update users set access_defaults=${defaults.access}::jsonb where id=${userId}`);
      const [member]=await tx.execute<{id:string}>(sql`select c.id from provider_connections c join provider_connections a on a.instance_id=c.instance_id
        where a.id=${job.connectionId} and c.user_id=${userId} and c.status='connected' limit 1`);
      if(member && lifecycle==='active')await enqueueInTransaction(tx,{userId,connectionId:member.id,kind:'jellyfin.sync',
        payload:{_jobPurpose:'scheduled'},compactionKey:'jellyfin.sync'});
    }
    await tx.execute(sql`insert into account_audit(event,actor_id,subject_id) values(${'jellyfin.'+operation},${job.userId},${userId})`);
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
  const [target]=await db`select p.*,u.username,c.user_id as authority from onboarding_provisioning p
    join users u on u.id=p.user_id join provider_connections c on c.id=p.connection_id
    where p.user_id=${v.parse(uuid,userId)} and p.remote_id is null and (p.state='uncertain' or p.state='creating' and p.updated_at<now()-interval '2 minutes')`;
  if(!target)throw new AppError(409,'This account has no uncertain Jellyfin creation to review.');
  const {adapter,instance}=await provisioningAuthority(target.authority,target.connection_id,target.account_generation);
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

const accessRequest = v.strictObject({users:idBatch,presetId:uuid,confirm:v.optional(v.record(uuid,v.string()))});
export async function changeMemberAccess(actor:SessionUser|null,raw:unknown) {
  const admin=requireAdmin(actor);
  const input=v.parse(accessRequest,raw);
  const ids=[...new Set(input.users)].sort();
  if(ids.includes(admin.id))throw new AppError(400,'Choose other accounts.');
  return getDb().transaction(async tx=>{
    const [preset]=await tx.execute<{defaults:InviteDefaults;name:string;version:string}>(sql`select defaults,name,xmin::text as version from invite_presets where id=${input.presetId}`);
    if(!preset)throw new AppError(404,'Preset not found.');
    const targets=await tx.execute<{id:string;username:string;access:CoastAccess;version:string;authority:string|null;managed:boolean;current:InviteDefaults|null;lifecycle:string|null}>(sql`
      select u.id,u.username,u.access_defaults as access,concat(u.xmin::text,'/',p.xmin::text,'/',${preset.version}::text) as version,
       p.connection_id as authority,p.lifecycle,coalesce(p.state='complete',false) as managed,p.active_defaults as current
      from users u left join onboarding_provisioning p on p.user_id=u.id
      where u.id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}) and u.role='user'
      order by u.id ${input.confirm ? sql`for no key update of u` : sql``}`);
    if(targets.length!==ids.length)throw new AppError(409,'Choose current member accounts.');
    const defaults=preset.defaults;
    const versions=Object.fromEntries(targets.map(item=>[item.id,item.version]));
    const provider=defaults.account!=='coast';
    if(provider && targets.some(item=>!item.managed||item.authority!==defaults.connectionId||!['','active','apply-pending'].includes(item.lifecycle??'')))
      throw new AppError(409,'Select managed accounts on the Jellyfin authority used by the preset.');
    if(!input.confirm)return {versions,changes:targets.map(item=>({id:item.id,username:item.username,
      before:item.access,after:defaults.access,jellyfin:provider ? {before:item.current?.jellyfin??{},after:defaults.jellyfin,
      foldersBefore:item.current?.folders??[],foldersAfter:defaults.folders} : null}))};
    if(ids.some(id=>input.confirm?.[id]!==versions[id])||Object.keys(input.confirm).length!==ids.length)
      throw new AppError(409,'The accounts or preset changed. Preview the changes again.');
    for(const item of targets) {
      const access=provider ? {...item.access,...defaults.access,libraryOnly:item.access.libraryOnly===true||defaults.access.libraryOnly===true} : defaults.access;
      await tx.execute(sql`update users set access_defaults=${access}::jsonb where id=${item.id}`);
      if(provider){
        const [remote]=await remoteInTransaction(tx,item.id);
        await queueRemote(tx,remote,'apply','access',defaults);
      }
      await tx.execute(sql`insert into account_audit(event,actor_id,subject_id) values('account.access-updated',${admin.id},${item.id})`);
    }
    return {ok:true};
  });
}
