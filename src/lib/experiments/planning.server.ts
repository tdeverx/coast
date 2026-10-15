import { categoryEnabled } from '$lib/experimental';
import * as v from 'valibot';
import { getSql } from '$lib/server/db';
import { getConfig } from '$lib/server/config';
import { AppError } from '$lib/server/security/errors';
import { requireFriend } from '$lib/social/service.server';
import { workCards } from '$lib/collection/query.server';
import { notify } from '$lib/server/notifications';
import { pagination,PAGE_SIZE } from '$lib/server/queries/pagination';
const uuid=v.pipe(v.string(),v.uuid());
async function enabled(){const config=await getConfig();if(!config.experimentalPlanning)throw new AppError(404,'Planning is disabled.');return config;}
export async function createPlan(userId:string,input:unknown){
 const config=await enabled();
 const data=v.parse(v.strictObject({workId:uuid,startsAt:v.pipe(v.string(),v.isoTimestamp(),v.check(value=>Date.parse(value)>Date.now()&&Date.parse(value)<Date.now()+365*86400000,'Plan within the next year.')),party:v.optional(v.boolean(),false),friends:v.optional(v.pipe(v.array(uuid),v.maxLength(20)),[])}),input);
 const db=getSql(),[work]=await db`select category,kind from works where id=${data.workId}`;
 if(!work||!categoryEnabled(config,work.category))throw new AppError(404,'Work not found.');
 if(data.party&&(!config.experimentalParties||!['movie','episode','track','book','comic'].includes(work.kind)))throw new AppError(400,'Enable Parties and choose a playable or readable title.');
 for(const friend of data.friends)await requireFriend(userId,friend);
 return db.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
  const [count]=await tx`select count(*)::int as total from media_plans where user_id=${userId} and state='scheduled'`;
  if(count.total>=100)throw new AppError(409,'Complete or cancel a plan before adding more.');
  const [row]=await tx`insert into media_plans(user_id,work_id,starts_at,party,friends) values(${userId},${data.workId},${data.startsAt}::timestamptz,${data.party},${JSON.stringify([...new Set(data.friends)])}::text::jsonb) returning id`;
  await tx`insert into outbox_actions(user_id,kind,payload,next_attempt_at) values(${userId},'planning.reminder',${{planId:row.id}}::jsonb,${new Date(Math.max(Date.now(),Date.parse(data.startsAt)-15*60000))})`;
  return {id:row.id};
 });
}
export async function completePlan(userId:string,id:string){await enabled();const rows=await getSql()`update media_plans set state='completed' where id=${v.parse(uuid,id)} and user_id=${userId} and state='scheduled' returning id`;if(!rows.length)throw new AppError(404,'Plan not found.');return {completed:true};}
export async function cancelPlan(userId:string,id:string){await enabled();const rows=await getSql()`update media_plans set state='cancelled' where id=${v.parse(uuid,id)} and user_id=${userId} returning id`;if(!rows.length)throw new AppError(404,'Plan not found.');return {cancelled:true};}
export async function planningData(userId:string,url:URL){
 const config=await enabled(),view=v.parse(v.picklist(['plans','releases']),url.searchParams.get('view')??'plans');
 const category=v.parse(v.picklist(['screen','game','music','reading']),url.searchParams.get('category')??'screen');
 const requested=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10000)),Number(url.searchParams.get('page')??1));
 const db=getSql();
 if(view==='plans'){
  const [count]=await db`select count(*)::int as total from media_plans p join works w on w.id=p.work_id where p.user_id=${userId} and p.state='scheduled' and (w.category=${category} or ${category}='reading' and w.category in ('book','comic')) and (w.category='screen' or (w.category='music' and ${config.experimentalMusic}) or (w.category='game' and ${config.experimentalGaming}) or (w.category='book' and ${config.experimentalBooks}) or (w.category='comic' and ${config.experimentalComics}))`;
  const paging=pagination(count.total,requested);
  const rows=await db<{id:string;workId:string;startsAt:Date;party:boolean;friends:string[]}[]>`select p.id,p.work_id as "workId",p.starts_at as "startsAt",p.party,p.friends from media_plans p join works w on w.id=p.work_id where p.user_id=${userId} and p.state='scheduled' and (w.category=${category} or ${category}='reading' and w.category in ('book','comic')) and (w.category='screen' or (w.category='music' and ${config.experimentalMusic}) or (w.category='game' and ${config.experimentalGaming}) or (w.category='book' and ${config.experimentalBooks}) or (w.category='comic' and ${config.experimentalComics})) order by p.starts_at,p.id limit ${PAGE_SIZE} offset ${(paging.page-1)*PAGE_SIZE}`;
  const cards=await workCards(userId,userId,[...new Set(rows.map(row=>row.workId as string))]);
  const cardsById=new Map(cards.map(card=>[(('workId' in card?card.workId:undefined)??card.id),card]));
  return {view,category,...paging,total:count.total,plans:rows,items:rows.flatMap(row=>{const card=cardsById.get(row.workId);return card?[{...card,captionSubtitle:new Date(row.startsAt).toLocaleString(),entryId:row.id}]:[];})};
 }
 if(!categoryEnabled(config,category))return {view,category,page:1,pages:1,total:0,plans:[],items:[]};
 const [result]=await db`with upcoming as (
  select w.id,coalesce(m.release_date,g.release_date,a.release_date,b.release_date) as release from works w left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id left join reading_works b on b.id=w.id
  where (w.category=${category} or ${category}='reading' and w.category in ('book','comic')) and (w.kind<>'book' or ${config.experimentalBooks}) and (w.kind<>'comic' or ${config.experimentalComics}) and w.kind in ('movie','show','episode','game','album','book','comic') and coalesce(m.release_date,g.release_date,a.release_date,b.release_date) between current_date and current_date+90
  and (exists(select 1 from reading_progress rp where rp.user_id=${userId} and rp.work_id=w.id and rp.state='planned') or exists(select 1 from tracking_state t where t.user_id=${userId} and t.media_id=w.id and t.watchlist and not t.dropped)
    or exists(select 1 from episodes e join tracking_state t on t.media_id=e.show_id where e.media_id=w.id and t.user_id=${userId} and not t.dropped and (t.watchlist or t.collected or t.watched or t.position_seconds>0 or t.completed_episodes>0 or exists(select 1 from episodes watched join tracking_state wt on wt.media_id=watched.media_id and wt.user_id=${userId} where watched.show_id=e.show_id and (wt.watched or wt.position_seconds>0)))))
 ), totals as(select count(*)::int as total from upcoming)
 select total,coalesce((select jsonb_agg(row_to_json(p)) from(select * from upcoming order by release,id limit ${PAGE_SIZE} offset (least(${requested},greatest(1,ceil(total::numeric/${PAGE_SIZE})::int))-1)*${PAGE_SIZE})p),'[]'::jsonb) as items from totals`;
 const upcoming=result.items as {id:string;release:string}[];
 const releaseById=new Map(upcoming.map(item=>[item.id,item.release]));
 return {view,category,...pagination(result.total,requested),total:result.total,plans:[],items:(await workCards(userId,userId,upcoming.map(item=>item.id))).map(item=>({...item,captionSubtitle:`Releases ${releaseById.get(('workId' in item?item.workId:undefined)??item.id)}`}))};
}
export async function remindPlan(userId:string,id:string){
 if(!(await getConfig()).experimentalPlanning)return;
 const [row]=await getSql()`select p.*,u.username from media_plans p join users u on u.id=p.user_id where p.id=${v.parse(uuid,id)} and p.user_id=${userId} and p.state='scheduled' and not u.disabled`;
 if(!row)return;
 await notify({userId,kind:'planning',sourceKey:`plan:${id}`,title:'Your plan is coming up',body:'Open Planning to start or change this plan.',data:{actorId:userId,subjectId:id,destination:'/planning',workId:row.work_id}});
 // Participants receive a plan notification only while the friendship still exists.
 if(row.party)for(const friend of row.friends){try{await requireFriend(userId,friend);}catch{continue;}await notify({userId:friend,kind:'planning',sourceKey:`plan:${id}`,title:row.username,body:`Planned a party for ${new Date(row.starts_at).toISOString()}. The host will send a party invitation when it starts.`,data:{actorId:userId,subjectId:id,destination:'/for-you?friends=true'}});}
}
