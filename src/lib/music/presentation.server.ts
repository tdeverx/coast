import { sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { musicWorkCredits } from './credits.server';
import type { MusicItem } from './model';

/** One bounded page keeps entry order while sharing canonical state and authorized artwork. */
export async function hydrateMusicItems(viewerId:string|null,items:MusicItem[]) {
  const ids=[...new Set(items.flatMap(item=>item.workId?[item.workId]:[]))];
  if(!ids.length)return items;
  if(ids.length>61)throw new Error('Music presentation accepts one bounded page.');
  const selected=sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `);
  const [credits,rows]=await Promise.all([
    musicWorkCredits(ids,viewerId),
    getDb().execute<{id:string;playCount:number;position:number;favourite:boolean;available:boolean;artwork:string|null}>(sql`
      select w.id,coalesce(p.play_count,0)::int as "playCount",coalesce(p.position_seconds,0) as position,
        coalesce(t.favourite,false) as favourite,
        exists(select 1 from availability a join provider_connections c on c.id=a.connection_id
          join provider_instances i on i.id=c.instance_id where a.media_id=w.id and a.user_id=${viewerId}::uuid
          and c.user_id=${viewerId}::uuid and a.state='available' and c.status='connected' and i.enabled) as available,
        image.artwork
      from music_works w
      left join music_progress p on p.track_id=w.id and p.user_id=${viewerId}::uuid
      left join tracking_state t on t.media_id=w.id and t.user_id=${viewerId}::uuid
      left join lateral(select '/api/v1/providers/'||c.id||'/music/'||pi.external_id||'/artwork' as artwork
        from provider_items pi join provider_connections c on c.instance_id=pi.instance_id
        join provider_instances i on i.id=pi.instance_id
        where pi.media_id=w.id and c.user_id=${viewerId}::uuid and c.status='connected' and i.enabled
          and i.provider='jellyfin' and coalesce(pi.snapshot->>'primaryImageTag','')<>''
        order by pi.last_seen_at desc,pi.id,c.id limit 1) image on true
      where w.id in (${selected})`),
  ]);
  const byId=new Map(rows.map(row=>[row.id,row]));
  return items.map(item=>{
    const state=item.workId?byId.get(item.workId):undefined;
    return state?{...item,...credits.get(state.id),available:state.available,playCount:state.playCount,
      positionSeconds:state.position,favourite:state.favourite,artworkUrl:state.artwork??item.artworkUrl}:item;
  });
}
