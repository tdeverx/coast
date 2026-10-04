import {sql as query} from 'drizzle-orm';
import {getDb,getSql,type Database} from '$lib/server/db';
import {getConfig} from '$lib/server/config';
import {interestWorks} from '$lib/experiments/interests.server';
import {buildTasteProfile,scoreTaste,namedFeatures,type TasteProfile} from './taste-profile';
import {workTasteFeatures} from './work-features.server';
import * as v from 'valibot';
type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
export const tasteRevisionSql=query`'taste-v1:'||md5(concat_ws(':',
 coalesce((select revision::text from content_revisions where scope=u.id::text and domain='tracking'),'0'),
 coalesce((select revision::text from content_revisions where scope=u.id::text and domain='social'),'0'),
 coalesce((select extract(epoch from max(s.updated_at))::text from recommendation_sets s left join provider_connections c on c.id=s.connection_id where s.connection_id is null or c.user_id=u.id),'0'),
 coalesce((select md5(string_agg(c.id::text||c.status||coalesce(c.account_generation::text,'')||i.enabled::text,',' order by c.id)) from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=u.id),'0'),
 coalesce((select value::text from system_settings where key='coast'),'{}')))`;
// Catalogue enrichment is eventual cache freshness, not personal/privacy validity.
const catalogueRevisionSql=query`coalesce((select revision::text from content_revisions where scope='global' and domain='tracking'),'0')`;
/** Piggyback on existing maintenance/outbox. Ten stale users per run; no cartesian user/catalogue scan. */
const scheduleSchema=v.object({enabled:v.optional(v.boolean(),true),intervalMinutes:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10080)),60)});
export async function tasteJob(){
 const sql=getSql(),[settings]=await sql`select value from system_settings where key='taste-refresh'`;
 const parsed=v.safeParse(scheduleSchema,settings?.value),schedule=parsed.success?parsed.output:v.parse(scheduleSchema,{});
 const [last]=await sql`select updated_at as completed,payload->'_jobOutcome' as outcome from outbox_actions where kind='taste.refresh' and state='succeeded' order by updated_at desc limit 1`;
 const [active]=await sql`select exists(select 1 from outbox_actions where kind='taste.refresh' and state in ('pending','running','failed')) as active`;
 const interval=last?.outcome?.deferred || last?.outcome?.checked>=10 ? 1 : schedule.intervalMinutes;
 return {schedule,timing:{instanceId:'taste',kind:'taste.refresh',nextAt:schedule.enabled&&!active.active?new Date(Math.max(Date.now(),new Date(last?.completed??0).getTime()+interval*60000)).toISOString():null,lastAt:last?.completed?new Date(last.completed).toISOString():null,eligible:1,fresh:0,reviews:0}};
}
export async function updateTasteSchedule(raw:unknown){
 const schedule=v.parse(scheduleSchema,raw);
 await getSql()`insert into system_settings(key,value) values('taste-refresh',${JSON.stringify(schedule)}::text::jsonb) on conflict(key) do update set value=excluded.value`;
 return schedule;
}
export async function runTasteRefresh(){
 return getDb().transaction(async tx=>{await tx.execute(query`select pg_advisory_xact_lock(hashtextextended('provider-maintenance',0))`);return scheduleTasteRefresh(tx,true);});
}
export async function scheduleTasteRefresh(tx:Tx,force=false){
 const [saved]=await tx.execute<{value:unknown}>(query`select value from system_settings where key='taste-refresh'`),parsed=v.safeParse(scheduleSchema,saved?.value);
 const schedule=parsed.success?parsed.output:v.parse(scheduleSchema,{});
 if(!force&&!schedule.enabled)return {queued:0,active:0};
 const [active]=await tx.execute<{active:boolean}>(query`select exists(select 1 from outbox_actions where kind='taste.refresh' and state in ('pending','running','failed')) as active`);
 if(active.active)return {queued:0,active:1};
 // Check for outstanding stale users every minute; unchanged profiles are rebuilt at most daily.
 // The configured cadence separates batches, and manual runs retain admission/deduplication.
 if(!force){const [last]=await tx.execute<{due:boolean}>(query`select updated_at<now()-make_interval(mins=>case when coalesce((payload->'_jobOutcome'->>'deferred')::int,0)>0 or coalesce((payload->'_jobOutcome'->>'checked')::int,0)>=10 then 1 else ${schedule.intervalMinutes} end) as due from outbox_actions where kind='taste.refresh' and state='succeeded' order by updated_at desc limit 1`);if(last&&!last.due)return {queued:0,active:0};}
 const [needed]=await tx.execute<{userId:string}>(query`select u.id as "userId" from users u where not u.disabled and not exists(select 1 from user_taste_profiles p where p.user_id=u.id and p.revision=${tasteRevisionSql} and p.profile->>'catalogueRevision'=${catalogueRevisionSql} and p.updated_at>now()-interval '1 day') order by u.created_at,u.id limit 1`);
 if(!needed)return {queued:0,active:0};
 await tx.execute(query`insert into outbox_actions(user_id,kind,payload,compaction_key) values(${needed.userId}::uuid,'taste.refresh','{}'::jsonb,'taste.refresh')`);
 return {queued:1,active:0};
}
export async function refreshTasteCaches(){
 const config=await getConfig(),sql=getSql();
 const stale=await getDb().execute<{id:string}>(query`select u.id from users u where not u.disabled and not exists(select 1 from user_taste_profiles p where p.user_id=u.id and p.revision=${tasteRevisionSql} and p.profile->>'catalogueRevision'=${catalogueRevisionSql} and p.updated_at>now()-interval '1 day') order by (select min(updated_at) from user_taste_profiles where user_id=u.id) asc nulls first,u.id limit 10`);
 let checked=0,refreshed=0,deferred=0;
 for(const user of stale){
  // Other users' calculations must not age this user's revision snapshot.
  const [snapshot]=await getDb().execute<{revision:string;catalogueRevision:string}>(query`select ${tasteRevisionSql} as revision,${catalogueRevisionSql} as "catalogueRevision" from users u where u.id=${user.id}::uuid and not u.disabled`);
  if(!snapshot)continue;
  const evidence=await interestWorks(user.id),featureMap=await workTasteFeatures(evidence.map(work=>work.id));
  const artistPreferences=await sql<{name:string}[]>`select a.name from music_artist_preferences p join music_artists a on a.id=p.artist_id where p.user_id=${user.id} and p.favourite`;
  const profiles=new Map<string,TasteProfile>();
  for(const medium of ['movie','show','game','music'])profiles.set(medium,buildTasteProfile(evidence.filter(work=>(work.category==='music'?'music':work.kind)===medium).map(work=>({id:work.id,weight:work.weight,features:featureMap.get(work.id)??{}}))));
  if(config.experimentalMusic&&artistPreferences.length){const musicEvidence=evidence.filter(work=>work.category==='music').map(work=>({id:work.id,weight:work.weight,features:featureMap.get(work.id)??{}}));profiles.set('music',buildTasteProfile([...musicEvidence,...artistPreferences.map(artist=>({id:`artist:${artist.name}`,weight:5,features:{artists:namedFeatures([artist.name])}}))]));}
  const probes=[...profiles].flatMap(([medium,profile])=>Object.entries(profile.dimensions).flatMap(([dimension,features])=>(features??[]).filter(feature=>feature.value>0&&(dimension!=='cast'||feature.samples>=2)).slice(0,8).map(feature=>({medium,features:{[dimension]:[{id:feature.id}]}}))));
  const positive=evidence.filter(work=>work.weight>0),seedIds=positive.map(work=>work.id),genres=[...new Set(positive.flatMap(work=>work.genres))];
  const candidates=await sql<{id:string;medium:string}[]>`with provider_ids as (
   select distinct unnest(s.items) as id from recommendation_sets s join provider_instances i on i.id=s.instance_id and i.enabled left join provider_connections c on c.id=s.connection_id and c.status='connected' and c.account_generation=s.account_generation
   where s.connection_id is null and s.seed_id=any(${sql.array(seedIds,'UUID')}::uuid[]) or c.user_id=${user.id} and ${config.enableTrakt}
  ), feature_ids as (
   select distinct f.work_id as id from jsonb_to_recordset(${JSON.stringify(probes)}::text::jsonb) p(medium text,features jsonb) join work_features f on f.features @> p.features join works w on w.id=f.work_id and case when w.category='music' then 'music' else w.kind end=p.medium
  ), ranked as (
   select w.id,case when w.category='music' then 'music' else w.kind end as medium,
    row_number() over(partition by case when w.category='music' then 'music' else w.kind end order by (p.id is not null) desc,(fi.id is not null) desc,coalesce(m.release_date,g.release_date,a.release_date) desc nulls last,w.id) as rank
   from works w left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id left join provider_ids p on p.id=w.id left join feature_ids fi on fi.id=w.id
   where w.kind in ('movie','show','game','album') and (w.category='screen' or w.category='music' and ${config.experimentalMusic} or w.category='game' and ${config.experimentalGaming})
   and (p.id is not null or fi.id is not null or coalesce(m.genres,g.genres,a.genres,'{}'::text[])&&${sql.array(genres,'TEXT')}::text[])
   and not w.id=any(${sql.array(evidence.map(work=>work.id),'UUID')}::uuid[])
   and not exists(select 1 from tracking_state t where t.user_id=${user.id} and t.media_id=w.id and (t.watched or t.dropped or t.collected or t.watchlist or t.favourite))
  ) select id,medium from ranked where rank<=500`;
  const candidateFeatures=await workTasteFeatures(candidates.map(work=>work.id));
  const scores=candidates.map(work=>({workId:work.id,...scoreTaste(profiles.get(work.medium)!,candidateFeatures.get(work.id)??{})}));
  // Recheck revisions after calculation; concurrent imports invalidate the result, not history.
  const applied=await getDb().transaction(async tx=>{
   const [current]=await tx.execute<{revision:string}>(query`select ${tasteRevisionSql} as revision from users u where u.id=${user.id}::uuid and not u.disabled for update of u`);
   if(current?.revision!==snapshot.revision)return false;
   await tx.execute(query`delete from user_taste_scores where user_id=${user.id}::uuid`);
   for(const [medium,profile] of profiles)await tx.execute(query`insert into user_taste_profiles(user_id,medium,revision,profile) values(${user.id}::uuid,${medium},${snapshot.revision},${{...profile,catalogueRevision:snapshot.catalogueRevision}}::jsonb) on conflict(user_id,medium) do update set revision=excluded.revision,profile=excluded.profile,updated_at=now()`);
   if(scores.length)await tx.execute(query`insert into user_taste_scores(user_id,work_id,score,confidence,revision,breakdown) select ${user.id}::uuid,r."workId",r.score,r.confidence,${snapshot.revision},to_jsonb(r) from jsonb_to_recordset(${JSON.stringify(scores)}::text::jsonb) r("workId" uuid,score real,confidence real,dimensions jsonb,reasons jsonb,matches int)`);
   return true;
  });
  checked++;if(applied)refreshed++;else deferred++;
 }
 return {checked,refreshed,deferred};
}
