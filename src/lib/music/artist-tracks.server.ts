import { sql, type SQL } from 'drizzle-orm';

/** Catalogue membership is metadata: tracking never requires a playable connection. */
export function canonicalArtistTrackSql(workId: string | SQL, trackId: SQL) {
  return sql`exists(select 1 from music_credits credit where credit.work_id=${trackId} and credit.artist_id=${workId}::uuid)`;
}

export function canonicalArtistPlayableTrackSql(userId: string, workId: string, trackId: SQL) {
  return sql`${canonicalArtistTrackSql(workId, trackId)} and exists (
    select 1 from availability source
    join provider_connections connection on connection.id=source.connection_id
    join provider_instances instance on instance.id=connection.instance_id
    where source.media_id=${trackId} and source.user_id=${userId}::uuid and source.state='available'
      and connection.user_id=${userId}::uuid and connection.status='connected' and instance.enabled
      and instance.provider='jellyfin'
  )`;
}
