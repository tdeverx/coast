import {getSql} from '$lib/server/db';
import {namedFeatures,type TasteFeatures} from './taste-profile';
/** Read existing metadata in a bounded batch; never fetch providers from a page request. */
export async function workTasteFeatures(ids:string[]):Promise<Map<string,TasteFeatures>>{
 if(!ids.length)return new Map();
 const sql=getSql();
 const rows=await sql<{id:string;genres:string[];artists:string[];developers:string[];publishers:string[];authors:string[];series:string|null;features:TasteFeatures}[]>`
 select w.id,coalesce(b.authors,'{}'::text[]) as authors,b.series_title as series,coalesce(m.genres,nullif(g.genres,'{}'::text[]),pg.genres,a.genres,b.subjects,'{}'::text[]) as genres,coalesce(a.artist_names,'{}'::text[]) as artists,
 coalesce(nullif(g.developers,'{}'::text[]),pg.developers,'{}'::text[]) as developers,coalesce(nullif(g.publishers,'{}'::text[]),pg.publishers,'{}'::text[]) as publishers,
 coalesce((select jsonb_object_agg(key,value) from (select distinct on(key) key,value from work_features f cross join lateral jsonb_each(f.features) where f.work_id=coalesce(v.parent_id,w.id) order by key,f.updated_at desc,f.provider) chosen),'{}'::jsonb) as features
 from works w left join media m on m.id=w.id left join games g on g.id=w.id left join game_variants v on v.game_id=w.id left join games pg on pg.id=v.parent_id left join music_works a on a.id=w.id left join reading_works b on b.id=w.id where w.id=any(${sql.array(ids,'UUID')}::uuid[])`;
 return new Map(rows.map(row=>[row.id,{...row.features,genres:namedFeatures(row.genres),...(row.authors.length?{writers:namedFeatures(row.authors),tags:namedFeatures(row.genres)}:{}),...(row.series?{franchises:namedFeatures([row.series])}:{}),...(row.artists.length?{artists:namedFeatures(row.artists)}:{}),...(row.developers.length?{developers:namedFeatures(row.developers)}:{}),...(row.publishers.length?{publishers:namedFeatures(row.publishers)}:{})}]));
}
