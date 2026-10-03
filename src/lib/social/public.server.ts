import {getSql} from '$lib/server/db';
import {getConfig} from '$lib/server/config';
import {AppError} from '$lib/server/security/errors';
import type {MediaView} from '$lib/ui/types';
import {tmdbArtworkUrl} from '$lib/providers/tmdb/artwork.server';
export function isPublicReadPath(path:string) {
 if(/^\/api\/v1\/profile\/avatar\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(path))return true;
 return path==='/'||path==='/discover'||path==='/search'||/^\/profile\/[^/]+$/.test(path)||/^\/media\/[0-9a-f-]{36}$/.test(path)||/^\/music\/work\/[0-9a-f-]{36}$/.test(path)||/^\/games\/[0-9a-f-]{36}$/.test(path)||/^\/api\/v1\/profile\/(activity|section)$/.test(path)||/^\/api\/v1\/artwork\/tmdb\/(w342|w780|w1280|original)\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(path);
}
export async function publicMedia(ids?:string[]):Promise<MediaView[]> {
 if(ids?.length===0)return [];
 const config=await getConfig();
 const rows=ids?await getSql()`select m.*,e.show_id,e.season_number,e.episode_number from media m left join episodes e on e.media_id=m.id where m.id in ${getSql()(ids)} limit 500`:await getSql()`select m.* from media m where kind in ('movie','show','collection') and exists(select 1 from external_ids x where x.media_id=m.id and x.provider in ('tmdb','trakt')) order by updated_at desc,id limit 150`;
 const safeArt=(path:string|null)=>path&&/^https:\/\/image\.tmdb\.org\/t\/p\//.test(path)?tmdbArtworkUrl(path,config.cacheTmdbArtwork):null;
 return rows.map((r:any)=>({id:r.id,kind:r.kind,title:r.title,originalTitle:r.original_title,overview:r.overview,year:r.year,runtimeMinutes:r.runtime_minutes,genres:r.genres,poster:safeArt(r.poster_path),backdrop:safeArt(r.backdrop_path),showId:r.show_id??undefined,seasonNumber:r.season_number??undefined,episodeNumber:r.episode_number??undefined,available:false,progress:0,duration:0,watched:false,playCount:0,watchlist:false,favourite:false,collected:false,dropped:false,rating:null}));
}
export async function publicDetails(id:string) {
 const [item]=await publicMedia([id]);if(!item)throw new AppError(404,'Media not found.');
 const related=await getSql()`select child_id from media_relationships where parent_id=${id} and kind in ('contains','collection','franchise') union select media_id from episodes where show_id=${id} or season_id=${id} union select media_id from seasons where show_id=${id} limit 500`;
 const children=await publicMedia(related.map((r:{child_id:string})=>r.child_id));
 const parentIds=await getSql()`select parent_id from media_relationships where child_id=${id} union select show_id from episodes where media_id=${id}`;
 return {item,episodes:children.filter(m=>m.kind==='episode'),members:children.filter(m=>!['season','episode'].includes(m.kind)),parents:await publicMedia(parentIds.map((r:{parent_id:string})=>r.parent_id)),cast:[],seasons:[],next:null,related:[],collections:[],availability:[],history:[]};
}

/** Guest searches never consult private provider accounts or expose server artwork. */
export async function publicSearch(query:string):Promise<MediaView[]> {
 const pattern='%'+query.replace(/[\\%_]/g,'\\$&')+'%';
 const rows=await getSql()`select m.id from media m where m.kind in ('movie','show','collection') and m.title ilike ${pattern} and exists(select 1 from external_ids x where x.media_id=m.id and x.provider in ('tmdb','trakt')) order by m.title,m.id limit 101`;
 return publicMedia(rows.map((r:{id:string})=>r.id));
}
