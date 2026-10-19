import {sql} from 'drizzle-orm';
/** Shared by card heads and item Activity. Callers provide descendants and ancestors. */
export const relationshipEdges=sql`select parent_id,child_id from media_relationships where kind='contains'
 union select show_id,media_id from episodes union select season_id,media_id from episodes union select show_id,media_id from seasons`;
export const relationshipReasons=sql`
 select t.user_id,t.media_id as id,r.section,r.relationship from tracking_state t
 cross join lateral(values
 ('collection','collected',t.collected),('collection','watchlist',t.watchlist),('favourites','favourites',t.favourite),
 ('activity','consumed',t.watched or t.play_count>0),('activity','other',t.dropped),
 ('progress','progress',t.position_seconds>0 and not t.watched)
 ) r(section,relationship,enabled) where r.enabled and t.media_id in(select id from descendants)
 union select user_id,media_id,'collection','watchlist' from up_next where media_id in(select id from descendants)
 union select l.user_id,i.media_id,'collection','lists' from list_items i join lists l on l.id=i.list_id where i.media_id in(select id from descendants)
 union select user_id,work_id,'progress',case when state='completed' then 'consumed' when state='planned' then 'watchlist' when state='reading' then 'progress' else 'other' end from reading_progress where work_id in(select id from descendants)
 union select p.user_id,p.track_id,'progress',r.relationship from music_progress p cross join lateral(values('progress',p.position_seconds>0),('consumed',p.play_count>0)) r(relationship,enabled) where r.enabled and p.track_id in(select id from descendants)
 union select t.user_id,a.root,'collection','collected' from tracking_state t join ancestors a on a.id=t.media_id where t.collected
 union select user_id,media_id,'ratings','other' from ratings where media_id in(select id from descendants)
 union select user_id,track_id,'activity','consumed' from music_listens where track_id in(select id from descendants)
 union select p.user_id,p.game_id,'activity','consumed' from game_sessions session join game_playthroughs p on p.id=session.playthrough_id where p.game_id in(select id from descendants)
 union select user_id,game_id,case when status='in-progress' then 'progress' when status='planned' then 'collection' else 'activity' end,case when status='completed' then 'consumed' when status='in-progress' then 'progress' when status='planned' then 'watchlist' else 'other' end from game_playthroughs where game_id in(select id from descendants)`;

export function activityRelationships(viewer:string,scope:{workId?:string;artistId?:string;readingGroupId?:string;relationship?:string;category?:string;friendId?:string}){
 if(scope.relationship===undefined)return sql``;
 return sql`target_roots(id) as (
  select id from works where id=${scope.workId??null}::uuid
  union select work_id from music_credits where artist_id=${scope.artistId??null}::uuid
  union select work_id from reading_group_members where group_id=${scope.readingGroupId??null}::uuid
 ), edges(parent_id,child_id) as (${relationshipEdges}),
 descendants(root,id) as(select id,id from target_roots union select d.root,e.child_id from descendants d join edges e on e.parent_id=d.id),
 ancestors(root,id) as(select id,id from target_roots union select a.root,e.parent_id from ancestors a join edges e on e.child_id=a.id),
 reasons as${scope.relationship==='all'&&!scope.friendId?sql` materialized`:sql``} (${relationshipReasons}), visible_relationships as (
  select distinct r.user_id,r.id,r.relationship from reasons r join works w on w.id=r.id
  where coast_category_enabled(${viewer}::uuid,w.category) and coast_feature_enabled(r.user_id,'social') and coast_feature_enabled(${viewer}::uuid,'social')
   and (r.user_id=${viewer}::uuid or exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(${viewer}::uuid,r.user_id) and f.user_b=greatest(${viewer}::uuid,r.user_id)))
   and (${scope.category??'all'}='all' or w.category=${scope.category??'all'} or ${scope.category??'all'}='reading' and w.category in ('book','comic'))
   and (${scope.friendId??null}::uuid is null or r.user_id=${scope.friendId??null}::uuid)
   and social_visible(r.user_id,${viewer}::uuid,r.section,w.category) and (${scope.relationship}='all' or r.relationship=${scope.relationship})
 ), relationship_states as (
  select user_id,coalesce(${scope.workId??null}::uuid,id) as work_id,array_agg(distinct id) as work_ids,array_agg(distinct relationship order by relationship) as relationships
  from visible_relationships group by 1,2
 ), `;
}
export function relationshipEventFilter(filter:string|undefined){
 if(filter===undefined||filter==='all')return sql``;
 const kinds:Record<string,string[]>={consumed:['watch','listen','play','played','session','game-completed','reading-completed'],progress:['progress','game-in-progress','reading-reading'],watchlist:['watchlist','game-planned','reading-planned'],lists:[],favourites:['favourite']};
 const selected=kinds[filter]??[];
 return sql`and exists(select 1 from visible_relationships r where r.user_id=a.user_id and r.id=a.work_id)
  and a.event_kind in (${selected.length?sql.join(selected.map(kind=>sql`${kind}`),sql`, `):sql`null::text`})`;
}
