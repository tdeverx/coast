import { sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import type { MusicArtist } from './model';
import { musicHref } from './presentation';

/** Credit text is shared; destinations use only the viewer's enabled source. */
export async function musicWorkCredits(ids:string[], viewerId:string|null) {
  const credits=new Map<string,{artists:MusicArtist[];albumArtists:MusicArtist[]}>();
  if(!ids.length)return credits;
  const rows=await getDb().execute<{workId:string;role:string;id:string;name:string;externalId:string;connectionId:string|null}>(sql`
    select distinct on(c.work_id,c.role,lower(a.name)) c.work_id as "workId",c.role,a.id,a.name,a.external_id as "externalId",source.id as "connectionId"
    from music_credits c join music_artists a on a.id=c.artist_id
    left join lateral (select pc.id from provider_connections pc join provider_instances i on i.id=pc.instance_id
      where pc.instance_id=a.instance_id and pc.user_id=${viewerId}::uuid and pc.status='connected' and i.enabled and i.provider='jellyfin' limit 1) source on true
    where c.work_id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})
    order by c.work_id,c.role,lower(a.name),(source.id is not null) desc,a.id`);
  for(const row of rows){
    let work=credits.get(row.workId);if(!work){work={artists:[],albumArtists:[]};credits.set(row.workId,work);}
    const artist={id:row.id,name:row.name,...(row.connectionId?{href:musicHref(row.connectionId,row.externalId)}:{})};
    if(row.role==='album-artist')work.albumArtists.push(artist);else if(row.role==='artist')work.artists.push(artist);
  }
  return credits;
}
