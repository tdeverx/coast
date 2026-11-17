import * as v from 'valibot';
import { and, eq, sql } from 'drizzle-orm';
import { episodeHasAired } from '#lib/catalogue/metadata/release-date.server.js';
import { canonicalArtistTrackSql } from '#lib/music/artist-tracks.server.js';
import { trackInTransaction } from '#lib/core/tracking/service.server.js';
import { getConfig } from '#lib/server/config.js';
import { getDb, type Database } from '#lib/server/db/index.js';
import { providerConnections, providerInstances, socialActivity, socialCheckins, socialLiveDeliveries } from '#lib/server/db/schema.js';
import { lockFeaturePolicyInTransaction } from '#lib/server/features.js';
import { AppError } from '#lib/server/security/errors.js';
import { enqueueInTransaction, enqueueTraktChangeInTransaction } from '#lib/sync/changes.server.js';
import { episodeCheckinScope, supportsCheckin } from './checkins';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type CheckinRow = typeof socialCheckins.$inferSelect;
const uuid = v.pipe(v.string(), v.uuid());
const MANUAL_CHECKIN_LIFETIME = 24 * 60 * 60 * 1000;

async function lockCheckins(tx: Transaction, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
}

async function queueTimedCheckin(tx: Transaction, userId: string, checkinId: string) {
  const connections = await tx.select({ id: providerConnections.id }).from(providerConnections)
    .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
    .where(and(eq(providerConnections.userId, userId), eq(providerConnections.status, 'connected'),
      eq(providerInstances.provider, 'trakt'), eq(providerInstances.enabled, true),
      sql`${providerConnections.settings}->'sync'->>'scrobble'='true'`));
  for (const { id } of connections)
    await enqueueInTransaction(tx, { userId, connectionId: id, kind: 'trakt.checkin', payload: {checkinId}, compactionKey: `checkin:${checkinId}` });
}

async function findOwned(tx: Transaction, userId: string, id: string) {
  const [row] = await tx.select().from(socialCheckins)
    .where(and(eq(socialCheckins.id, id), eq(socialCheckins.userId, userId))).for('update');
  return row;
}

async function setCheckinState(tx: Transaction, id: string, state: 'completed' | 'cancelled') {
  await tx.update(socialCheckins).set({ state, updatedAt: new Date() }).where(eq(socialCheckins.id, id));
  return { state };
}

async function checkinAllowed(tx: Transaction, userId: string, workId: string) {
  const [policy] = await tx.execute<{ allowed: boolean }>(sql`
    select coast_feature_enabled(${userId}::uuid,'presence')
      and coast_category_enabled(${userId}::uuid,w.category) as allowed
    from works w where w.id=${workId}::uuid`);
  return !!policy?.allowed;
}

async function expireCheckin(tx: Transaction, row: CheckinRow) {
  if (row.mode === 'manual' || !(await checkinAllowed(tx, row.userId, row.workId))) {
    await setCheckinState(tx, row.id, 'cancelled');
    return;
  }
  const occurredAt = row.expiresAt.toISOString();
  const result = await trackInTransaction(tx, row.userId, {
    mediaId: row.workId, action: 'watch', source: 'coast', sourceEventId: `checkin:${row.id}`, occurredAt, rewatch: true,
  });
  if (!result.duplicate) {
    // Trakt completes a delivered check-in itself. Exclude its exact account generation.
    const delivered = await tx.select({ connectionId: socialLiveDeliveries.connectionId }).from(socialLiveDeliveries)
      .innerJoin(providerConnections, and(eq(providerConnections.id, socialLiveDeliveries.connectionId),
        eq(providerConnections.accountGeneration, socialLiveDeliveries.accountGeneration)))
      .where(and(eq(socialLiveDeliveries.checkinId, row.id), sql`${socialLiveDeliveries.state} in ('started','uncertain')`));
    await enqueueTraktChangeInTransaction(tx, row.userId, {
      mediaId: row.workId, category: 'history', occurredAt, eventId: result.eventId ?? undefined,
      excludeConnectionIds: delivered.map(entry => entry.connectionId),
    });
  }
  await setCheckinState(tx, row.id, 'completed');
}

export async function startCheckin(userId: string, raw: unknown) {
  const { workId, parentWorkId, artistWorkId } = v.parse(v.object({ workId: uuid, parentWorkId: v.optional(uuid), artistWorkId: v.optional(uuid) }), raw);
  return getDb().transaction(async tx => {
    await lockFeaturePolicyInTransaction(tx, userId);
    await lockCheckins(tx, userId);
    const [work] = await tx.execute<{ kind: string; presence: boolean; enabled: boolean; duration: number | null }>(sql`
      select w.kind, coast_feature_enabled(${userId}::uuid,'presence') as presence,
        coast_category_enabled(${userId}::uuid,w.category) as enabled,
        case when m.kind in ('movie','episode') then coalesce(
          nullif(greatest(m.runtime_minutes,0),0)::double precision * 60,
          nullif(greatest(e.runtime_minutes,0),0)::double precision * 60,
          (select a.duration_seconds from availability a
            join provider_connections c on c.id=a.connection_id and c.user_id=a.user_id and c.status='connected'
            join provider_instances i on i.id=c.instance_id and i.enabled and i.provider='jellyfin'
            where a.user_id=${userId} and a.media_id=m.id and a.state='available' and a.duration_seconds>0
              and a.duration_seconds<'Infinity'::real
            order by a.verified_at desc,a.id limit 1),
          nullif(greatest(series.runtime_minutes,0),0)::double precision * 60
        ) end as duration
      from works w left join media m on m.id=w.id left join episodes e on e.media_id=m.id
      left join media series on series.id=e.show_id where w.id=${workId}::uuid
    `);
    if (!work) throw new AppError(404, 'This work was not found.');
    if (!work.presence || !work.enabled) throw new AppError(403, 'Check-ins are disabled for this work.', 'feature_disabled');
    if (!supportsCheckin(work.kind) || episodeCheckinScope(work.kind))
      throw new AppError(400, 'Choose a title or a specific episode to check in.');
    if (parentWorkId) {
      const { metadataSource } = await getConfig(tx);
      const [episode] = await tx.execute(sql`select e.media_id from episodes e where e.media_id=${workId}::uuid
        and (e.show_id=${parentWorkId}::uuid or e.season_id=${parentWorkId}::uuid)
        and not e.is_special and ${episodeHasAired(sql`e.media_id`, metadataSource)}`);
      if (!episode) throw new AppError(409, 'That episode is no longer selectable for this show or season.');
    }
    if (artistWorkId) {
      const [track] = await tx.execute(sql`select t.id from music_works t where t.id=${workId}::uuid
        and t.kind='track' and exists(select 1 from music_works artist where artist.id=${artistWorkId}::uuid and artist.kind='artist')
        and ${canonicalArtistTrackSql(artistWorkId, sql`t.id`)}`);
      if (!track) throw new AppError(409, 'That track is no longer selectable for this artist.');
    }

    const [playing] = await tx.execute<{ active: boolean }>(sql`select exists (
      select 1 from playback_sessions where share_id is null and user_id=${userId}
        and state='active' and expires_at>now() and updated_at>now()-interval '2 minutes'
    ) or exists (
      select 1 from reading_sessions r left join provider_connections c on c.id=r.connection_id
      left join provider_instances i on i.id=c.instance_id where r.user_id=${userId} and r.share_id is null
        and r.closed_at is null and r.expires_at>now() and r.updated_at>now()-interval '2 minutes'
        and (r.connection_id is null or c.status='connected' and i.enabled and c.account_generation=r.account_generation)
    ) as active`);
    if (playing.active) throw new AppError(409, 'Close your active player or reader before checking in.');
    const [current] = await tx.select().from(socialCheckins)
      .where(and(eq(socialCheckins.userId, userId), eq(socialCheckins.state, 'active'))).for('update');
    const now = Date.now();
    if (current && current.expiresAt.getTime() > now) {
      if (current.workId === workId) return current;
      throw new AppError(409, 'Finish or cancel your current check-in first.');
    }
    if (current) await expireCheckin(tx, current);
    const duration = work.duration && Number.isFinite(work.duration) && work.duration > 0 ? work.duration * 1000 : null;
    const [row] = await tx.insert(socialCheckins).values({
      userId, workId, mode: duration === null ? 'manual' : 'timed',
      expiresAt: new Date(now + (duration ?? MANUAL_CHECKIN_LIFETIME)),
    }).returning();
    if (row.mode === 'timed') await queueTimedCheckin(tx, userId, row.id);
    return row;
  });
}

export async function cancelCheckin(userId: string, id: string) {
  return getDb().transaction(async tx => {
    await lockFeaturePolicyInTransaction(tx, userId);
    await lockCheckins(tx, userId);
    const row = await findOwned(tx, userId, id);
    if (!row) throw new AppError(404, 'Check-in not found.');
    if (row.state !== 'active') return { state: row.state };
    const result = await setCheckinState(tx, id, 'cancelled');
    if (row.mode === 'timed') {
      const deliveries = await tx.select({ id: socialLiveDeliveries.connectionId }).from(socialLiveDeliveries)
        .innerJoin(providerConnections, and(eq(providerConnections.id, socialLiveDeliveries.connectionId),
          eq(providerConnections.accountGeneration, socialLiveDeliveries.accountGeneration)))
        .where(and(eq(socialLiveDeliveries.checkinId, id), eq(providerConnections.userId, userId),
          eq(providerConnections.status, 'connected'), sql`${socialLiveDeliveries.state} in ('started','uncertain')`));
      for (const delivery of deliveries) await enqueueInTransaction(tx, {
        userId, connectionId: delivery.id, kind: 'trakt.checkin', payload: {checkinId: id}, compactionKey: `checkin:${id}`,
      });
    }
    return result;
  });
}

/** Finish is an explicit activity record. It does not infer completion or progress. */
export async function finishCheckin(userId: string, id: string) {
  return getDb().transaction(async tx => {
    await lockFeaturePolicyInTransaction(tx, userId);
    await lockCheckins(tx, userId);
    const row = await findOwned(tx, userId, id);
    if (!row) throw new AppError(404, 'Check-in not found.');
    if (row.mode !== 'manual') throw new AppError(409, 'This timed check-in completes automatically.');
    if (row.state !== 'active') return { state: row.state };
    if (row.expiresAt.getTime() <= Date.now() || !(await checkinAllowed(tx, userId, row.workId)))
      return setCheckinState(tx, id, 'cancelled');
    await tx.insert(socialActivity).values({
      userId, workId: row.workId, eventKind: 'checkin', section: 'activity',
      source: 'coast', sourceKey: `social_checkins:${id}`, occurredAt: new Date(),
    }).onConflictDoNothing();
    return setCheckinState(tx, id, 'completed');
  });
}

export async function completeCheckin(userId: string, id: string) {
  await getDb().transaction(async tx => {
    await lockFeaturePolicyInTransaction(tx, userId);
    await lockCheckins(tx, userId);
    const row = await findOwned(tx, userId, id);
    if (row?.state === 'active' && row.expiresAt.getTime() <= Date.now()) await expireCheckin(tx, row);
  });
}
