import { sql, type SQL } from 'drizzle-orm';
import { getDb, type Database } from '$lib/server/db';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type MusicMember = { id: string; title: string; entryId: string; position: number; discNumber: number | null; trackNumber: number | null };

/** A release's provider items are occurrences: two items may share one recording.
 * Native albums without a provider edition retain their explicit relationships. */
export function musicAlbumMembersSql(workId: SQL) {
  return sql`select t.id,t.title,e.id::text as "entryId",
      coalesce((e.metadata->>'position')::integer,10000) as position,
      (e.metadata->>'discNumber')::integer as "discNumber",(e.metadata->>'trackNumber')::integer as "trackNumber"
    from music_works a join work_editions album on album.id=a.selected_edition_id
    join lateral (select distinct on(replace(lower(member.external_id),'-','')) member.* from work_editions member
      where member.instance_id=album.instance_id and replace(lower(member.metadata->>'albumExternalId'),'-','')=replace(lower(album.external_id),'-','')
      order by replace(lower(member.external_id),'-',''),member.id) e on true
    join music_works t on t.id=e.work_id and t.kind='track'
    where a.id=${workId} and a.kind='album'
    union all select t.id,t.title,r.child_id::text as "entryId",r.position,
      r.position/10000 as "discNumber",r.position%10000 as "trackNumber"
    from music_works a join media_relationships r on r.parent_id=a.id and r.kind='contains'
    join music_works t on t.id=r.child_id and t.kind='track'
    where a.id=${workId} and a.kind='album' and a.selected_edition_id is null`;
}

export async function musicAlbumMembers(workId: string, tx: Transaction | Database = getDb(), limit=10000, offset=0) {
  return Array.from(await tx.execute<MusicMember>(sql`select * from (${musicAlbumMembersSql(sql`${workId}::uuid`)}) members order by position,"entryId" limit ${limit} offset ${offset}`));
}
