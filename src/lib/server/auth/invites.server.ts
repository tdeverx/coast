import * as v from 'valibot';
import { emptyInviteDefaults, inviteBatchLimit, inviteCode, inviteDefaultsSchema, inviteLabel, inviteLimit, jellyfinSettingsSchema, jellyfinUserId, provisioningAccessWindows, uuid, type InviteDefaults } from '#lib/auth/invites.js';
import { jellyfinConfigurationSchema, jellyfinHasFamilyLimits } from '#lib/auth/jellyfin-preset.js';
import { jellyfinItemKey } from '#lib/providers/jellyfin/paging.js';
import { provisioningAuthority, provisioningKeyAuthority, validatePresetLibraries } from '#lib/providers/jellyfin/provisioning.server.js';
import { AppError } from '../security/errors';
import { getSql } from '../db';
import { checkLoginRate, hashToken, randomToken, requireAdmin, requireUser, type SessionUser } from './index';

type Db = ReturnType<typeof getSql>;
const days = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(30));
const quota = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50));
const presetName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80));
const inviteUnavailable = 'This invite code has expired, was used, or is invalid.';

export async function recordAccountEvent(db: Db, event: string, actor: string | null, subject: string | null) {
  await db`insert into account_audit(event,actor_id,subject_id) values(${event},${actor},${subject})`;
}

async function inviteAuthority(authorityId:string) {
  const id=v.parse(uuid,authorityId);
  const [connection]=await getSql()`select user_id from provider_connections where id=${id}`;
  if(connection) {
    const context=await provisioningAuthority(connection.user_id,id);
    return {adapter:context.adapter,connection:id,instance:null,generation:context.connection.accountGeneration};
  }
  const context=await provisioningKeyAuthority(id);
  return {adapter:context.adapter,connection:null,instance:id,generation:context.generation};
}

export async function inviteJellyfinAuthority(actor:SessionUser|null,connectionId:string) {
  requireAdmin(actor);
  return inviteAuthority(connectionId);
}

async function validateJellyfin(defaults: InviteDefaults) {
  if (defaults.account === 'coast') return null;
  const authority = await inviteAuthority(defaults.connectionId!);
  await validatePresetLibraries(authority.adapter,defaults.folders,defaults.jellyfin);
  return authority;
}

export async function saveInvitePreset(actor: SessionUser | null, raw: unknown) {
  const admin = requireAdmin(actor);
  const input = v.parse(v.strictObject({id:v.optional(uuid),name:presetName,defaults:inviteDefaultsSchema}),raw);
  await validateJellyfin(input.defaults);
  return getSql().begin(async db => {
    const [row] = input.id
      ? await db`update invite_presets set name=${input.name},defaults=${input.defaults}::jsonb,updated_at=now() where id=${input.id} returning id`
      : await db`insert into invite_presets(name,defaults) values(${input.name},${input.defaults}::jsonb) returning id`;
    if (!row) throw new AppError(404,'Invite preset not found.');
    await recordAccountEvent(db,'preset.saved',admin.id,row.id);
    return {id:row.id as string};
  });
}

export async function listInvitePresets(actor: SessionUser | null) {
  requireAdmin(actor);
  return getSql()<{id:string; name:string; defaults:InviteDefaults}[]>`select id,name,defaults from invite_presets order by lower(name),id limit 100`;
}

export async function previewJellyfinDefaults(actor: SessionUser | null, connectionId: string, sourceId: string) {
  const {adapter} = await inviteJellyfinAuthority(actor,connectionId);
  const [{Policy,Configuration},libraries] = await Promise.all([
    adapter.userForProvisioning(v.parse(jellyfinUserId,sourceId)), adapter.virtualFolders(),
  ]);
  const safe = Object.fromEntries(Object.keys(jellyfinSettingsSchema.entries)
    .filter(key => key in Policy && key!=='EnableContentDeletion' && key!=='EnableContentDeletionFromFolders')
    .map(key => [key, Policy[key]]));
  if('AccessSchedules' in safe)safe.AccessSchedules=provisioningAccessWindows(safe.AccessSchedules);
  const jellyfin = v.parse(jellyfinSettingsSchema, safe);
  const configuration = Configuration ? v.parse(jellyfinConfigurationSchema,Object.fromEntries(
    Object.keys(jellyfinConfigurationSchema.entries).filter(key=>key in Configuration&&key!=='EnableLocalPassword').map(key=>[key,Configuration[key]]))) : undefined;
  const permitted = new Set(Array.isArray(Policy.EnabledFolders) ? Policy.EnabledFolders.map(jellyfinItemKey) : []);
  const allFolders=Policy.EnableAllFolders===true;
  if(allFolders&&jellyfinHasFamilyLimits(jellyfin))jellyfin.EnableAllFolders=false;
  return {jellyfin,configuration,folders:jellyfin.EnableAllFolders ? [] : libraries
    .filter(folder=>allFolders||permitted.has(jellyfinItemKey(folder.ItemId))).map(folder=>folder.ItemId)};
}

type Issue = {days:number; label:string; maxUses:number; count:number};
const issueFields = {days:v.optional(days,7),label:v.optional(inviteLabel,''),maxUses:v.optional(quota,1),count:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(inviteBatchLimit)),1)};
async function prepareCodes(count: number) {
  return Promise.all(Array.from({length:count},async () => { const code = randomToken(); return {code,hash:await hashToken(code)}; }));
}

async function issueInvites(db: Db, userId: string, input: Issue, defaults: InviteDefaults, authority: Awaited<ReturnType<typeof validateJellyfin>>,
  codes: Awaited<ReturnType<typeof prepareCodes>>, preset?: {id:string; name:string}, member = false, approved = false) {
  const expiresAt = new Date(Date.now() + input.days * 86400000);
  const rows = await db<{id:string;token_hash:string}[]>`
    with issued as (
      insert into registration_invites
        (token_hash,created_by,expires_at,provision_connection_id,provision_instance_id,provision_generation,provision_folders,preset_id,preset_name,defaults,label,max_uses,member_issued,approval_issued)
      select token_hash,${userId},${expiresAt},${authority?.connection??null},${authority?.instance??null},
        ${authority?.generation??null},${defaults.folders}::jsonb,${preset?.id ?? null},${preset?.name ?? null},${defaults}::jsonb,${input.label},${input.maxUses},${member},${approved}
      from unnest(${db.array(codes.map(entry=>entry.hash),'TEXT')}::text[]) token_hash
      returning id,token_hash
    ), logged as (
      insert into account_audit(event,actor_id,subject_id)
      select 'invite.issued',${userId},id from issued
    )
    select id,token_hash from issued`;
  const ids=new Map(rows.map(row=>[row.token_hash,row.id]));
  return codes.map(({code,hash})=>({id:ids.get(hash)!,code,expiresAt}));
}

export async function createInvite(actor: SessionUser | null, raw: unknown) {
  const admin = requireAdmin(actor);
  const input = v.parse(v.strictObject({...issueFields,presetId:v.optional(uuid),defaults:v.optional(inviteDefaultsSchema),
    provisionConnectionId:v.optional(uuid),folders:v.optional(v.array(v.string()),[])}),raw);
  const db = getSql();
  const [preset] = input.presetId ? await db<{id:string;name:string;defaults:InviteDefaults}[]>`select id,name,defaults from invite_presets where id=${input.presetId}` : [];
  if (input.presetId && !preset) throw new AppError(404,'Invite preset not found.');
  const defaults = input.defaults ?? (preset ? v.parse(inviteDefaultsSchema,preset.defaults) : undefined) ?? (input.provisionConnectionId
    ? v.parse(inviteDefaultsSchema,{account:'managed',connectionId:input.provisionConnectionId,folders:input.folders})
    : emptyInviteDefaults);
  const [generation,codes] = await Promise.all([validateJellyfin(defaults),prepareCodes(input.count)]);
  const issued = await db.begin(tx => issueInvites(tx,admin.id,input,defaults,generation,codes,preset));
  return {...issued[0],issued};
}

const statusValues = ['active','claimed','expired','revoked'] as const;
const statusSql = (db: Db) => db`case when i.revoked_at is not null then 'revoked' when i.claim_count=i.max_uses then 'claimed' when i.expires_at<=now() then 'expired' else 'active' end`;
export async function listInvites(actor: SessionUser | null, search: URLSearchParams = new URLSearchParams(), member = false) {
  const user = member ? requireUser(actor) : requireAdmin(actor);
  const parsedStatus = v.safeParse(v.picklist(statusValues),search.get('status'));
  const status = parsedStatus.success ? parsedStatus.output : null;
  const failed = !member && search.get('status')==='setup-failed';
  const optionalId = (key: string) => { const result = v.safeParse(uuid,search.get(key)); return result.success ? result.output : null; };
  const issuerText = member ? '' : (search.get('issuer')??'').trim().slice(0,60);
  const issuer = member ? user.id : optionalId('issuer');
  const expiry = search.get('expiry') === 'week';
  const preset = optionalId('preset');
  const before = optionalId('before');
  const db = getSql();
  const rows = await db<{id:string; createdAt:Date; expiresAt:Date; usedAt:Date|null; revokedAt:Date|null; maxUses:number; claimCount:number; hasSetupFailure:boolean; provisionConnectionId:string|null; presetName:string|null; label:string; issuer:string|null; username:string|null; status:typeof statusValues[number]}[]>`
    select i.id,i.created_at as "createdAt",i.expires_at as "expiresAt",i.used_at as "usedAt",i.revoked_at as "revokedAt",
      i.max_uses as "maxUses",i.claim_count as "claimCount",coalesce(i.provision_instance_id,i.provision_connection_id) as "provisionConnectionId",
      i.preset_name as "presetName",i.label,${failed} as "hasSetupFailure", owner.username as issuer, claimant.username,${statusSql(db)} as status
    from registration_invites i left join users owner on owner.id=i.created_by
    left join users claimant on not ${member} and claimant.id=i.used_by
    where (${issuer}::uuid is null or i.created_by=${issuer}) and (not ${member} or i.member_issued)
      and (${issuer}::uuid is not null or ${issuerText}='' or strpos(lower(owner.username),lower(${issuerText}))>0)
      and (not ${expiry} or i.expires_at>now() and i.expires_at<=now()+interval '7 days')
      and (${preset}::uuid is null or i.preset_id=${preset}) and (${status}::text is null or ${statusSql(db)}=${status})
      and (not ${failed} or exists(select 1 from invite_claims c where c.invite_id=i.id and c.ready_at is null and c.user_id is not null
        and ${claimSetupFailed(db)}))
      and (${before}::uuid is null or (i.created_at,i.id)<(select created_at,id from registration_invites where id=${before}))
    order by i.created_at desc,i.id desc limit ${inviteLimit + 1}`;
  return {items:rows.slice(0,inviteLimit),next:rows.length > inviteLimit ? rows[inviteLimit-1].id : null};
}

export async function revokeInvite(actor: SessionUser | null, id: string, member = false) {
  const user = member ? requireUser(actor) : requireAdmin(actor);
  await getSql().begin(async db => {
    const [row] = await db`update registration_invites set revoked_at=now() where id=${v.parse(uuid,id)}
      and revoked_at is null and claim_count<max_uses and (not ${member} or (member_issued and created_by=${user.id})) returning id`;
    if (row) await recordAccountEvent(db,'invite.revoked',user.id,row.id);
  });
}

export async function regenerateInvite(actor: SessionUser | null, id: string) {
  const admin = requireAdmin(actor);
  v.parse(uuid,id);
  const [{code,hash}] = await prepareCodes(1);
  return getSql().begin(async db => {
    const [authority]=await db<{instance:string|null;generation:string|null}[]>`
      select i.provision_instance_id as instance,p.settings->>'managementKeyGeneration' as generation
      from registration_invites i left join provider_instances p on p.id=i.provision_instance_id and p.enabled and p.credentials is not null
      where i.id=${id} for update of i`;
    if(authority?.instance&&!authority.generation)
      throw new AppError(409,'Reconnect the Jellyfin server API key before replacing this invitation.');
    const generation=authority?.generation??null;
    // Member codes are single-use. Rotating an unclaimed code in place
    // preserves the original issuance date and consumes one quota slot.
    const [memberCode] = await db`update registration_invites set token_hash=${hash},provision_generation=coalesce(${generation}::uuid,provision_generation)
      where id=${v.parse(uuid,id)} and member_issued and claim_count=0 and max_uses=1
        and revoked_at is null and expires_at>now() returning id,expires_at as "expiresAt"`;
    if(memberCode){
      await recordAccountEvent(db,'invite.regenerated',admin.id,memberCode.id);
      return {...memberCode,code};
    }
    const [old] = await db`update registration_invites set revoked_at=now()
      where id=${v.parse(uuid,id)} and not member_issued and revoked_at is null and expires_at>now() and claim_count<max_uses returning *`;
    if (!old) throw new AppError(409,'This invitation has no active uses to replace.');
    const [replacement] = await db`insert into registration_invites
      (token_hash,created_by,expires_at,provision_connection_id,provision_instance_id,provision_generation,provision_folders,preset_id,preset_name,defaults,label,max_uses,member_issued)
      select ${hash},created_by,expires_at,provision_connection_id,provision_instance_id,coalesce(${generation}::uuid,provision_generation),provision_folders,preset_id,preset_name,defaults,label,max_uses-claim_count,member_issued
      from registration_invites where id=${old.id} returning id,expires_at as "expiresAt"`;
    await recordAccountEvent(db,'invite.revoked',admin.id,old.id);
    await recordAccountEvent(db,'invite.issued',admin.id,replacement.id);
    return {...replacement,code};
  });
}

export async function findRedeemableInvite(db: Db, tokenHash: string, lock = false) {
  const [invite] = await db<{
    id:string; created_by:string|null; inviter:string|null; defaults:InviteDefaults|null; preset_name:string|null;
    provision_connection_id:string|null; provision_instance_id:string|null; provision_generation:string|null; provision_folders:string[]|null; instance_name:string|null;
  }[]>`select i.id,i.created_by,coalesce(nullif(u.settings#>>'{profile,displayName}',''),u.username) as inviter,
    i.defaults,i.preset_name,i.provision_connection_id,i.provision_instance_id,i.provision_generation,i.provision_folders,p.name as instance_name
    from registration_invites i left join users u on u.id=i.created_by and not u.disabled and (u.membership_expires_at is null or u.membership_expires_at>now())
    left join provider_connections c on c.id=i.provision_connection_id left join provider_instances p on p.id=coalesce(i.provision_instance_id,c.instance_id)
    where i.token_hash=${tokenHash} and i.claim_count<i.max_uses and i.revoked_at is null and i.expires_at>now()
      and (not i.member_issued or (u.id is not null and (i.approval_issued or exists(select 1 from member_invite_grants where user_id=u.id))))
      and (i.provision_generation is null or p.enabled and (
        i.provision_instance_id is not null and p.credentials is not null and p.settings->>'managementKeyGeneration'=i.provision_generation::text
        or c.status='connected' and c.account_generation=i.provision_generation
          and exists(select 1 from users admin where admin.id=c.user_id and admin.role='admin' and not admin.disabled)))
    ${lock ? db`for update of i` : db``}`;
  return invite;
}

export async function previewInvite(input: unknown, client: string) {
  checkLoginRate(`invite-preview:${client}`);
  const code = v.parse(inviteCode,input);
  const invite = await findRedeemableInvite(getSql(),await hashToken(code));
  if (!invite) throw new AppError(400,inviteUnavailable);
  return {code,inviter:invite.inviter,server:invite.instance_name,preset:invite.preset_name,
    account:invite.defaults?.account ?? (invite.provision_generation ? 'managed' : 'coast'),
    libraryOnly:invite.defaults?.access.libraryOnly === true, membershipDays:invite.defaults?.membershipDays ?? null};
}

function claimSetupFailed(db:Db) {
  return db`(c.setup_failed_at is not null or exists(
    select 1 from onboarding_provisioning p where p.user_id=c.user_id and p.state in ('uncertain','configuring')
  ) or exists(
    select 1 from user_onboarding o join provider_connections source on source.id=o.connection_id and source.account_generation=o.account_generation
    join lateral (
      select q.state from outbox_actions q where q.connection_id=o.connection_id and q.user_id=o.user_id and q.account_generation=o.account_generation
        and q.kind='jellyfin.bootstrap' and q.created_at>=o.requested_at
      order by q.created_at desc,q.id desc limit 1
    ) bootstrap on bootstrap.state in ('failed','cancelled') where o.user_id=c.user_id
  ) or exists(
    select 1 from user_onboarding o join outbox_actions q on q.user_id=o.user_id and q.account_generation=o.trakt_account_generation
    and q.id in ((o.import_jobs->>'trakt.import')::uuid,(o.import_jobs->>'trakt.lists-import')::uuid)
    where o.user_id=c.user_id and q.state in ('failed','cancelled')
  ))`;
}

export async function inviteClaims(actor: SessionUser | null, id: string, cursor: string | null) {
  requireAdmin(actor);
  const before = cursor ? v.parse(uuid,cursor) : null;
  const db=getSql();
  const rows = await db<{id:string; username:string; userId:string|null; createdAt:Date; readyAt:Date|null; provisioning:string|null;failed:boolean}[]>`
    select c.id,c.username,c.user_id as "userId",c.created_at as "createdAt",c.ready_at as "readyAt",p.state as provisioning,
      case when c.ready_at is null and c.user_id is not null then ${claimSetupFailed(db)} else false end as failed
    from invite_claims c left join onboarding_provisioning p on p.user_id=c.user_id
    where c.invite_id=${v.parse(uuid,id)} and (${before}::uuid is null or (c.created_at,c.id)<(select created_at,id from invite_claims where id=${before}))
    order by c.created_at desc,c.id desc limit ${inviteLimit+1}`;
  return {items:rows.slice(0,inviteLimit),next:rows.length>inviteLimit ? rows[inviteLimit-1].id : null};
}

export async function memberInviteOverview(actor:SessionUser|null, search:URLSearchParams) {
  const user=requireUser(actor);
  const [page,[permissions]]=await Promise.all([listInvites(user,search,true),getSql()`select g.quota,p.name as preset,
    (select count(*)::int from registration_invites where created_by=${user.id} and member_issued and not approval_issued and created_at>now()-interval '30 days') as issued,
    (select state from member_invite_requests where user_id=${user.id} order by created_at desc limit 1) as request
    from users u left join member_invite_grants g on g.user_id=u.id left join invite_presets p on p.id=g.preset_id
    where u.id=${user.id}`]);
  return {...page,grant:permissions?.quota ? {quota:Number(permissions.quota),remaining:Math.max(0,permissions.quota-permissions.issued),preset:String(permissions.preset)} : null,
    request:(permissions?.request??null) as 'pending'|'approved'|'denied'|'issued'|null};
}

async function memberInviteCandidate(db:Db,userId:string) {
  const [candidate]=await db<{id:string;name:string;defaults:InviteDefaults;updated_at:Date;request_id:string|null}[]>`
    select p.id,p.name,p.defaults,p.updated_at,r.id as request_id
    from users u left join member_invite_grants g on g.user_id=u.id
    left join member_invite_requests r on r.user_id=u.id and r.state='approved'
    cross join lateral (
      select coalesce((select count(*) from registration_invites
        where created_by=u.id and member_issued and not approval_issued and created_at>now()-interval '30 days')<g.quota,false) as available
    ) quota
    join invite_presets p on p.id=coalesce(r.preset_id,g.preset_id)
    where u.id=${userId} and not u.disabled and coalesce(u.membership_expires_at>now(),true) and (quota.available or r.id is not null)`;
  return candidate;
}

export async function issueMemberInvite(actor:SessionUser|null, raw:unknown) {
  const user=requireUser(actor);
  if(user.role==='admin')throw new AppError(409,'Create invites in Settings → Accounts → Invites.','admin_invite_workflow');
  const {label}=v.parse(v.strictObject({label:v.optional(inviteLabel,'')}),raw);
  const db=getSql();
  const preset=await memberInviteCandidate(db,user.id);
  if(!preset)throw new AppError(409,'You have no invite allowance. Ask an administrator for an invite.');
  const defaults=v.parse(inviteDefaultsSchema,preset.defaults);
  const [generation,codes]=await Promise.all([validateJellyfin(defaults),prepareCodes(1)]);
  return db.begin(async tx=>{
    await tx`select id from users where id=${user.id} for no key update`;
    const current=await memberInviteCandidate(tx,user.id);
    if(!current||current.id!==preset.id||current.updated_at.getTime()!==preset.updated_at.getTime()||current.request_id!==preset.request_id)
      throw new AppError(409,'Your invite allowance changed. Try again.');
    if(current.request_id)await tx`update member_invite_requests set state='issued' where id=${current.request_id}`;
    const [issued]=await issueInvites(tx,user.id,{days:7,label,maxUses:1,count:1},defaults,generation,codes,preset,true,!!current.request_id);
    return issued;
  });
}

export async function requestMemberInvite(actor:SessionUser|null, raw:unknown) {
  const user=requireUser(actor);
  if(user.role==='admin')throw new AppError(409,'Create invites in Settings → Accounts → Invites.','admin_invite_workflow');
  const {note}=v.parse(v.strictObject({note:v.optional(inviteLabel,'')}),raw);
  const db=getSql();
  await db.begin(async tx=>{
    const [request]=await tx`insert into member_invite_requests(user_id,note) values(${user.id},${note}) on conflict do nothing returning id`;
    if(!request)throw new AppError(409,'You already have an open invite request.');
    await recordAccountEvent(tx,'member.requested',user.id,request.id);
  });
}

export async function memberInviteGrant(actor:SessionUser|null, userId:string, raw:unknown) {
  const admin=requireAdmin(actor);
  const {presetId,limit,requestId,decision}=v.parse(v.strictObject({presetId:v.optional(v.nullable(uuid)),limit:v.optional(quota,3),
    requestId:v.optional(uuid),decision:v.optional(v.picklist(['approved','denied']))}),raw);
  await getSql().begin(async tx=>{
    const [target]=await tx`select id from users where id=${v.parse(uuid,userId)} and role='user' for no key update`;
    if(!target)throw new AppError(404,'Member not found.');
    if(presetId&&!requestId)await tx`insert into member_invite_grants(user_id,preset_id,quota) values(${userId},${presetId},${limit})
      on conflict(user_id) do update set preset_id=excluded.preset_id,quota=excluded.quota`;
    if(presetId===null&&!requestId){
      await tx`delete from member_invite_grants where user_id=${userId}`;
      await tx`update member_invite_requests set state='denied' where user_id=${userId} and state='approved'`;
      await tx`update registration_invites set revoked_at=now() where created_by=${userId} and member_issued and revoked_at is null and claim_count<max_uses`;
    }
    if(decision&&requestId){
      let approvedPreset:string|null=null;
      if(decision==='approved'){
        const [preset]=await tx<{id:string}[]>`select id from invite_presets where id=coalesce(${presetId??null}::uuid,
          (select preset_id from member_invite_grants where user_id=${userId}))`;
        if(!preset)throw new AppError(400,'Choose a preset before approving this request.');
        approvedPreset=preset.id;
      }
      const [request]=await tx`update member_invite_requests set state=${decision},preset_id=${approvedPreset}
        where id=${requestId} and user_id=${userId} and state='pending' returning id`;
      if(!request)throw new AppError(409,'That request is already resolved.');
    }
    await recordAccountEvent(tx,decision ? 'member.'+decision : 'member.grant-updated',admin.id,userId);
  });
  return {ok:true};
}

export async function inviteOverview(actor:SessionUser|null) {
  requireAdmin(actor);
  const db=getSql();
  const [funnel,audit,requests]=await Promise.all([
    db<{event:string;total:number}[]>`select event,count(*)::int as total from account_audit
      where created_at>=now()-interval '30 days' and event in ('invite.issued','invite.claimed','invite.ready','invite.provisioning-failed') group by event`,
    db<{id:string;event:string;actor:string|null;subjectName:string|null;details:Record<string,unknown>|null;createdAt:Date}[]>`
      select a.id,a.event,actor.username as actor,
        coalesce(subject.username,nullif(i.label,''),i.preset_name) as "subjectName",a.details,a.created_at as "createdAt"
      from (select * from account_audit order by created_at desc,id desc limit 30) a
      left join users actor on actor.id=a.actor_id left join users subject on subject.id=a.subject_id
      left join registration_invites i on i.id=a.subject_id order by a.created_at desc,a.id desc`,
    db<{id:string;userId:string;username:string;note:string}[]>`select r.id,r.user_id as "userId",u.username,r.note from member_invite_requests r
      join users u on u.id=r.user_id where r.state='pending' order by r.created_at,r.id limit 30`,
  ]);
  return {funnel,audit,requests};
}
