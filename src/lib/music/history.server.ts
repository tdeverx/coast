import {requireFeature, requireFeatureInTransaction, lockFeaturePolicyInTransaction} from '#lib/server/features.js';
import { presentationPreferences } from '#lib/catalogue/overrides/presentation.server.js';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '#lib/server/db/index.js';
import { musicWorks, musicListens, musicProgress, removedTrackingSources } from '#lib/server/db/schema.js';
import { DomainError } from '#lib/core/errors.js';
import { PAGE_SIZE, pageNumberSchema, pagination } from '#lib/server/queries/pagination.js';
import { musicAlbumMembersSql } from './editions.server';
import { canonicalArtistTrackSql } from './artist-tracks.server';
import { removeMusicCountOccurrence } from './sync-count.server';

/** Shared tombstones prevent an imported occurrence or retried playback batch from returning. */
export function retainedMusicListenSql(userId: string, trackId: string, batchId: string | SQL) {
  return sql`not exists(select 1 from removed_tracking_sources removal where removal.user_id=${userId}::uuid
    and removal.source='removed-music-listen' and removal.source_event_id=${trackId}::uuid::text||':'||${batchId}::uuid::text)`;
}

function historyScope(kind: string, workId: string, trackId: SQL) {
  return kind==='track'?sql`${trackId}=${workId}::uuid`:kind==='artist'?canonicalArtistTrackSql(workId,trackId)
    :sql`${trackId} in(select id from (${musicAlbumMembersSql(sql`${workId}::uuid`)}) members)`;
}

/** Remove one local occurrence without clearing position or other listens. Remote history is unchanged. */
export async function removeMusicListen(userId: string, workId: string, entryId: string) {
  const uuid=v.pipe(v.string(),v.uuid());
  v.parse(uuid,workId);
  v.parse(uuid,entryId);
  return getDb().transaction(async tx=>{
    await lockFeaturePolicyInTransaction(tx,userId);
    await requireFeatureInTransaction(tx,userId,'music');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [work]=await tx.select({kind:musicWorks.kind}).from(musicWorks).where(eq(musicWorks.id,workId));
    if(!work)throw new DomainError('Music not found.',404);
    const [entry]=await tx.select().from(musicListens).where(and(eq(musicListens.id,entryId),eq(musicListens.userId,userId),historyScope(work.kind,workId,sql`${musicListens.trackId}`))).for('update');
    if(!entry)return {removed:false};
    await tx.insert(removedTrackingSources).values({userId,source:'removed-music-listen',sourceEventId:`${entry.trackId}:${entry.batchId}`}).onConflictDoNothing();
    await tx.delete(musicListens).where(eq(musicListens.id,entry.id));
    await removeMusicCountOccurrence(tx,userId,entry.trackId,entry.batchId,entry.source);
    await (await import('#lib/sync/changes.server.js')).enqueueCollectionProjectionInTransaction(tx,userId);
    return {removed:true};
  });
}

/** Clear one owner's bookmark only; artist/album expansion is intentionally excluded. */
export async function resetMusicPosition(userId:string,workId:string){
  v.parse(v.pipe(v.string(),v.uuid()),workId);
  return getDb().transaction(async tx=>{
    await lockFeaturePolicyInTransaction(tx,userId);
    await requireFeatureInTransaction(tx,userId,'music');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [work]=await tx.select({kind:musicWorks.kind,durationSeconds:musicWorks.durationSeconds}).from(musicWorks).where(eq(musicWorks.id,workId));
    if(!work)throw new DomainError('Music not found.',404);
    if(work.kind!=='track')throw new DomainError('Choose one track to reset its saved position.');
    const [position]=await tx.select({position:musicProgress.positionSeconds,duration:musicProgress.durationSeconds}).from(musicProgress)
      .where(and(eq(musicProgress.userId,userId),eq(musicProgress.trackId,workId)));
    if(!position?.position)return {reset:false};
    await tx.update(musicProgress).set({positionSeconds:0,updatedAt:new Date()}).where(and(eq(musicProgress.userId,userId),eq(musicProgress.trackId,workId)));
    const {enqueueSyncValueInTransaction,enqueueCollectionProjectionInTransaction}=await import('#lib/sync/changes.server.js');
    await enqueueSyncValueInTransaction(tx,userId,workId,'progress',{positionSeconds:0,durationSeconds:position.duration??work.durationSeconds??0});
    await enqueueCollectionProjectionInTransaction(tx,userId);
    return {reset:true};
  });
}

/** Label-only artist choices use the existing catalogue, independent of playback and Presence. */
export async function musicArtistTrackChoices(userId: string, workId: string, requestedPage = 1) {
  v.parse(pageNumberSchema, requestedPage);
  await requireFeature(userId, 'music');
  const db = getDb();
  const [artist] = await db.select({ id: musicWorks.id }).from(musicWorks)
    .where(and(eq(musicWorks.id, workId), eq(musicWorks.kind, 'artist')));
  if (!artist) throw new DomainError('Artist not found.', 404);
  const size = 20;
  const items = await db.select({ id: musicWorks.id, title: musicWorks.title }).from(musicWorks)
    .where(and(eq(musicWorks.kind, 'track'), canonicalArtistTrackSql(workId, sql`${musicWorks.id}`)))
    .orderBy(asc(musicWorks.title), asc(musicWorks.id)).limit(size + 1).offset((requestedPage - 1) * size);
  return { items: items.slice(0, size), hasMore: items.length > size };
}

/** Track history, or the selected album edition's tracks, with owner filtering before paging. */
export async function musicHistory(userId: string, workId: string, requestedPage = 1) {
  v.parse(pageNumberSchema, requestedPage);
  await requireFeature(userId,'music');
  const db = getDb();
  const [work] = await db.select({ kind: musicWorks.kind }).from(musicWorks).where(eq(musicWorks.id, workId));
  if (!work) throw new DomainError('Music not found.', 404);
  const scope = historyScope(work.kind,workId,sql`l.track_id`);
  const where = sql`l.user_id=${userId} and ${scope}`;
  const [count] = await db.execute<{ total: number }>(sql`select count(*)::int total from music_listens l where ${where}`);
  const { page, pages } = pagination(count.total, requestedPage);
  type Row = { id: string; workId: string; title: string; occurredAt: Date; dateKnown: boolean; source: string };
  const rows = await db.execute<Row>(sql`
    select l.id,m.id as "workId",m.title,l.occurred_at as "occurredAt",l.occurred_at_known as "dateKnown",l.source
    from music_listens l join music_works m on m.id=l.track_id where ${where}
    order by l.occurred_at desc,l.id desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`);
  const events=Array.from(rows) as Row[];
  const preferences=await presentationPreferences(userId,events.map(event=>event.workId));
  return { items: events.map(row => ({ ...row, title: preferences.get(row.workId)?.title ?? row.title, occurredAt: row.occurredAt.toISOString() })), page, pages, total: count.total };
}
