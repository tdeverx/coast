import { requireFeatureInTransaction } from '#lib/server/features.js';
import { sequenceContextSchema, sequenceSourceSchema, type SequenceContext, type SequenceSource } from '../../media/sequence';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '../../server/db';
import { lists } from '../../server/db/schema';
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
export type SequenceSummary = {
  total: number;
  completed: number;
  watched: boolean;
  progress: number;
  duration: number;
};
type SequenceDatabase = Pick<Database, 'select' | 'execute'>;
const BATCH_SIZE = 60;
const uuidSchema = v.pipe(v.string(), v.uuid());
const sourceKey = (source: SequenceSource) => `${source.kind}:${source.id}`;
const sequenceEventScope = () => sql`and (n.source_kind<>'playlist' or (ev.sequence->>'kind'='playlist'
  and ev.sequence->>'id'=n.source_id::text and ev.sequence->>'entryId'=n.entry_id))`;
/** Complete and exact occurrence reads share the same occurrence/rewatch rule. */
function sequenceWatched(userId: string) {
  return sql`case when n.source_kind='playlist' then coalesce((select ev.action='watch' from tracking_events ev
    where ev.user_id=${userId} and ev.media_id=n.media_id and ev.applied and ev.occurred_at_known
      and ev.action in ('watch','unwatch') and (n.boundary is null or ev.occurred_at>=n.boundary) ${sequenceEventScope()}
    order by ev.occurred_at desc,ev.created_at desc,ev.id desc limit 1),false)
  else (case when not coalesce(t.watched,false) then 0 when n.boundary is null then greatest(t.play_count,1)
    else (select count(*)::int from (
      select ev.action,ev.rewatch,ev.occurred_at,ev.occurred_at_known,
        lag(ev.action) over(order by ev.occurred_at,ev.created_at,ev.id) prior
      from tracking_events ev where ev.user_id=${userId} and ev.media_id=n.media_id and ev.applied
        and ev.action in ('watch','unwatch')
    ) watches where action='watch' and (rewatch or prior is distinct from 'watch')
      and occurred_at_known and occurred_at>=n.boundary) end)>0 end`;
}

/** One recursive definition serves explicit playback, card summaries and next-entry planning.
 * Source keys and playlist entry roots preserve repeated titles and independent rewatches.
 */
function sequenceRows(userId: string, sources: SequenceSource[], entryIds?: string[], entryPath?: string[]) {
  const requested = sql.join(sources.map(source => sql`(${source.kind}::text,${source.id}::uuid)`), sql`, `);
  const eventScope = sequenceEventScope();
  const expectedPath = entryPath && sql`array[${sql.join(entryPath.map(id => sql`${id}::uuid`),sql`, `)}]`;
  return sql`with recursive requested(source_kind,source_id) as (values ${requested}), sources as (
    select r.*,case when r.source_kind='playlist' then l.playback_started_at else rw.started_at end as boundary
    from requested r left join lists l on r.source_kind='playlist' and l.id=r.source_id and l.user_id=${userId}
    left join rewatches rw on r.source_kind='collection' and rw.media_id=r.source_id and rw.user_id=${userId}
  ), nodes as (
    select s.source_kind,s.source_id,s.boundary,s.source_id as media_id,s.source_id::text as entry_id,
      array[0] as sort_path,array[s.source_id] as path from sources s where s.source_kind='collection'
      and ${entryPath === undefined ? sql`true` : sql`s.source_id=(${expectedPath})[1]`}
    union all
    select s.source_kind,s.source_id,s.boundary,li.media_id,li.id::text,array[li.position],array[li.media_id]
      from sources s join list_items li on li.list_id=s.source_id where s.source_kind='playlist'
      and ${entryIds ? sql`li.id in (${sql.join(entryIds.map(id => sql`${id}::uuid`), sql`,`)})` : sql`true`}
      and ${entryPath === undefined ? sql`true` : sql`li.id=(${expectedPath})[1]`}
    union all
    select n.source_kind,n.source_id,n.boundary,edge.child_id,n.entry_id||'/'||edge.child_id,
      n.sort_path||edge.position,n.path||edge.child_id
    from nodes n join media parent on parent.id=n.media_id
    join lateral (
      select rel.child_id,row_number() over(order by rel.position,child.release_date nulls last,child.id)::int position
      from media_relationships rel join media child on child.id=rel.child_id
      where rel.parent_id=n.media_id and parent.kind='collection' and rel.kind in ('collection','franchise')
        and ${entryPath === undefined ? sql`true` : sql`rel.child_id=(${expectedPath})[cardinality(n.path)+1]`}
      union all
      select e.media_id,row_number() over(order by e.season_number,e.episode_number,e.media_id)::int
      from episodes e where ((parent.kind='show' and e.show_id=n.media_id) or
        (parent.kind='season' and e.season_id=n.media_id)) and not e.is_special
        and ${entryPath === undefined ? sql`true` : sql`e.media_id=(${expectedPath})[cardinality(n.path)+1]`}
    ) edge on true where not edge.child_id=any(n.path)
  ), observed as (
    select n.source_kind,n.source_id,n.sort_path,n.entry_id,n.media_id,n.boundary,
      ${sequenceWatched(userId)} as watched,
      case when n.source_kind='collection' and n.boundary is null then coalesce(t.position_seconds,0)
        else coalesce((select case when ev.action='progress' then ev.position_seconds else 0 end
          from tracking_events ev where ev.user_id=${userId} and ev.media_id=n.media_id and ev.applied
            and ev.occurred_at_known and (n.boundary is null or ev.occurred_at>=n.boundary)
            and ev.action in ('watch','unwatch','progress') ${eventScope}
          order by ev.occurred_at desc,ev.created_at desc,case when ev.action='watch' then 0 else 1 end,ev.id desc limit 1),0) end as raw_progress,
      coalesce(t.duration_seconds,(select ep.runtime_minutes*60 from episodes ep where ep.media_id=n.media_id),m.runtime_minutes*60,0) as duration,
      exists(select 1 from tracking_state parent_state where parent_state.user_id=${userId}
        and parent_state.media_id=any(n.path) and parent_state.dropped) as dropped
    from nodes n join media m on m.id=n.media_id
    left join tracking_state t on t.media_id=n.media_id and t.user_id=${userId}
    where coast_feature_enabled(${userId}::uuid,'screen') and m.kind in ('movie','episode')
  ), entries as (
    select *,case when not watched and duration>0 and raw_progress>=duration*0.9 then 0 else raw_progress end as progress
    from observed
  )`;
}

async function validateSources(userId: string, sources: SequenceSource[], db: SequenceDatabase) {
  const requested = sql.join(sources.map(source => sql`(${source.kind}::text,${source.id}::uuid)`), sql`, `);
  const rows = await db.execute<{kind: SequenceSource['kind'];id: string}>(sql`
    with requested(kind,id) as (values ${requested}) select r.* from requested r
    where case when r.kind='playlist' then exists(select 1 from lists l where l.id=r.id and l.user_id=${userId} and l.playlist)
      else exists(select 1 from media m where m.id=r.id and m.kind='collection') end`);
  const valid = new Set(Array.from(rows as {kind: SequenceSource['kind'];id: string}[], sourceKey));
  const missing = sources.find(source => !valid.has(sourceKey(source)));
  if (missing) throw new DomainError(`This ${missing.kind} was not found.`, 404, 'not_found');
}

/** Transactional callers retain their own handle, locks and uncommitted state. */
export async function sequenceEntries(userId: string, raw: SequenceSource, db: SequenceDatabase = getDb(), selectedEntryIds?: string[]): Promise<SequenceEntry[]> {
  const source = v.parse(sequenceSourceSchema, raw);
  await validateSources(userId, [source], db);
  const entryIds = selectedEntryIds && v.parse(v.pipe(v.array(v.pipe(v.string(),v.uuid())),v.maxLength(BATCH_SIZE)), selectedEntryIds);
  if (entryIds?.length === 0) return [];
  const rows = await db.execute<SequenceEntry>(sql`${sequenceRows(userId,[source],entryIds)}
    select entry_id as "entryId",media_id as "mediaId",watched,progress,duration,dropped,boundary::text as "startedAt"
    from entries order by sort_path,entry_id`);
  return Array.from(rows as SequenceEntry[], row => ({...row,duration:Number(row.duration)}));
}

/** Validate one live occurrence without expanding unrelated roots or branches.
 * Malformed cursors have no matching occurrence; validated UUID segments allow
 * indexed child lookups while the final text comparison preserves exact identity.
 * Full enumeration and this read retain one definition for edges, cycles and state.
 */
export async function sequenceEntry(userId: string, raw: SequenceContext, mediaId: string, db: SequenceDatabase = getDb()): Promise<SequenceEntry | null> {
  const source = v.parse(sequenceContextSchema, raw);
  await validateSources(userId, [source], db);
  const path = source.entryId.split('/');
  if (path.some(id => !v.is(uuidSchema,id))) return null;
  const rows = await db.execute<SequenceEntry>(sql`${sequenceRows(userId,[source],undefined,path)}
    select entry_id as "entryId",media_id as "mediaId",watched,progress,duration,dropped,boundary::text as "startedAt"
    from entries where entry_id=${source.entryId} and media_id::text=${mediaId} limit 1`);
  const [row] = rows as SequenceEntry[];
  return row ? {...row,duration:Number(row.duration)} : null;
}

/** Summary and next-entry readers transfer only one bounded result per source. */
export async function sequenceSummaries(userId: string, raw: SequenceSource[], db: SequenceDatabase = getDb()) {
  const sources = [...new Map(v.parse(v.array(sequenceSourceSchema),raw).map(source => [sourceKey(source),source])).values()];
  const result = new Map<string,SequenceSummary>();
  for (let offset=0;offset<sources.length;offset+=BATCH_SIZE) {
    const batch = sources.slice(offset,offset+BATCH_SIZE);
    await validateSources(userId,batch,db);
    const rows = await db.execute<SequenceSummary & {kind:SequenceSource['kind'];id:string}>(sql`${sequenceRows(userId,batch)}
      select source_kind as kind,source_id as id,count(*)::int as total,count(*) filter(where watched)::int as completed,
        bool_and(watched) as watched,coalesce(sum(duration),0)::double precision as duration,
        coalesce(sum(case when watched then duration else progress end),0)::double precision as progress
      from entries group by source_kind,source_id`);
    for (const source of batch) result.set(sourceKey(source),{total:0,completed:0,watched:false,duration:0,progress:0});
    for (const row of rows as (SequenceSummary & {kind:SequenceSource['kind'];id:string})[]) result.set(sourceKey(row),{total:row.total,completed:row.completed,watched:row.watched,duration:row.duration,progress:row.progress});
  }
  return result;
}
export async function nextSequenceEntries(userId: string, raw: SequenceSource[], db: SequenceDatabase = getDb()) {
  const sources = [...new Map(v.parse(v.array(sequenceSourceSchema),raw).map(source => [sourceKey(source),source])).values()];
  const result = new Map<string,SequenceEntry>();
  for (let offset=0;offset<sources.length;offset+=BATCH_SIZE) {
    const batch=sources.slice(offset,offset+BATCH_SIZE);
    await validateSources(userId,batch,db);
    const rows = await db.execute<SequenceEntry & {kind:SequenceSource['kind'];id:string}>(sql`${sequenceRows(userId,batch)}
      select distinct on(source_kind,source_id) source_kind as kind,source_id as id,entry_id as "entryId",
        media_id as "mediaId",watched,progress,duration,dropped,boundary::text as "startedAt"
      from entries where not watched and not dropped order by source_kind,source_id,sort_path,entry_id`);
    for (const {kind,id,...row} of rows as (SequenceEntry & {kind:SequenceSource['kind'];id:string})[]) result.set(sourceKey({kind,id}),{...row,duration:Number(row.duration)});
  }
  return result;
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
  return getDb().transaction(async tx=>{
  await requireFeatureInTransaction(tx,userId,'playback');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
  const [list] = await tx
    .update(lists)
    .set({ playbackStartedAt: new Date() })
    .where(and(eq(lists.id, listId), eq(lists.userId, userId), eq(lists.playlist, true)))
    .returning();
  if (!list) throw new DomainError('This playlist was not found.', 404, 'not_found');
  });
}
