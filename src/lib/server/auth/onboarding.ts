import * as v from 'valibot';
import { getSql } from '../db';
import { accountSchema, hashToken, randomToken, newSession, requireAdmin, checkLoginRate, type SessionUser } from './index';
import { AppError } from '../security/errors';
import { connectJellyfin } from '$lib/providers/jellyfin/connection.server';
import { libraryScanProgress } from '$lib/sync/jellyfin';
import { enqueueAction } from '../queue';

export async function listInvites(actor: SessionUser | null) {
  requireAdmin(actor);
  return getSql()`SELECT i.id, i.expires_at AS "expiresAt", i.used_at AS "usedAt", i.revoked_at AS "revokedAt", u.username FROM registration_invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created_at DESC LIMIT 100`;
}
export async function createInvite(actor: SessionUser | null, input: unknown) {
  const admin = requireAdmin(actor);
  const { days } = v.parse(v.object({ days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(30)) }), input);
  const code = randomToken();
  const expiresAt = new Date(Date.now() + days * 86400000);
  const [row] = await getSql()`INSERT INTO registration_invites (token_hash,created_by,expires_at) VALUES (${await hashToken(code)},${admin.id},${expiresAt}) RETURNING id`;
  return { id: row.id, code, expiresAt };
}
export async function revokeInvite(actor: SessionUser | null, id: string) {
  requireAdmin(actor);
  await getSql()`UPDATE registration_invites SET revoked_at=NOW() WHERE id=${v.parse(v.pipe(v.string(),v.uuid()),id)} AND used_at IS NULL`;
}
export async function redeemInvite(input: unknown, client: string) {
  checkLoginRate(`register:${client}`);
  const data = v.parse(v.object({ ...accountSchema.entries, code: v.pipe(v.string(),v.trim(),v.regex(/^[A-Za-z0-9_-]{43}$/)) }), input);
  const tokenHash = await hashToken(data.code);
  const passwordHash = await Bun.password.hash(data.password, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 });
  try {
    const user = await getSql().begin(async sql => {
      const [invite] = await sql`SELECT id FROM registration_invites WHERE token_hash=${tokenHash} AND used_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE`;
      if (!invite) throw new AppError(400, 'This invite code has expired, was used, or is invalid.');
      const [row] = await sql`INSERT INTO users (username,password_hash,email,role) VALUES (${data.username},${passwordHash},${data.email||null},'user') RETURNING id,username,email,role,settings`;
      await sql`INSERT INTO user_onboarding (user_id) VALUES (${row.id})`;
      await sql`UPDATE registration_invites SET used_by=${row.id},used_at=NOW() WHERE id=${invite.id}`;
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
export async function onboardingStatus(userId: string) {
  // Account generation and a fresh, successful USER traversal are both required.
  await getSql()`UPDATE user_onboarding o SET completed_at=NOW() FROM provider_connections c, sync_checkpoints s
    WHERE o.user_id=${userId} AND o.completed_at IS NULL AND c.id=o.connection_id AND c.user_id=o.user_id
    AND c.status='connected' AND c.account_generation=o.account_generation AND s.connection_id=c.id
    AND s.kind='jellyfin-user' AND s.completed_at>=o.requested_at AND s.scan_id IS NULL`;
  const [row] = await getSql()`SELECT o.*, c.status AS connection_status,c.account_generation AS current_generation FROM user_onboarding o LEFT JOIN provider_connections c ON c.id=o.connection_id WHERE o.user_id=${userId}`;
  if (!row || row.completed_at) return { complete: true, progress: null, reconnect: false, linked:false };
  const reconnect = !!row.connection_id && (row.connection_status !== 'connected' || row.current_generation !== row.account_generation);
  let progress = row.connection_id && !reconnect ? await libraryScanProgress(userId,row.connection_id,new Date(row.requested_at)) : null;
  if(row.connection_id&&!reconnect&&!progress){
    await enqueueAction({userId,connectionId:row.connection_id,kind:'jellyfin.sync',payload:{},compactionKey:'jellyfin.sync'});
    progress=await libraryScanProgress(userId,row.connection_id,new Date(row.requested_at));
  }
  return { complete: false, progress, reconnect, linked:!!row.connection_id };
}
export async function onboardingServices() {
  return getSql()`SELECT id,name FROM provider_instances WHERE provider='jellyfin' AND enabled=TRUE AND server_identity IS NOT NULL ORDER BY name`;
}
export async function linkOnboarding(userId: string, input: unknown) {
  if (!await onboardingPending(userId)) throw new AppError(409, 'Onboarding is already complete.');
  checkLoginRate(`onboarding:${userId}`);
  const data = v.parse(v.object({ instanceId:v.pipe(v.string(),v.uuid()),username:v.pipe(v.string(),v.minLength(1),v.maxLength(250)),password:v.pipe(v.string(),v.maxLength(4096)) }),input);
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
    const [busy] = await sql`SELECT a.id FROM outbox_actions a JOIN provider_connections c ON c.id=a.connection_id WHERE c.instance_id=${o.instance_id} AND a.kind='jellyfin.sync' AND a.state IN ('pending','running') LIMIT 1`;
    if (busy) throw new AppError(409,'A Jellyfin user import is already queued or running. Retry when it finishes.');
    await sql`UPDATE outbox_actions SET state='pending',next_attempt_at=NOW(),updated_at=NOW() WHERE id=(SELECT id FROM outbox_actions WHERE user_id=${userId} AND connection_id=${o.connection_id} AND kind='jellyfin.sync' AND state='failed' AND account_generation=(SELECT account_generation FROM provider_connections WHERE id=${o.connection_id}) ORDER BY created_at DESC LIMIT 1)`;
  });
  const [o] = await getSql()`SELECT connection_id FROM user_onboarding WHERE user_id=${userId}`;
  if (o?.connection_id) await enqueueAction({userId,connectionId:o.connection_id,kind:'jellyfin.sync',payload:{},compactionKey:'jellyfin.sync'});
}
