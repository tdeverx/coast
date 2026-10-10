import { sql } from 'drizzle-orm';
import { getDb } from '../db';

/** Only transient records. History, playback evidence and the outbox are deliberately retained. */
export async function pruneTransientRecords() {
  return getDb().transaction(async tx => {
    const [lock] = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended('coast:transient-retention',0)) as acquired`);
    if (!lock?.acquired) return { busy: true, removed: 0, expired: 0, more: false };
    // Use bounded batches; SKIP LOCKED leaves records being redeemed/approved alone.
    const sessions = await tx.execute(sql`delete from sessions where id in (select id from sessions where expires_at < now() order by expires_at limit 500 for update skip locked) returning id`);
    const previews = await tx.execute(sql`delete from collection_projection_previews where id in (select id from collection_projection_previews where approved=false and created_at < now()-interval '1 day' order by created_at limit 500 for update skip locked) returning id`);
    // Redeemed invites remain as onboarding evidence. Keep expired/revoked unused codes for 30 days.
    const invites = await tx.execute(sql`delete from registration_invites where id in (select id from registration_invites where used_at is null and (expires_at < now()-interval '30 days' or revoked_at < now()-interval '30 days') order by created_at limit 500 for update skip locked) returning id`);
    const expired = await tx.execute(sql`update synced_rooms set ended_at=now(), paused=true, revision=revision+1 where id in (select id from synced_rooms where ended_at is null and created_at < now()-interval '24 hours' order by created_at limit 500 for update skip locked) returning id`);
    const rooms = await tx.execute(sql`delete from synced_rooms where id in (select id from synced_rooms where ended_at < now()-interval '7 days' order by ended_at limit 500 for update skip locked) returning id`);
    const diagnostics = await tx.execute(sql`delete from diagnostics where id in (select id from diagnostics where created_at < now()-interval '7 days' order by created_at limit 500 for update skip locked) returning id`);
    // Stale interrupted imports can restart from a fresh census. Keep actively
    // executing observations; account effects and history remain permanent.
    const staging = await tx.execute(sql`delete from trakt_import_stages where id in (select s.id from trakt_import_stages s join outbox_actions a on a.id=s.action_id where s.updated_at < now()-interval '30 days' and a.state<>'running' order by s.updated_at limit 500 for update of s skip locked) returning id`);
    const snapshots=await tx.execute(sql`delete from provider_job_snapshots where action_id in (select s.action_id from provider_job_snapshots s join outbox_actions a on a.id=s.action_id where s.updated_at < now()-interval '30 days' and a.state<>'running' order by s.updated_at limit 500 for update of s skip locked) returning action_id`);
    // Preserve the newest bookmark of each edition, including closed sessions.
    const reading=await tx.execute(sql`delete from reading_sessions where id in (select s.id from reading_sessions s where s.expires_at < now()-interval '30 days' and exists(select 1 from reading_sessions newer where newer.user_id=s.user_id and newer.work_id=s.work_id and newer.edition=s.edition and newer.format=s.format and (newer.updated_at,newer.id)>(s.updated_at,s.id)) order by s.updated_at limit 500 for update of s skip locked) returning id`);
    return { busy: false, removed: sessions.length + previews.length + invites.length + rooms.length + diagnostics.length + staging.length + snapshots.length + reading.length, expired: expired.length, more: [sessions, previews, invites, expired, rooms, diagnostics, staging, snapshots,reading].some(rows => rows.length === 500) };
  });
}
