import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import type { MusicArtist } from './model';

/** Credits point to shared catalogue identities, never merge artists by display name. */
export async function musicWorkCredits(ids:string[], _viewerId:string|null) {
  const credits=new Map<string,{artists:MusicArtist[];albumArtists:MusicArtist[]}>();
  if(!ids.length)return credits;
  const rows=await getDb().execute<{workId:string;role:string;id:string;name:string}>(sql`
    select distinct on(c.work_id,c.role,c.artist_id) c.work_id as "workId",c.role,c.artist_id as id,m.title as name
    from music_credits c join music_works m on m.id=c.artist_id and m.kind='artist'
    where c.work_id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})
    order by c.work_id,c.role,c.artist_id`);
  for(const row of rows){
    let work=credits.get(row.workId);if(!work){work={artists:[],albumArtists:[]};credits.set(row.workId,work);}
    const artist={id:row.id,name:row.name,href:`/music/work/${row.id}`};
    if(row.role==='album-artist')work.albumArtists.push(artist);else if(row.role==='artist')work.artists.push(artist);
  }
  return credits;
}
