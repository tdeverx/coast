import {sql} from 'drizzle-orm';
import * as v from 'valibot';
import {getDb} from '#lib/server/db/index.js';
import {getFeatureConfig} from '#lib/server/features.js';
import {workSummaries} from '#lib/collection/query.server.js';
import {pagination,PAGE_SIZE} from '#lib/server/queries/pagination.js';

/** Read shared identities from observed user access; never call provider browsing APIs. */
export async function publicLibrary(userId:string,url:URL) {
 const category=v.parse(v.picklist(['all','screen','game','music','reading']),url.searchParams.get('category')??'all');
 const kind=v.parse(v.picklist(['all','movie','show','season','episode','collection','game','album','track','book','comic']),url.searchParams.get('kind')??'all');
 const source=v.parse(v.union([v.literal('all'),v.pipe(v.string(),v.uuid())]),url.searchParams.get('source')??'all');
 const config=await getFeatureConfig(userId);
 const requested=Number(url.searchParams.get('page')??1);
 // Materialize access once so empty access skips graph work; recursive UNION deduplicates IDs.
 const [result]=await getDb().execute<{total:number;ids:string[]}>(sql`with recursive initial_access(id) as materialized (
   select a.media_id from availability a join provider_connections c on c.id=a.connection_id join provider_instances p on p.id=c.instance_id
   where a.user_id=${userId} and c.user_id=${userId} and a.state='available' and c.status='connected' and p.enabled
     and (${source}='all' or c.id::text=${source})
 ), edges as (
   select parent_id,child_id from media_relationships where kind in ('contains','collection','sequence')
   union all select show_id,media_id from episodes where not is_special
   union all select season_id,media_id from episodes where season_id is not null and not is_special
   union all select show_id,media_id from seasons
 ), accessible(id) as (
   select id from initial_access
   union select e.parent_id from accessible a join edges e on e.child_id=a.id where exists(select 1 from initial_access)
 ), filtered as (
   select w.id from works w where w.id in(select id from accessible) and (${category}='all' or w.category=${category} or ${category}='reading' and w.kind in ('book','comic'))
     and (${kind}='all' or w.kind=${kind}) and w.category in ('screen','game','music','book','comic') and (w.category='book' and ${config.experimentalBooks} or w.category='comic' and ${config.experimentalComics} or w.category='screen' and ${config.features.screen} or (w.category='music' and ${config.experimentalMusic}) or (w.category='game' and ${config.experimentalGaming}))
 ), total as (select count(*)::int as total from filtered)
 select total,coalesce((select jsonb_agg(id order by id) from(select id from filtered order by id limit ${PAGE_SIZE}
   offset (least(${requested},greatest(1,ceil(total::numeric/${PAGE_SIZE})::int))-1)*${PAGE_SIZE}) page),'[]'::jsonb) as ids from total`);
 return {...pagination(result.total,requested),total:result.total,items:await workSummaries(userId,userId,result.ids)};
}
