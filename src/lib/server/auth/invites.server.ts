import * as v from 'valibot';
import { emptyInviteDefaults, inviteBatchLimit, inviteCode, inviteDefaultsSchema, inviteLabel, inviteLimit, jellyfinSettingsSchema, jellyfinUserId, provisioningAccessWindows, uuid, type InviteDefaults } from '#lib/auth/invites.js';
import { provisioningAuthority } from '#lib/providers/jellyfin/provisioning.server.js';
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

async function validateJellyfin(defaults: InviteDefaults) {
  if (defaults.account === 'coast') return null;
  const db = getSql();
  const [connection] = await db`select c.user_id from provider_connections c join users u on u.id=c.user_id
    where c.id=${defaults.connectionId!} and u.role='admin' and not u.disabled`;
  if (!connection) throw new AppError(409,'Choose an enabled Jellyfin administrator account.');
  const authority = await provisioningAuthority(connection.user_id, defaults.connectionId!);
  const folders = new Set((await authority.adapter.virtualFolders()).map(folder => folder.ItemId));
  if (defaults.folders.some(id => !folders.has(id))) throw new AppError(400,'Choose existing Jellyfin libraries.');
  return authority.connection.accountGeneration;
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
  const admin = requireAdmin(actor);
  const {adapter} = await provisioningAuthority(admin.id, v.parse(uuid,connectionId));
  const {Policy} = await adapter.userForProvisioning(v.parse(jellyfinUserId,sourceId));
  const safe = Object.fromEntries(Object.keys(jellyfinSettingsSchema.entries).filter(key => key in Policy).map(key => [key, Policy[key]]));
  if('AccessSchedules' in safe)safe.AccessSchedules=provisioningAccessWindows(safe.AccessSchedules);
  const jellyfin = v.parse(jellyfinSettingsSchema, safe);
  const libraries = await adapter.virtualFolders();
  const permitted = Array.isArray(Policy.EnabledFolders) ? new Set(Policy.EnabledFolders) : new Set();
  return {jellyfin,folders:libraries.filter(folder => Policy.EnableAllFolders === true || permitted.has(folder.ItemId)).map(folder => folder.ItemId)};
}

type Issue = {days:number; label:string; maxUses:number; count:number};
const issueFields = {days:v.optional(days,7),label:v.optional(inviteLabel,''),maxUses:v.optional(quota,1),count:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(inviteBatchLimit)),1)};
async function prepareCodes(count: number) {
  return Promise.all(Array.from({length:count},async () => { const code = randomToken(); return {code,hash:await hashToken(code)}; }));
}

async function issueInvites(db: Db, userId: string, input: Issue, defaults: InviteDefaults, generation: string | null,
  codes: Awaited<ReturnType<typeof prepareCodes>>, preset?: {id:string; name:string}, member = false) {
  const expiresAt = new Date(Date.now() + input.days * 86400000);
  const rows = await db<{id:string;token_hash:string}[]>`
    with issued as (
      insert into registration_invites
        (token_hash,created_by,expires_at,provision_connection_id,provision_generation,provision_folders,preset_id,preset_name,defaults,label,max_uses,member_issued)
      select token_hash,${userId},${expiresAt},${defaults.account === 'coast' ? null : defaults.connectionId!},
        ${generation},${defaults.folders}::jsonb,${preset?.id ?? null},${preset?.name ?? null},${defaults}::jsonb,${input.label},${input.maxUses},${member}
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
  const defaults = input.defaults ?? preset?.defaults ?? (input.provisionConnectionId
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
  const optionalId = (key: string) => { const result = v.safeParse(uuid,search.get(key)); return result.success ? result.output : null; };
  const issuerText = member ? '' : (search.get('issuer')??'').trim().slice(0,60);
  const issuer = member ? user.id : optionalId('issuer');
  const expiry = search.get('expiry') === 'week';
  const preset = optionalId('preset');
  const before = optionalId('before');
  const db = getSql();
  const rows = await db<{id:string; createdAt:Date; expiresAt:Date; usedAt:Date|null; revokedAt:Date|null; maxUses:number; claimCount:number; provisionConnectionId:string|null; presetName:string|null; label:string; issuer:string|null; username:string|null; status:typeof statusValues[number]}[]>`
    select i.id,i.created_at as "createdAt",i.expires_at as "expiresAt",i.used_at as "usedAt",i.revoked_at as "revokedAt",
      i.max_uses as "maxUses",i.claim_count as "claimCount",i.provision_connection_id as "provisionConnectionId",
      i.preset_name as "presetName",i.label, owner.username as issuer, claimant.username,${statusSql(db)} as status
    from registration_invites i left join users owner on owner.id=i.created_by
    left join users claimant on not ${member} and claimant.id=i.used_by
    where (${issuer}::uuid is null or i.created_by=${issuer}) and (not ${member} or i.member_issued)
      and (${issuer}::uuid is not null or ${issuerText}='' or strpos(lower(owner.username),lower(${issuerText}))>0)
      and (not ${expiry} or i.expires_at>now() and i.expires_at<=now()+interval '7 days')
      and (${preset}::uuid is null or i.preset_id=${preset}) and (${status}::text is null or ${statusSql(db)}=${status})
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
  const [{code,hash}] = await prepareCodes(1);
  return getSql().begin(async db => {
    // Member codes are single-use. Rotating an unclaimed code in place
    // preserves the original issuance date and consumes one quota slot.
    const [memberCode] = await db`update registration_invites set token_hash=${hash}
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
      (token_hash,created_by,expires_at,provision_connection_id,provision_generation,provision_folders,preset_id,preset_name,defaults,label,max_uses,member_issued)
      select ${hash},created_by,expires_at,provision_connection_id,provision_generation,provision_folders,preset_id,preset_name,defaults,label,max_uses-claim_count,member_issued
      from registration_invites where id=${old.id} returning id,expires_at as "expiresAt"`;
    await recordAccountEvent(db,'invite.revoked',admin.id,old.id);
    await recordAccountEvent(db,'invite.issued',admin.id,replacement.id);
    return {...replacement,code};
  });
}

export async function findRedeemableInvite(db: Db, tokenHash: string, lock = false) {
  const [invite] = await db<{
    id:string; created_by:string|null; inviter:string|null; defaults:InviteDefaults|null; preset_name:string|null;
    provision_connection_id:string|null; provision_generation:string|null; provision_folders:string[]|null; instance_name:string|null;
  }[]>`select i.id,i.created_by,coalesce(nullif(u.settings#>>'{profile,displayName}',''),u.username) as inviter,
    i.defaults,i.preset_name,i.provision_connection_id,i.provision_generation,i.provision_folders,p.name as instance_name
    from registration_invites i left join users u on u.id=i.created_by and not u.disabled and (u.membership_expires_at is null or u.membership_expires_at>now())
    left join provider_connections c on c.id=i.provision_connection_id left join provider_instances p on p.id=c.instance_id
    where i.token_hash=${tokenHash} and i.claim_count<i.max_uses and i.revoked_at is null and i.expires_at>now()
      and (not i.member_issued or (u.id is not null and exists(select 1 from member_invite_grants where user_id=u.id)))
      and (i.provision_generation is null or (c.status='connected' and c.account_generation=i.provision_generation and p.enabled
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

export async function inviteClaims(actor: SessionUser | null, id: string, cursor: string | null) {
  requireAdmin(actor);
  const before = cursor ? v.parse(uuid,cursor) : null;
  const rows = await getSql()<{id:string; username:string; userId:string|null; createdAt:Date; readyAt:Date|null; provisioning:string|null}[]>`
    select c.id,c.username,c.user_id as "userId",c.created_at as "createdAt",c.ready_at as "readyAt",p.state as provisioning
    from invite_claims c left join onboarding_provisioning p on p.user_id=c.user_id
    where c.invite_id=${v.parse(uuid,id)} and (${before}::uuid is null or (c.created_at,c.id)<(select created_at,id from invite_claims where id=${before}))
    order by c.created_at desc,c.id desc limit ${inviteLimit+1}`;
  return {items:rows.slice(0,inviteLimit),next:rows.length>inviteLimit ? rows[inviteLimit-1].id : null};
}

export async function memberInviteOverview(actor:SessionUser|null, search:URLSearchParams) {
  const user=requireUser(actor);
  const [page,[permissions]]=await Promise.all([listInvites(user,search,true),getSql()`select g.quota,p.name as preset,
    (select count(*)::int from registration_invites where created_by=${user.id} and member_issued and created_at>now()-interval '30 days') as issued,
    (select state from member_invite_requests where user_id=${user.id} order by created_at desc limit 1) as request
    from users u left join member_invite_grants g on g.user_id=u.id left join invite_presets p on p.id=g.preset_id
    where u.id=${user.id}`]);
  return {...page,grant:permissions?.quota ? {quota:Number(permissions.quota),remaining:Math.max(0,permissions.quota-permissions.issued),preset:String(permissions.preset)} : null,
    request:(permissions?.request??null) as 'pending'|'approved'|'denied'|'issued'|null};
}

export async function issueMemberInvite(actor:SessionUser|null, raw:unknown) {
  const user=requireUser(actor);
  const {label}=v.parse(v.strictObject({label:v.optional(inviteLabel,'')}),raw);
  const db=getSql();
  const [preset]=await db<{id:string;name:string;defaults:InviteDefaults;updated_at:Date;has_slot:boolean}[]>`
    select p.id,p.name,p.defaults,p.updated_at,
      (select count(*) from registration_invites where created_by=g.user_id and member_issued
        and created_at>now()-interval '30 days')<g.quota
      or exists(select 1 from member_invite_requests r where r.user_id=g.user_id and r.state='approved') as has_slot
    from member_invite_grants g join invite_presets p on p.id=g.preset_id
    join users u on u.id=g.user_id and not u.disabled and coalesce(u.membership_expires_at>now(),true)
    where g.user_id=${user.id}`;
  if(!preset)throw new AppError(403,'Ask an administrator for member invitation access.');
  if(!preset.has_slot)throw new AppError(409,'You have used your invite allowance.');
  const [generation,codes]=await Promise.all([validateJellyfin(preset.defaults),prepareCodes(1)]);
  return db.begin(async tx=>{
    const [grant]=await tx`select g.quota from member_invite_grants g join invite_presets p on p.id=g.preset_id
      join users u on u.id=g.user_id and not u.disabled and coalesce(u.membership_expires_at>now(),true)
      where g.user_id=${user.id} and g.preset_id=${preset.id} and date_trunc('milliseconds',p.updated_at)=${preset.updated_at} for no key update of u,g`;
    if(!grant)throw new AppError(409,'Your invite allowance changed. Try again.');
    const [usage]=await tx`select count(*)::int as total from registration_invites where created_by=${user.id} and member_issued and created_at>now()-interval '30 days'`;
    if(usage.total>=grant.quota){
      const [extra]=await tx`update member_invite_requests set state='issued' where user_id=${user.id} and state='approved' returning id`;
      if(!extra)throw new AppError(409,'You have used your invite allowance.');
    }
    const [issued]=await issueInvites(tx,user.id,{days:7,label,maxUses:1,count:1},preset.defaults,generation,codes,preset,true);
    return issued;
  });
}

export async function requestMemberInvite(actor:SessionUser|null, raw:unknown) {
  const user=requireUser(actor);
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
    if(presetId)await tx`insert into member_invite_grants(user_id,preset_id,quota) values(${userId},${presetId},${limit})
      on conflict(user_id) do update set preset_id=excluded.preset_id,quota=excluded.quota`;
    if(presetId===null){
      await tx`delete from member_invite_grants where user_id=${userId}`;
      await tx`update registration_invites set revoked_at=now() where created_by=${userId} and member_issued and revoked_at is null and claim_count<max_uses`;
    }
    if(decision&&requestId){
      if(decision==='approved'&&!(await tx`select 1 from member_invite_grants where user_id=${userId}`).length)
        throw new AppError(400,'Choose a member preset before approving this request.');
      const [request]=await tx`update member_invite_requests set state=${decision} where id=${requestId} and user_id=${userId} and state='pending' returning id`;
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
    db<{id:string;event:string;actor:string|null;subject:string|null;createdAt:Date}[]>`select a.id,a.event,u.username as actor,a.subject_id as subject,a.created_at as "createdAt"
      from account_audit a left join users u on u.id=a.actor_id order by a.created_at desc,a.id desc limit 30`,
    db<{id:string;userId:string;username:string;note:string}[]>`select r.id,r.user_id as "userId",u.username,r.note from member_invite_requests r
      join users u on u.id=r.user_id where r.state='pending' order by r.created_at,r.id limit 30`,
  ]);
  return {funnel,audit,requests};
}
