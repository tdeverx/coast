import { sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { collectionCTE, collectionRead } from './query.server';
import { mapConcurrent } from '$lib/server/utils/async';
import { getConfig } from '$lib/server/config';
import { pagination, PAGE_SIZE } from '$lib/server/queries/pagination';
import * as v from 'valibot';

/** A read projection: relationship/activity and access changes are immediately reflected. */
export async function missingDemand(userId:string,url:URL) {
  const requested=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1)),Number(url.searchParams.get('page')??1));
  const source=url.searchParams.get('source')??'all';if(source!=='all')v.parse(v.pipe(v.string(),v.uuid()),source);
  const config=await getConfig();
  const candidates=sql`select c.*,case when c.active or exists(select 1 from up_next q where q.user_id=${userId} and q.media_id=c.id) then 'next' else 'planned' end as reason,
    a.availability as needed_availability,a.title as needed_title,a.release_date as needed_release_date,a.category as needed_category
    from collection c join assessments a on a.id=c.next_id where c.kind<>'season' and not c.dropped and not c.completed
      and (c.active or exists(select 1 from up_next q where q.user_id=${userId} and q.media_id=c.id) or exists(select 1 from jsonb_array_elements(c.reasons) r where r->>'relationship'='watchlist' and r->>'origin'='direct'))
      and (a.release_date is null or a.release_date::date<=current_date) and a.availability in ('unknown','unavailable') and (${config.experimentalFeatures} or c.category='screen')`;
  const result=await collectionRead(sql`${collectionCTE(userId,userId,source)}, demand as (select distinct on (next_id) * from (${candidates}) candidates order by next_id,reason,case when kind in ('show','album') then 0 else 1 end,id), totals as (select count(*)::int as total from demand)
    select totals.total,coalesce((select jsonb_agg(selected order by selected.reason,selected.title,selected.id) from (
      select d.*,
        (select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'status',c.status,'enabled',c.enabled,'assessedAt',c.completed_at,'fresh',c.scan_id is null and c.completed_at>=now()-c.cadence*interval '2 minutes')) from connections c) as sources,
        (select jsonb_agg(jsonb_build_object('id',r.id,'state',r.state)) from media_requests r where r.user_id=${userId} and r.media_id in (d.id,d.next_id)) as requests
      from demand d order by d.reason,d.title,d.id limit ${PAGE_SIZE}
        offset (least(${requested},greatest(1,ceil(totals.total::numeric/${PAGE_SIZE})::int))-1)*${PAGE_SIZE}
    ) selected),'[]'::jsonb) as items from totals`);
  const total=Number(result[0]?.total??0),{page,pages}=pagination(total,requested),rows=(result[0]?.items??[]) as Record<string,any>[];
  return {items:Array.from(rows).map(r=>({workId:r.id,title:r.title,neededWorkId:r.next_id,neededTitle:r.needed_title,href:`/${r.needed_category==='music'?'music/work':r.needed_category==='game'?'games':'media'}/${r.next_id}`,reason:r.reason,availability:r.needed_availability,dateUnknown:r.needed_release_date===null,sources:r.sources??[],requests:r.requests??[],meaning:'Not available to you from these sources'})),total,page,pages};
}
export async function adminDemand(url:URL){
  const page=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1)),Number(url.searchParams.get('page')??1)),db=getDb();
  const userId=url.searchParams.get('userId');if(userId)v.parse(v.pipe(v.string(),v.uuid()),userId);
  const itemsPage=url.searchParams.get('itemsPage')??'1';
  v.parse(v.pipe(v.number(),v.integer(),v.minValue(1)),Number(itemsPage));
  const selected=await db.execute(sql`select id,username from users where not disabled and coalesce((settings->>'shareDemand')::boolean,true) and (${userId}::uuid is null or id=${userId}::uuid) order by username limit ${PAGE_SIZE} offset ${(page-1)*PAGE_SIZE}`);
  const result=await mapConcurrent(Array.from(selected),3,async u=>({userId:String(u.id),username:String(u.username),...await missingDemand(String(u.id),new URL(`http://coast/missing?page=${itemsPage}`))}));
  const [count]=await db.execute(sql`select count(*)::int as total from users where not disabled and coalesce((settings->>'shareDemand')::boolean,true) and (${userId}::uuid is null or id=${userId}::uuid)`);
  return {users:result.filter(u=>u.total>0),page,pages:Math.max(1,Math.ceil(Number(count.total)/PAGE_SIZE)),pageSize:PAGE_SIZE};
}
