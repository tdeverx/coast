import type {getSql} from '#lib/server/db/index.js';

/** Resolve a work aliased as w to the same show or album identity used for personal taste. */
export function tasteRootJoin(sql: ReturnType<typeof getSql>) {
 return sql`left join episodes episode on episode.media_id=w.id
  left join seasons season on season.media_id=w.id
  left join lateral (
   select rel.parent_id from media_relationships rel join works parent on parent.id=rel.parent_id and parent.kind='album'
   where w.kind='track' and rel.child_id=w.id and rel.kind='contains' order by rel.position,rel.parent_id limit 1
  ) album on true
  cross join lateral (select coalesce(episode.show_id,season.show_id,album.parent_id,w.id) as id,
    case when episode.show_id is not null or season.show_id is not null then 'show'
     when album.parent_id is not null then 'album' else w.kind end as kind) root`;
}
