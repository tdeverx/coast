import { sequenceSourceSchema, type SequenceSource } from '../../media/sequence';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../server/db';
import { lists, media } from '../../server/db/schema';
import { DomainError } from '../errors';
import * as v from 'valibot';

export type SequenceEntry = {
  entryId: string;
  mediaId: string;
  watched: boolean;
  progress: number;
  duration: number;
  dropped: boolean;
  startedAt: string | null;
};

/** One ordered expansion for collection playback, progress and playlists. Entry identity survives repeated titles. */
export async function sequenceEntries(
  userId: string,
  raw: SequenceSource
): Promise<SequenceEntry[]> {
  const source = v.parse(sequenceSourceSchema, raw);
  const db = getDb();
  if (source.kind === 'playlist') {
    const [list] = await db
      .select()
      .from(lists)
      .where(and(eq(lists.id, source.id), eq(lists.userId, userId)));
    if (!list?.playlist) throw new DomainError('This playlist was not found.', 404, 'not_found');
  } else {
    const [item] = await db.select().from(media).where(eq(media.id, source.id));
    if (item?.kind !== 'collection')
      throw new DomainError('This collection was not found.', 404, 'not_found');
  }
  const seed =
    source.kind === 'playlist'
      ? sql`select li.media_id, li.id::text entry_id, array[li.position] sort_path, array[li.media_id] path
        from list_items li where li.list_id=${source.id}`
      : sql`select ${source.id}::uuid media_id, ${source.id}::text entry_id, array[0] sort_path, array[${source.id}::uuid] path`;
  const boundary =
    source.kind === 'playlist'
      ? sql`(select playback_started_at from lists where id=${source.id} and user_id=${userId})`
      : sql`(select started_at from rewatches where media_id=${source.id} and user_id=${userId})`;
  const eventScope =
    source.kind === 'playlist'
      ? sql`and ev.sequence->>'kind'='playlist' and ev.sequence->>'id'=${source.id} and ev.sequence->>'entryId'=n.entry_id`
      : sql``;
  const completion =
    source.kind === 'playlist'
      ? sql`coalesce((select ev.action='watch' from tracking_events ev
        where ev.user_id=${userId} and ev.media_id=n.media_id and ev.applied and ev.occurred_at_known
          and ev.action in ('watch','unwatch') and (${boundary} is null or ev.occurred_at>=${boundary}) ${eventScope}
        order by ev.occurred_at desc,ev.created_at desc,ev.id desc limit 1),false)::int`
      : sql`case when not coalesce(t.watched,false) then 0 when ${boundary} is null then greatest(t.play_count,1)
        else (select count(*)::int from (
          select ev.action,ev.rewatch,ev.occurred_at,ev.occurred_at_known,
            lag(ev.action) over(order by ev.occurred_at,ev.created_at,ev.id) prior
          from tracking_events ev where ev.user_id=${userId} and ev.media_id=n.media_id and ev.applied
            and ev.action in ('watch','unwatch')
        ) watches where action='watch' and (rewatch or prior is distinct from 'watch')
          and occurred_at_known and occurred_at>=${boundary}) end`;
  const rows = await db.execute<{
    entryId: string;
    mediaId: string;
    plays: number;
    progress: number;
    duration: number;
    dropped: boolean;
    startedAt: string | null;
  }>(sql`
    with recursive nodes as (
      ${seed}
      union all
      select edge.child_id, n.entry_id || '/' || edge.child_id, n.sort_path || edge.position, n.path || edge.child_id
      from nodes n join media parent on parent.id=n.media_id
      join lateral (
        select rel.child_id, row_number() over(order by rel.position, child.release_date nulls last, child.id)::int position
        from media_relationships rel join media child on child.id=rel.child_id
        where rel.parent_id=n.media_id and parent.kind='collection' and rel.kind in ('collection','franchise')
        union all
        select e.media_id, row_number() over(order by e.season_number,e.episode_number,e.media_id)::int
        from episodes e where ((parent.kind='show' and e.show_id=n.media_id) or (parent.kind='season' and e.season_id=n.media_id)) and not e.is_special
      ) edge on true
      where not edge.child_id=any(n.path)
    )
    select n.entry_id as "entryId", n.media_id as "mediaId",
      ${completion} as plays,
      case when ${source.kind === 'collection'} and ${boundary} is null then coalesce(t.position_seconds,0)
        else coalesce((select case when ev.action='progress' then ev.position_seconds else 0 end
          from tracking_events ev where ev.user_id=${userId} and ev.media_id=n.media_id and ev.applied
            and ev.occurred_at_known and (${boundary} is null or ev.occurred_at>=${boundary}) and ev.action in ('watch','unwatch','progress') ${eventScope}
          order by ev.occurred_at desc,ev.created_at desc,case when ev.action='watch' then 0 else 1 end,ev.id desc limit 1),0) end as progress,
      coalesce(t.duration_seconds,(select ep.runtime_minutes*60 from episodes ep where ep.media_id=n.media_id),m.runtime_minutes*60,0) as duration,
      exists(select 1 from tracking_state parent_state where parent_state.user_id=${userId} and parent_state.media_id=any(n.path) and parent_state.dropped) as dropped,
      ${boundary}::text as "startedAt"
    from nodes n join media m on m.id=n.media_id
      left join tracking_state t on t.media_id=n.media_id and t.user_id=${userId}
    where m.kind in ('movie','episode') order by n.sort_path,n.entry_id
  `);
  return Array.from(rows).map((row) => {
    const watched = row.plays > 0;
    const progress =
      !watched && row.duration > 0 && row.progress >= row.duration * 0.9 ? 0 : row.progress;
    return {
      entryId: row.entryId,
      mediaId: row.mediaId,
      watched,
      progress,
      duration: Number(row.duration),
      dropped: row.dropped,
      startedAt: row.startedAt,
    };
  });
}
export function nextSequenceEntry(entries: SequenceEntry[], afterEntryId?: string) {
  const start = afterEntryId ? entries.findIndex((entry) => entry.entryId === afterEntryId) : -1;
  if (afterEntryId && start < 0)
    throw new DomainError(
      'The sequence changed. Open it again to continue.',
      409,
      'sequence_changed'
    );
  return entries.slice(start + 1).find((entry) => !entry.dropped && !entry.watched) ?? null;
}
export async function restartPlaylist(userId: string, listId: string) {
  const [list] = await getDb()
    .update(lists)
    .set({ playbackStartedAt: new Date() })
    .where(and(eq(lists.id, listId), eq(lists.userId, userId), eq(lists.playlist, true)))
    .returning();
  if (!list) throw new DomainError('This playlist was not found.', 404, 'not_found');
}
