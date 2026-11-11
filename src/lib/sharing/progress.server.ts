import { sql } from 'drizzle-orm';
import { getDb, getSql } from '#lib/server/db/index.js';
import { lockFeaturePolicyInTransaction } from '#lib/server/features.js';
import { trackInTransaction } from '#lib/core/tracking/service.server.js';
import { shareCompletionPercent } from './policy';

const completionFraction = shareCompletionPercent / 100;

/** Each link can contribute one watch, even when two viewers finish at the same time. */
export async function completeShare(ownerId: string, shareId: string, playbackId: string) {
  await getDb().transaction(async tx => {
    await lockFeaturePolicyInTransaction(tx, ownerId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ownerId},0))`);
    const [share] = await tx.execute<{work_id:string;track_progress:boolean;media_type:string}>(sql`
      update playback_shares s set completed_at=now()
      from playback_sessions p join share_viewers v on v.id=p.share_viewer_id and v.playback_id=p.id
      join provider_connections c on c.id=p.connection_id and c.user_id=p.user_id
      join provider_instances i on i.id=c.instance_id join users owner on owner.id=p.user_id
      where s.id=${shareId} and s.owner_id=${ownerId} and p.id=${playbackId} and p.share_id=s.id
        and s.completed_at is null and s.revoked_at is null and s.expires_at>now()
        and (s.auto_revoke or s.track_progress) and v.ended_at is null and p.expires_at>now()
        and p.duration_seconds>0 and p.played_seconds>=p.duration_seconds*${completionFraction}
        and coast_feature_enabled(s.owner_id,'sharing')
        and (not s.together or coast_feature_enabled(s.owner_id,'parties'))
        and (owner.role='admin' or owner.settings->>'allowPlaybackSharing'='true')
        and c.status='connected' and c.account_generation=s.account_generation and i.enabled
        and exists(select 1 from availability a where a.user_id=s.owner_id and a.connection_id=c.id and a.media_id=s.work_id and a.state='available')
      returning s.work_id,s.track_progress,p.media_type`);
    if (share?.track_progress && share.media_type === 'video') {
      await trackInTransaction(tx, ownerId, {
        mediaId: share.work_id, action: 'watch', source: 'playback',
        sourceEventId: `share:${shareId}`, rewatch: true, acknowledged: true,
      });
    }
  });
}

/** Jellyfin supplies the position and length in each signed Coast resource URL. */
export async function recordShareSegment(ownerId: string, shareId: string, playbackId: string, start: number, length: number) {
  const startMs = Math.round(start / 10_000);
  const endMs = Math.round((start + length) / 10_000);
  const [session] = await getSql()`with segment as (
    select p.id,s.completed_at,coalesce(p.share_segment_coverage,'{}'::int8multirange) + int8multirange(int8range(
      ${startMs}::bigint,least(${endMs}::bigint,round(p.duration_seconds::double precision*1000)::bigint)
    )) as coverage
    from playback_sessions p join share_viewers v on v.id=p.share_viewer_id and v.playback_id=p.id
      join playback_shares s on s.id=p.share_id
    where p.id=${playbackId} and s.id=${shareId} and s.owner_id=${ownerId} and v.ended_at is null
      and s.revoked_at is null and s.expires_at>now() and p.expires_at>now() and p.state<>'stopped'
      and ${startMs}<round(p.duration_seconds::double precision*1000)
    for update of p
  ) update playback_sessions p set share_segment_coverage=segment.coverage,
    played_seconds=(select sum(upper(span)-lower(span))/1000.0 from unnest(segment.coverage) span),
    state='active',position_seconds=least(${endMs}/1000.0,p.duration_seconds),updated_at=now()
    from segment where p.id=segment.id
    returning segment.completed_at is null and p.played_seconds>=p.duration_seconds*${completionFraction} as complete`;
  if (session?.complete) await completeShare(ownerId, shareId, playbackId);
}
