import {librarySegmentCondition} from '#lib/server/queries/library-segments.js';
import {librarySortValues,librarySegmentValues} from '#lib/library.js';
import {libraryOrder} from '#lib/server/queries/library-order.js';
import { getFeatureConfig } from '#lib/server/features.js';
import { personaliseWorkCards } from '#lib/catalogue/overrides/presentation.server.js';
import { enabledCategories, requireEnabledCategory, selectedCategory } from '#lib/server/experimental.js';
import { sql, eq, inArray, type SQL } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '#lib/server/db/index.js';
import { withReadCancellation } from '#lib/server/db/read-cancellation.js';
import { logDiagnostic } from '#lib/server/diagnostics/index.js';
import { works, musicWorks, readingWorks, providerItems, providerConnections, providerInstances } from '#lib/server/db/schema.js';
import { mediaViews, screenWorkSummaries } from '#lib/server/queries/media.js';
import { profileUser } from '#lib/server/queries/profile-user.js';
import { PAGE_SIZE, pageNumberSchema, pagination, requestedPageInterval } from '#lib/server/queries/pagination.js';
import type { MediaCardPresentation, MediaView, WorkSummary } from '#lib/ui/types.js';
import { readingCards } from '#lib/reading/query.server.js';
import { musicWorkCredits } from '#lib/music/credits.server.js';
import { readingCard } from '#lib/reading/presentation.js';

import { pageInterval, type PageInterval } from '#lib/page-window.js';

/** Cached inventory proves positive access only with this account's fresh grant
 * and the exact completed library census; it never proves negative user state. */
function inheritedScreenAccess(source:SQL, scanId:SQL, settings:SQL, generation:SQL, inventory:SQL) {
  return sql`(${source}->>'coastAccessKind'='library-cache'
    and ${source}->>'coastAccessGeneration'=${generation}::text
    and ${settings}->'screenAccessInherited'->>'accountGeneration'=${generation}::text
    and ${scanId}::text=${settings}->'screenAccessInherited'->>'scanId'
    and ${source}->>'coastLibraryScanId'=${settings}->'screenAccessInherited'->'libraries'->>(${source}->>'coastLibraryId')
    and ${source}->>'coastLibraryScanId'=${inventory}->'screenLibraryCensus'->(${source}->>'coastLibraryId')->>'scanId'
    and (${inventory}->'screenLibraryCensus'->(${source}->>'coastLibraryId')->>'expiresAt')::timestamptz>now())`;
}

export const collectionOptionsSchema = v.object({
  segment:v.optional(v.picklist(librarySegmentValues),'all'),
  sort:v.optional(v.picklist(librarySortValues),'default'),
  page: v.optional(pageNumberSchema, 1),
  level: v.optional(v.picklist(['all', 'root']), 'all'),
  category: v.optional(v.picklist(['all', 'screen', 'music', 'game', 'reading', 'book', 'comic']), 'all'),
  kind: v.optional(v.picklist(['all', 'movie', 'show', 'season', 'episode', 'collection', 'album', 'track', 'game', 'book', 'audiobook', 'comic']), 'all'),
  relationship: v.optional(v.picklist(['all', 'collected', 'watchlist', 'favourite', 'rating', 'list', 'queue', 'activity']), 'all'),
  activity: v.optional(v.picklist(['all', 'unwatched', 'planned', 'active', 'reading', 'paused', 'completed', 'dropped']), 'all'),
  availability: v.optional(v.picklist(['all', 'available', 'partial', 'unavailable', 'unknown', 'ready']), 'all'),
  source: v.optional(v.union([v.literal('all'), v.pipe(v.string(), v.uuid())]), 'all'),
});
export type AvailabilityState = 'available' | 'partial' | 'unavailable' | 'unknown';
export type CollectionReason = { relationship: string; origin: 'direct' | 'inherited' | 'member-derived'; workId: string };
export type WorkAssessment = { id: string; category: string; kind: string; title: string; reasons: CollectionReason[]; availability: AvailabilityState; stale: boolean; active: boolean; completed: boolean; dropped: boolean; nextId: string | null; releaseDate: string | null };

/** Materialized membership trees are small; the default recursive estimate explodes
 * after ancestor + descendant traversal and selects repeated scans. Keep this local
 * to Collection reads, alongside disabling JIT compilation for interactive shelves. */
export async function collectionRead(statement:SQL){
  const started = performance.now();
  try {
    return await getDb().transaction(async tx=>{await tx.execute(sql`set local jit=off`);await tx.execute(sql`set local recursive_worktable_factor=0.01`);return tx.execute(statement);});
  } finally {
    void logDiagnostic('debug','query.timing',{operation:'collection',stage:'assessment',durationMs:performance.now()-started});
  }
}

/** All personal predicates and access assessment happen before the 60-item card query. */
export function collectionCTE(ownerId: string | SQL, viewerId: string | SQL, source = 'all', scope: 'all' | 'personal' | string[] = 'all', category = 'all', projection: 'complete' | 'status' = 'complete') {
  // Personal shelves only traverse their relationships and ancestors. Full inventory
  // remains an explicit scope for server projections; item menus scope to requested IDs.
  // Personal roots depend on evidence; explicit-ID closures are independent.
  const scopedParent = (id:SQL) => Array.isArray(scope) ? sql` and ${id} in (select id from scoped_works)` : sql``;
  const seeds = scope === 'all' ? sql`select id from works`
    : scope === 'personal' ? sql`select distinct d.id from direct d join works w on w.id=d.id where ${selectedCategory(sql`w.category`,category)}`
    : scope.length ? sql`select id from works where id in (${sql.join(scope.map(id => sql`${id}::uuid`), sql`,`)})` : sql`select id from works where false`;
  return sql`with recursive
  visibility as materialized (
    select category,
      social_visible(${ownerId}::uuid,${viewerId}::uuid,'collection',category) as collection_visible,
      social_visible(${ownerId}::uuid,${viewerId}::uuid,'activity',category) as activity_visible,
      social_visible(${ownerId}::uuid,${viewerId}::uuid,'progress',category) as progress_visible,
      social_visible(${ownerId}::uuid,${viewerId}::uuid,'favourites',category) as favourites_visible,
      social_visible(${ownerId}::uuid,${viewerId}::uuid,'ratings',category) as ratings_visible
    from (select distinct category from works) categories
  ), edges as (
    select parent_id,child_id from media_relationships where kind in ('contains','collection','sequence')
    union select show_id,media_id from episodes where not is_special
    union select season_id,media_id from episodes where season_id is not null and not is_special
    union select show_id,media_id from seasons
  ), assessment_roots(id) as (
    ${seeds}
    union select e.parent_id from assessment_roots r join edges e on e.child_id=r.id
  ), descendants(root,id) as (
    select id,id from assessment_roots
    union select d.root,e.child_id from descendants d join edges e on e.parent_id=d.id
  ), scoped_works as (select w.* from works w where exists(select 1 from descendants d where d.id=w.id)), observed_shows as materialized (
    select distinct e.show_id as id from episodes e join tracking_state t on t.media_id=e.media_id and t.user_id=${ownerId}
    where not e.is_special${scopedParent(sql`e.show_id`)} and (t.watched or t.position_seconds>0)
  ), active_shows as materialized (
    select observed.id from observed_shows observed where exists(
      select 1 from episodes remaining join media m on m.id=remaining.media_id left join tracking_state rt on rt.media_id=remaining.media_id and rt.user_id=${ownerId}
      where remaining.show_id=observed.id and not remaining.is_special and not coalesce(rt.watched,false)
        and (m.release_date is null or m.release_date<=current_date))
  ), observed_albums as materialized (
    select distinct r.parent_id as id from media_relationships r join music_works mw on mw.id=r.child_id
    where r.kind='contains'${scopedParent(sql`r.parent_id`)} and mw.kind='track' and (
      exists(select 1 from music_listens ml where ml.track_id=r.child_id and ml.user_id=${ownerId})
      or exists(select 1 from music_progress mp where mp.track_id=r.child_id and mp.user_id=${ownerId} and (mp.position_seconds>0 or mp.play_count>0)))
  ), active_albums as materialized (
    select observed.id from observed_albums observed where exists(
      select 1 from media_relationships remaining join music_works mt on mt.id=remaining.child_id
      where remaining.parent_id=observed.id and remaining.kind='contains' and mt.kind='track'
        and not exists(select 1 from music_listens ml where ml.track_id=mt.id and ml.user_id=${ownerId})
        and not exists(select 1 from music_progress mp where mp.track_id=mt.id and mp.user_id=${ownerId} and mp.play_count>0))
  ), raw_direct as (
    select media_id as id,'collected' as relationship from tracking_state where user_id=${ownerId} and collected
    union select media_id,'watchlist' from tracking_state where user_id=${ownerId} and watchlist
    union select media_id,'favourite' from tracking_state where user_id=${ownerId} and favourite
    union select media_id,'rating' from ratings where user_id=${ownerId}
    union select li.media_id,'list' from list_items li join lists l on l.id=li.list_id where l.user_id=${ownerId}
    union select media_id,'queue' from up_next where user_id=${ownerId}
    union select media_id,'active' from tracking_state where user_id=${ownerId} and (position_seconds>0 or dropped or (completed_episodes>0 and not watched))
    union select media_id,'history' from tracking_state where user_id=${ownerId} and (watched or play_count>0)
    union select media_id,'history' from tracking_events where user_id=${ownerId} and applied and action='watch'
    union select id,'active' from active_shows
    union select id,'active' from active_albums
    union select game_id,'active' from game_playthroughs p where user_id=${ownerId} and status<>'completed' and (status in ('in-progress','paused','dropped') or progress_percent>0)
    union select game_id,'history' from game_playthroughs p where user_id=${ownerId} and (status='completed' or exists(select 1 from game_sessions where playthrough_id=p.id))
    union select track_id,'history' from music_listens where user_id=${ownerId}
    union select track_id,'active' from music_progress where user_id=${ownerId} and position_seconds>0
    union select track_id,'history' from music_progress where user_id=${ownerId} and play_count>0
    union select work_id,'reading-active' from reading_progress where user_id=${ownerId} and state in ('planned','reading','paused','dropped')
    union select work_id,'reading-history' from reading_progress where user_id=${ownerId} and state='completed'
  ), direct as (
    select d.id,case when d.relationship in ('active','history','reading-active','reading-history') then 'activity' else d.relationship end as relationship
    from raw_direct d join ${Array.isArray(scope) ? sql`scoped_works` : sql`works`} w on w.id=d.id join users u on u.id=${ownerId} join visibility vis on vis.category=w.category
    where (case when d.relationship in ('reading-active','reading-history') then vis.progress_visible when d.relationship in ('active','history') then vis.activity_visible when d.relationship='favourite' then vis.favourites_visible when d.relationship='rating' then vis.ratings_visible else vis.collection_visible end)
    and (d.relationship='collected' or (
      coalesce((u.settings->'collection'->w.category->>(case when d.relationship like 'reading-%' then split_part(d.relationship,'-',2) else d.relationship end))::boolean,true)
      and (coalesce((u.settings->'collection'->w.category->>'dropped')::boolean,false) or not (
        (exists(select 1 from tracking_state t where t.user_id=${ownerId} and t.dropped and t.media_id=d.id) or exists(select 1 from episodes e join tracking_state t on t.media_id=e.show_id and t.user_id=${ownerId} and t.dropped where e.media_id=d.id))
        or coalesce((select p.status='dropped' from game_playthroughs p where p.user_id=${ownerId} and p.game_id=d.id order by p.created_at desc,p.id desc limit 1),false)
        or (vis.progress_visible and exists(select 1 from reading_progress p where p.user_id=${ownerId} and p.work_id=d.id and p.state='dropped'))
      ))
    ))
  ), reasons as (
    select id,relationship,'direct' as origin,id as work_id from direct
    union select d.id,'collected','inherited',d.root from descendants d join direct r on r.id=d.root and r.relationship='collected' where d.id<>d.root
    union select d.root,r.relationship,'member-derived',d.id from descendants d join direct r on r.id=d.id where d.id<>d.root
  ), connections as (
    select c.id,c.account_generation,i.name,i.provider,i.settings,c.status,i.enabled,c.settings as connection_settings, cp.completed_at,cp.scan_id,
      case when i.provider='steam' then coalesce((i.settings->'schedule'->>'intervalMinutes')::integer,60) else coalesce((i.settings->'schedule'->>'userIntervalMinutes')::integer,10) end as cadence
    from provider_connections c join provider_instances i on i.id=c.instance_id
    left join sync_checkpoints cp on cp.connection_id=c.id and cp.kind=case when i.provider='steam' then 'steam-user' else 'jellyfin-user' end
    where c.user_id=${viewerId} and i.provider in ('jellyfin','steam') and not coalesce(c.settings->>'collectionSourceExcluded'='true',false) and (${source}='all' or c.id::text=${source})
  ), parents as materialized (select distinct parent_id as id from edges), leaves as materialized (
    select w.id,w.category,
      exists(select 1 from availability a join connections c on c.id=a.connection_id where a.user_id=${viewerId} and a.media_id=w.id and c.provider=case when w.category='game' then 'steam' else 'jellyfin' end and a.state='available' and c.status<>'disconnected' and (w.category not in ('book','comic') or c.status='connected') and c.enabled) as positive,
      exists(select 1 from availability a join connections c on c.id=a.connection_id where a.user_id=${viewerId} and a.media_id=w.id and c.provider=case when w.category='game' then 'steam' else 'jellyfin' end and a.state='available' and c.status<>'disconnected' and c.enabled and
        (c.status<>'connected' or (w.category not in ('book','comic') and not coalesce(${inheritedScreenAccess(sql`a.source`,sql`a.scan_id`,sql`c.connection_settings`,sql`c.account_generation`,sql`c.settings`)},false) and (c.completed_at is null or c.scan_id is not null or c.completed_at<now()-c.cadence*interval '2 minutes')) or a.verified_at < now()-c.cadence*interval '2 minutes')) as stale,
      ((w.category<>'game' or exists(select 1 from game_external_ids ge where ge.game_id=w.id and ge.provider='steam')) and exists(select 1 from connections c where c.provider=case when w.category='game' then 'steam' else 'jellyfin' end) and not exists(select 1 from connections c where c.provider=case when w.category='game' then 'steam' else 'jellyfin' end and (c.status<>'connected' or not c.enabled or
        ((c.completed_at is null or c.scan_id is not null or c.completed_at < now()-c.cadence*interval '2 minutes') and
          not exists(select 1 from availability a where a.user_id=${viewerId} and a.connection_id=c.id and a.media_id=w.id and a.state='unavailable' and a.source->>'authoritative'='true' and a.verified_at>=now()-c.cadence*interval '2 minutes'))))) as assessed
    from scoped_works w where w.kind not in ('show','season','collection','album') and not exists(select 1 from edges e where e.parent_id=w.id)
  ), coverage as (
    select d.root,count(distinct l.id)::integer as total,
      count(distinct l.id) filter(where l.positive)::integer as available,
      bool_and(l.assessed) as assessed,bool_or(l.stale) as stale
    from descendants d join leaves l on l.id=d.id
    left join media m on m.id=l.id left join music_works mu on mu.id=l.id
    where coalesce(m.release_date,mu.release_date,current_date)<=current_date group by d.root
  ), active_roots as (
    select distinct d.root from descendants d join tracking_state ct on ct.media_id=d.id and ct.user_id=${ownerId}
      where d.id<>d.root and (ct.watched or ct.position_seconds>0)
    union select d.root from descendants d join music_progress mp on mp.track_id=d.id and mp.user_id=${ownerId}
      where mp.position_seconds>0 or (d.id<>d.root and mp.play_count>0)
    union select d.root from descendants d join music_listens ml on ml.track_id=d.id and ml.user_id=${ownerId} where d.id<>d.root
  ), game_status as (
    select distinct on (game_id) game_id,status='dropped' as dropped,status='completed' as completed,
      status in ('in-progress','paused') as active from game_playthroughs where user_id=${ownerId} order by game_id,created_at desc,id desc
  ), listened as (
    select distinct track_id from music_listens where user_id=${ownerId}
  ), music_completion as (
    select r.parent_id,bool_and((l.track_id is not null or coalesce(mp.play_count,0)>0) and coalesce(mp.position_seconds,0)=0) as completed
      from media_relationships r join music_works t on t.id=r.child_id and t.kind='track'
      left join listened l on l.track_id=t.id left join music_progress mp on mp.track_id=t.id and mp.user_id=${ownerId}
      where r.kind='contains' group by r.parent_id
  ), member_counts as (
    select d.root,count(distinct leaf.id)::int as total from descendants d join works leaf on leaf.id=d.id
      where leaf.kind in ('episode','track','movie') group by d.root
  ), music_editions as materialized (
    select a.id,album.instance_id,album.external_id,
      count(distinct case when track.id is not null then replace(lower(member.external_id),'-','') end)::integer as total
    from scoped_works w join music_works a on a.id=w.id and a.kind='album'
    join work_editions album on album.id=a.selected_edition_id
    left join work_editions member on member.instance_id=album.instance_id
      and replace(lower(member.metadata->>'albumExternalId'),'-','')=replace(lower(album.external_id),'-','')
    left join music_works track on track.id=member.work_id and track.kind='track'
    group by a.id,album.instance_id,album.external_id
  ), known_membership as materialized (
    select w.id,((coalesce(mu.membership_complete,false) and not exists(select 1 from provider_items mp join provider_instances mi on mi.id=mp.instance_id where mp.media_id=w.id and mi.provider='jellyfin')) or exists(select 1 from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id
      where a.user_id=${ownerId} and a.media_id=w.id and a.state='available' and c.status='connected'
        and (edition.id is null or exists(select 1 from provider_items selected where selected.id=a.provider_item_id
          and selected.instance_id=edition.instance_id and replace(lower(selected.external_id),'-','')=replace(lower(edition.external_id),'-','')))
        and ((c.settings->'userSync'->>'phase'='complete' and c.settings->'userSync'->>'accountGeneration'=c.account_generation::text
          and a.scan_id::text=c.settings->'userSync'->>'scanId') or ${inheritedScreenAccess(sql`a.source`,sql`a.scan_id`,sql`c.settings`,sql`c.account_generation`,sql`i.settings`)}) and a.source->>'coastMembershipCount' is not null
        and (a.source->>'coastMembershipCount')::integer=coalesce(edition.total,counts.total)) or exists(select 1 from provider_items pi
      where pi.media_id=w.id and pi.snapshot->>'membershipComplete'='true' and
      (edition.id is null or (pi.instance_id=edition.instance_id and replace(lower(pi.external_id),'-','')=replace(lower(edition.external_id),'-',''))) and
      (exists(select 1 from provider_connections c
        where c.id::text=pi.snapshot->'membershipEvidence'->>'connectionId' and c.user_id=${ownerId}
        and c.account_generation::text=pi.snapshot->'membershipEvidence'->>'accountGeneration' and c.status='connected')) and
      (pi.snapshot->>'expectedMembers' is null or (pi.snapshot->>'expectedMembers')::integer=coalesce(edition.total,counts.total)))) as complete
      from scoped_works w left join music_works mu on mu.id=w.id left join member_counts counts on counts.root=w.id left join music_editions edition on edition.id=w.id
  ), next_episodes as (
    select distinct on (e.show_id) e.show_id,e.media_id from episodes e
      join media em on em.id=e.media_id left join tracking_state t on t.media_id=e.media_id and t.user_id=${ownerId}
    where not e.is_special${scopedParent(sql`e.show_id`)} and not coalesce(t.watched,false) and not coalesce(t.dropped,false)
      and (em.release_date is null or em.release_date<=current_date)
    order by e.show_id,e.season_number,e.episode_number
  ), next_music as (
    select distinct on (r.parent_id) r.parent_id,child.id from media_relationships r
      join music_works child on child.id=r.child_id left join music_progress mp on mp.track_id=child.id and mp.user_id=${ownerId}
      left join listened l on l.track_id=child.id
    where r.kind='contains'${scopedParent(sql`r.parent_id`)} and child.kind='track'
    order by r.parent_id,(coalesce(mp.position_seconds,0)>0) desc,
      (case when mp.position_seconds>0 then mp.updated_at end) desc nulls last,
      (l.track_id is not null or coalesce(mp.play_count,0)>0),r.position,child.id
  ), assessments as ${projection === 'status' ? sql`not materialized` : sql`materialized`} (
    select w.id,w.created_at,w.category,w.kind,coalesce(m.title,g.title,mu.title,rw.title,w.kind) as title,
      coalesce(m.release_date,g.release_date,mu.release_date,rw.release_date)::text as release_date,
      coalesce(c.stale,false) as stale,
      case when w.category in ('book','comic') then case when c.available>0 then 'available' else 'unknown' end
        when w.category not in ('screen','music','game') then 'unknown'
        when c.available>0 and (hp.id is null or
          (c.available=c.total and km.complete)) then 'available'
        when c.available>0 then 'partial' when c.total>0 and c.assessed and
          (w.kind not in ('show','season','collection','album') or km.complete) then 'unavailable' else 'unknown' end as availability,
      ((vis.progress_visible and coalesce(rp.state='dropped',false)) or (vis.activity_visible and (coalesce(ts.dropped,false) or coalesce(gs.dropped,false)))) as dropped,
      ((vis.progress_visible and coalesce(rp.state='completed',false)) or (vis.activity_visible and (coalesce(ts.watched,false) or coalesce(gs.completed,false) or ((ml.track_id is not null or coalesce(mp.play_count,0)>0) and coalesce(mp.position_seconds,0)=0 and ar.root is null) or
        (coalesce(mc.completed,false) and km.complete)))) as completed,
      vis.progress_visible and (coalesce(ts.position_seconds,0)>0 or coalesce(mp.position_seconds,0)>0 or coalesce(ts.completed_episodes,0)>0 or ar.root is not null or coalesce(gs.active,false) or coalesce(rp.state in ('reading','paused'),false)) as active,
      case when vis.progress_visible then coalesce(ne.media_id,nm.id,w.id) else null end as next_id
    from scoped_works w join visibility vis on vis.category=w.category left join media m on m.id=w.id left join games g on g.id=w.id left join music_works mu on mu.id=w.id left join reading_works rw on rw.id=w.id
      left join reading_progress rp on rp.work_id=w.id and rp.user_id=${ownerId}
      left join tracking_state ts on ts.media_id=w.id and ts.user_id=${ownerId} left join coverage c on c.root=w.id
      left join active_roots ar on ar.root=w.id left join game_status gs on gs.game_id=w.id
      left join music_progress mp on mp.track_id=w.id and mp.user_id=${ownerId}
      left join listened ml on ml.track_id=w.id left join next_episodes ne on ne.show_id=w.id left join next_music nm on nm.parent_id=w.id
      left join known_membership km on km.id=w.id left join music_completion mc on mc.parent_id=w.id
      left join parents hp on hp.id=w.id
  ), reason_groups as (
    select id,jsonb_agg(distinct jsonb_build_object('relationship',relationship,'origin',origin,'workId',work_id)) as reasons
    from reasons group by id
  ), collection as (
    select a.*,r.reasons from assessments a join reason_groups r on r.id=a.id
  )`;
}
const mapAssessment = (row: Record<string, any>): WorkAssessment => ({ id: row.id, category: row.category, kind: row.kind, title: row.title, releaseDate: row.release_date, availability: row.availability, stale: row.stale, reasons: row.reasons, active: row.active, completed: row.completed, dropped: row.dropped, nextId: row.next_id });
export async function workAssessments(ownerId: string, viewerId: string, ids: string[], source='all') {
  if (!ids.length) return [];
  const result = await collectionRead(sql`${collectionCTE(ownerId, viewerId, source, ids)} select a.*,coalesce(c.reasons,'[]'::jsonb) as reasons from assessments a left join collection c on c.id=a.id where a.id in ${sql`(${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`}`);
  return Array.from(result).map(mapAssessment);
}
/** Shared action data is local and loaded only when the existing menu opens. */
export async function workActionData(userId: string, id: string, playthroughId?: string): Promise<import('#lib/media/work-actions.js').WorkActionState> {
  // The menu edits direct relationships. It does not need Collection's recursive
  // coverage/ancestor assessment or every inherited member's reason payload.
  const rows = await getDb().execute<import('#lib/media/work-actions.js').WorkActionState>(sql`
    select coalesce((select jsonb_agg(jsonb_build_object('relationship',v.relationship,'origin','direct'))
      from tracking_state t cross join lateral (values ('collected',t.collected),('watchlist',t.watchlist),('favourite',t.favourite)) v(relationship,enabled)
      where t.user_id=${userId} and t.media_id=${id} and v.enabled),'[]'::jsonb) as reasons,
      (select value from ratings where user_id=${userId} and media_id=${id}) as rating,
      exists(select 1 from up_next where user_id=${userId} and media_id=${id}) as queued,
      (select jsonb_build_object('platforms',g.platforms,'playthrough',
        (select jsonb_build_object('id',p.id,'status',p.status,'progressPercent',p.progress_percent,'repeat',p.repeat,'platform',p.platform)
         from game_playthroughs p where p.game_id=g.id and p.user_id=${userId}
         and (${playthroughId ?? null}::uuid is null or p.id=${playthroughId ?? null}::uuid)
         order by p.created_at desc,p.id desc limit 1)) from games g where g.id=${id}) as game,
      (select jsonb_build_object('state',state,'page',page,'totalPages',total_pages)
       from reading_progress where user_id=${userId} and work_id=${id}) as reading`);
  return rows[0] as import('#lib/media/work-actions.js').WorkActionState;
}

/** Lists are a branch read: one row per list, bounded page, exact membership count.
 * Only the first occurrence is needed for ordinary-list toggling; contextual actions
 * retain their own selected entry ID and never substitute this occurrence. */
export async function workActionLists(userId: string, id: string, requestedPage = 1, readingOnly = false): Promise<import('#lib/media/work-actions.js').WorkListPage> {
  v.parse(pageNumberSchema, requestedPage);
  const db = getDb();
  const where = sql`l.user_id=${userId} and (not ${readingOnly} or not l.playlist)`;
  const [count] = await db.execute<{ total: number }>(sql`select count(*)::int total from lists l where ${where}`);
  const { page, pages } = pagination(count.total, requestedPage);
  const rows = await db.execute<{ id: string; name: string; playlist: boolean; entryId: string | null; position: number | null; count: number }>(sql`
    select l.id,l.name,l.playlist,member.id as "entryId",member.position,coalesce(member.total,0)::int as count
    from lists l left join lateral (
      select li.id,li.position,count(*) over() total from list_items li
      where li.list_id=l.id and li.media_id=${id} order by li.position,li.id limit 1
    ) member on true where ${where} order by l.name,l.id limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`);
  return { items: Array.from(rows as unknown as { id: string; name: string; playlist: boolean; entryId: string | null; position: number | null; count: number }[]).map(({ entryId, position, ...list }) => ({ ...list,
    entries: entryId === null ? [] : [{ id: entryId, position: position! }] })), page, pages, total: count.total };
}
/** Same canonical identity presentation for consumers that never expose card state. */
export async function workSummaries(ownerId: string, viewerId: string | null, ids: string[]): Promise<WorkSummary[]> {
  const unique=[...new Set(ids)],summaries=new Map<string,WorkSummary>();
  for(let offset=0;offset<unique.length;offset+=PAGE_SIZE) {
    const page=unique.slice(offset,offset+PAGE_SIZE),uuid=v.pipe(v.string(),v.uuid());
    v.parse(uuid,ownerId);v.parse(v.array(uuid),page);
    const db=getDb(),[config,identities]=await Promise.all([getFeatureConfig(viewerId),
      db.select({id:works.id,category:works.category}).from(works).where(inArray(works.id,page))]);
    const selected=(category:string)=>identities.filter(row=>row.category===category).map(row=>row.id);
    const screenIds=selected('screen'),gameIds=selected('game'),musicIds=selected('music'),readingIds=[...selected('book'),...selected('comic')];
    const [screen,game,music,reading]=await Promise.all([
      screenIds.length?screenWorkSummaries(ownerId,screenIds,viewerId):[],
      gameIds.length?db.execute<{id:string;title:string}>(sql`select id,title from games where id in (${sql.join(gameIds.map(id=>sql`${id}::uuid`),sql`,`)})`).then(rows=>Array.from(rows)):[],
      musicIds.length?db.select({id:musicWorks.id,kind:musicWorks.kind,title:musicWorks.title,year:musicWorks.year})
        .from(musicWorks).where(inArray(musicWorks.id,musicIds)):[],
      readingIds.length&&(config.experimentalBooks||config.experimentalComics)?db.select({id:readingWorks.id,kind:readingWorks.kind,title:readingWorks.title,
        authors:readingWorks.authors,publishedYear:readingWorks.publishedYear,provider:readingWorks.provider,sourceUrl:readingWorks.sourceUrl})
        .from(readingWorks).where(sql`${inArray(readingWorks.id,readingIds)} and ${enabledCategories(sql`${readingWorks.kind}`,config)}`).limit(PAGE_SIZE):[],
    ]);
    for(const item of screen)summaries.set(item.id,item);
    // Screen titles already passed title locks and must not receive a second alias override.
    const cards:MediaCardPresentation[]=[...game.map(item=>({id:item.id,workId:item.id,kind:'game' as const,title:item.title,href:`/games/${item.id}`})),
      ...music.map(item=>({id:item.id,workId:item.id,kind:item.kind,title:item.title,year:item.year,href:`/music/work/${item.id}`})),
      ...reading.map(item=>readingCard(item))];
    for(const item of await personaliseWorkCards(viewerId,cards)) {
      const id=item.workId??item.id;
      summaries.set(id,{id,kind:item.kind,title:item.title,year:item.year,...(item.attribution?{attribution:item.attribution}:{})});
    }
  }
  return ids.flatMap(id=>summaries.has(id)?[summaries.get(id)!]:[]);
}

export async function workCards(ownerId: string, viewerId: string | null, ids: string[]): Promise<(MediaView | MediaCardPresentation)[]> {
  const unique = [...new Set(ids)];
  const cards = new Map<string,MediaView|MediaCardPresentation>();
  for (let offset=0;offset<unique.length;offset+=PAGE_SIZE) {
    for (const card of await workCardPage(ownerId,viewerId,unique.slice(offset,offset+PAGE_SIZE)))
      cards.set(('workId' in card ? card.workId : undefined)??card.id,card);
  }
  return ids.flatMap(id => cards.has(id) ? [cards.get(id)!] : []);
}
async function workCardPage(ownerId: string, viewerId: string | null, ids: string[]): Promise<(MediaView | MediaCardPresentation)[]> {
  if (!ids.length) return [];
  const uuid=v.pipe(v.string(),v.uuid());
  v.parse(uuid,ownerId);
  v.parse(v.object({ids:v.array(uuid)}),{ids});
  const db=getDb();
  const [config,identities]=await Promise.all([
    getFeatureConfig(viewerId),
    db.select({id:works.id,category:works.category}).from(works).where(inArray(works.id,ids)),
  ]);
  // Canonical category admits projection work; it does not replace each owner's
  // feature, privacy or source checks. Missing identities still produce no card.
  const categoryIds=(category:string)=>identities.filter(work=>work.category===category).map(work=>work.id);
  const screenIds=categoryIds('screen'),gameIds=categoryIds('game'),musicIds=categoryIds('music');
  const readingIds=identities.filter(work=>work.category==='book'||work.category==='comic').map(work=>work.id);
  const [screen,gameRows,musicRows,readingRows] = await Promise.all([
    screenIds.length?mediaViews(ownerId,{ids:screenIds,limit:PAGE_SIZE},viewerId):[],
    gameIds.length?(await import('#lib/core/games/service.server.js')).gamePresentationMetadata(gameIds).then(rows=>[...rows.values()]):[],
    musicIds.length?db.select().from(musicWorks).where(inArray(musicWorks.id,musicIds)):[],
    readingIds.length&&(config.experimentalBooks||config.experimentalComics)
      ? db.select().from(readingWorks).where(sql`${inArray(readingWorks.id,readingIds)} and ${enabledCategories(sql`${readingWorks.kind}`,config)}`).limit(PAGE_SIZE)
      : Promise.resolve([]),
  ]);
  const [mappings,credits] = await Promise.all([musicRows.length && viewerId ? db.select({
    mediaId:providerItems.mediaId,externalId:providerItems.externalId,
    primaryImageTag:sql<string|null>`${providerItems.snapshot}->>'primaryImageTag'`,connection:providerConnections.id,
  }).from(providerItems)
    .innerJoin(providerConnections,eq(providerConnections.instanceId,providerItems.instanceId))
    .innerJoin(providerInstances,eq(providerInstances.id,providerItems.instanceId))
    .where(sql`${inArray(providerItems.mediaId,musicRows.map(row=>row.id))} and ${providerConnections.userId}=${viewerId}
      and ${providerConnections.status}='connected' and ${providerInstances.enabled}`) : [],
    musicWorkCredits(musicRows.map(row=>row.id),viewerId),
  ]);
  const cards=new Map<string,MediaView|MediaCardPresentation>(screen.map(i=>[i.id,i]));
  for(const g of gameRows) cards.set(g.id,{id:g.id,workId:g.id,kind:'game',title:g.title,href:`/games/${g.id}`,poster:g.posterPath,backdrop:g.backdropPath});
  for(const m of musicRows){ const source=mappings.find(p=>p.mediaId===m.id),credit=credits.get(m.id),artists=credit?(m.kind==='album'?credit.albumArtists:credit.artists):[];cards.set(m.id,{id:source?.externalId??m.id,workId:m.id,kind:m.kind,title:m.title,captionCredits:artists,captionSubtitle:artists.length?artists.map(artist=>artist.name).join(', '):m.artistNames.join(', '),year:m.year,href:`/music/work/${m.id}`,connectionId:source?.connection,poster:source?.primaryImageTag?`/api/v1/providers/${source.connection}/music/${source.externalId}/artwork`:undefined}); }
  for(const item of await readingCards(ownerId,viewerId,readingRows))cards.set(item.id,item);
  const personal = await personaliseWorkCards(viewerId,[...cards.values()].filter((card): card is MediaCardPresentation => 'href' in card && card.kind !== 'book' && card.kind !== 'comic'));
  for (const card of personal) cards.set(card.workId ?? card.id, card);
  return ids.flatMap(id=>cards.has(id)?[cards.get(id)!]:[]);
}
export function collectionParameters(url: URL) { return Object.fromEntries(['page','level','category','kind','relationship','activity','availability','source','sort','segment'].flatMap(k=>url.searchParams.has(k)?[[k,k==='page'?Number(url.searchParams.get(k)):url.searchParams.get(k)]]:[])); }
async function collectionPage(viewerId: string, raw: unknown={}, username?: string, interval?: PageInterval) {
  const owner=username?await profileUser(username):null, ownerId=owner?.id??viewerId;
  const input=v.parse(collectionOptionsSchema,raw);
  if (interval) {
    requestedPageInterval(input.page, interval.firstPage);
    v.parse(v.literal(input.page), interval.lastPage);
  }
  if(ownerId!==viewerId && input.category!=='reading')await (await import('#lib/social/privacy.server.js')).requireVisible(ownerId,viewerId,'collection',input.category==='all'?undefined:input.category);
  const config=await getFeatureConfig(viewerId);if(input.category!=='all')requireEnabledCategory(config,input.category);
  const category=input.category==='game'?'game':input.category==='music'?'music':['reading','book','comic'].includes(input.category)?'reading':'screen';
  const segment=await librarySegmentCondition(ownerId,viewerId,input.segment,sql`c.id`,category);
  const condition=sql`${segment??sql`true`} and (select collection_visible from visibility where category=c.category) and ${enabledCategories(sql`c.category`,config)} and ${selectedCategory(sql`c.category`,input.category)} and (${input.kind}='all' or c.kind=${input.kind})
    and (${input.level}='all' or (c.kind not in ('episode','season') and not exists(select 1 from edges e join works parent on parent.id=e.parent_id where e.child_id=c.id and parent.kind in ('show','season','album'))))
    and (${input.relationship}='all' or exists(select 1 from jsonb_array_elements(c.reasons) r where r->>'relationship'=${input.relationship}))
    and (${input.activity}='all' or (${input.activity}='active' and c.active and not c.dropped and not c.completed)
      or (${input.activity}='reading' and (select progress_visible from visibility where category=c.category) and exists(select 1 from reading_progress p where p.user_id=${ownerId} and p.work_id=c.id and p.state='reading'))
      or (${input.activity}='unwatched' and not c.completed and not c.dropped)
      or (${input.activity}='planned' and not c.active and not c.completed and not c.dropped)
      or (${input.activity}='paused' and (select progress_visible from visibility where category=c.category) and ((select p.status from game_playthroughs p where p.user_id=${ownerId} and p.game_id=c.id order by p.created_at desc,p.id desc limit 1)='paused' or exists(select 1 from reading_progress p where p.user_id=${ownerId} and p.work_id=c.id and p.state='paused')))
      or (${input.activity}='completed' and c.completed) or (${input.activity}='dropped' and c.dropped))
    and (${input.availability}='all' or (${input.availability}='available' and c.availability in ('available','partial')) or c.availability=${input.availability} or
      (${input.availability}='ready' and exists(select 1 from assessments a where a.id=c.next_id and a.availability='available')))
    and (${input.source}='all' or exists(select 1 from descendants d join availability a on a.media_id=d.id where d.root=c.id and a.user_id=${viewerId} and a.connection_id::text=${input.source}))`;
  const order=libraryOrder(input.sort,{title:sql`title`,added:sql`created_at`,id:sql`id`});
  const selectedOrder=libraryOrder(input.sort,{title:sql`selected.title`,added:sql`selected.created_at`,id:sql`selected.id`});
  const result=await collectionRead(sql`${collectionCTE(ownerId,viewerId,input.source,'personal',input.category)}, filtered as (select c.* from collection c where ${condition}), totals as (select count(*)::int as total from filtered)
    select totals.total,coalesce((select jsonb_agg(selected order by ${selectedOrder}) from
      (select * from filtered order by ${order} limit ${interval ? sql`(least(${input.page},greatest(1,ceil(totals.total::numeric/${PAGE_SIZE})::int))
          - least(${interval.firstPage},greatest(1,ceil(totals.total::numeric/${PAGE_SIZE})::int)) + 1)*${PAGE_SIZE}` : sql`${PAGE_SIZE}`}
        offset (least(${interval?.firstPage ?? input.page},greatest(1,ceil(totals.total::numeric/${PAGE_SIZE})::int))-1)*${PAGE_SIZE}) selected),'[]'::jsonb) as items from totals`);
  const total=Number(result[0]?.total??0), {page,pages}=pagination(total,input.page);
  const assessments=(result[0]?.items as Record<string,any>[]??[]).map(mapAssessment);
  return {ownerId,assessments,total,page,pages,...(interval ? { interval: pageInterval(pages,page,interval.firstPage) } : {}),filters:input,username:owner?.username??null,owner:ownerId===viewerId};
}

/** Public identity consumers retain the exact shared Collection eligibility and paging. */
export async function collectionSummaries(viewerId: string, raw: unknown={}) {
  const {ownerId,...page}=await collectionPage(viewerId,raw);
  return {...page,items:await workSummaries(ownerId,viewerId,page.assessments.map(item=>item.id))};
}

export async function collectionData(viewerId: string, raw: unknown={}, username?: string, interval?: PageInterval, signal?: AbortSignal) {
  return withReadCancellation(signal,()=>collectionDataRead(viewerId,raw,username,interval,signal));
}
async function collectionDataRead(viewerId:string,raw:unknown,username?:string,interval?:PageInterval,signal?:AbortSignal){
  signal?.throwIfAborted();
  const {ownerId,assessments,total,page,pages,interval:bounds,...presentation}=await collectionPage(viewerId,raw,username,interval);
  const hydrationStarted = performance.now();
  const cards: Awaited<ReturnType<typeof workCards>> = [], counts: number[] = [];
  for (let number = bounds?.firstPage ?? page; number <= page; number++) {
    signal?.throwIfAborted();
    const offset = (number - (bounds?.firstPage ?? page)) * PAGE_SIZE;
    const selected = await workCards(ownerId,viewerId,assessments.slice(offset,offset+PAGE_SIZE).map(r=>r.id));
    signal?.throwIfAborted();
    cards.push(...selected); counts.push(selected.length);
  }
  void logDiagnostic('debug','query.timing',{operation:'collection',stage:'card-hydration',durationMs:performance.now()-hydrationStarted});
  const byId=new Map(assessments.map(a=>[a.id,a]));
  const items=cards.map(item=>{
    const assessment=byId.get('workId' in item?item.workId??item.id:item.id);
    const details=[assessment?.category==='game' && assessment.availability==='available' ? 'Owned on Steam' : item.captionSubtitle,assessment?.availability==='partial'?'Partly available':undefined,
      assessment?.stale?'Last known availability · access needs refresh':undefined].filter(Boolean);
    return {...item,available:assessment?['available','partial'].includes(assessment.availability):item.available ?? false,...(details.length?{captionSubtitle:details.join(' · ')}:{})};
  });
  const sources=await getDb().select({id:providerConnections.id,name:providerInstances.name}).from(providerConnections).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).where(sql`${providerConnections.userId}=${viewerId} and ${providerInstances.provider} in ('jellyfin','steam')`);
  return {items,assessments,sources,total,page,pages,pageSize:PAGE_SIZE,...presentation,...(bounds ? {range:{...bounds,counts}} : {})};
}
