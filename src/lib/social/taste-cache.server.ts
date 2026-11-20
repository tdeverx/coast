import { getFeatureConfig, requireFeature, type FeatureConfig } from '#lib/server/features.js';
import { AppError } from '#lib/server/security/errors.js';
import { categoryEnabled } from '#lib/experimental.js';
import {sql as query} from 'drizzle-orm';
import {getDb,getSql,type Database} from '#lib/server/db/index.js';
import {getConfig} from '#lib/server/config.js';
import {interestWorks,visitTasteHistory} from '#lib/recommendations/interests.server.js';
import {prepareTasteReference,scorerFromReference,type TasteReference,createTasteAccumulator,decodeTasteAffinities,tasteDimensions,tasteMedia,type LifetimeTasteProfile,type SavedAffinity,type TasteAffinity,type TasteDimension,type TasteFeatures,type TasteMedium} from './taste-profile';
import {workTasteFeatures} from './work-features.server';
import * as v from 'valibot';
import {assertJobLease,jobCheckpoint,readJobCheckpoint,saveJobCheckpoint} from '#lib/server/queue/execution.js';
type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
// A saved profile can outlive a new watch. A withdrawn evidence source takes effect on the next read.
const tastePolicySql=query`'taste-v6-'||md5(concat_ws(':',coast_feature_enabled(u.id,'social')::text,
 coalesce((select string_agg(concat_ws('/',c.id,c.status,c.account_generation,c.sync_account_id,i.enabled),',' order by c.id)
  from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=u.id),'')))`;
const readableProfile=query`coast_feature_enabled(u.id,'personalisation')
 and coast_category_enabled(u.id,case when p.medium in ('show','movie') then 'screen' else p.medium end)
 and split_part(p.revision,':',1)=${tastePolicySql}`;
export const tasteRevisionSql=query`${tastePolicySql}||':'||md5(concat_ws(':',
 coalesce((select revision::text from content_revisions where scope=u.id::text and domain='tracking'),'0'),
 coalesce((select revision::text from content_revisions where scope=u.id::text and domain='social'),'0'),
 coalesce((select extract(epoch from max(s.updated_at))::text from recommendation_sets s left join provider_connections c on c.id=s.connection_id where s.connection_id is null or c.user_id=u.id),'0'),
 coalesce((select value::text from system_settings where key='coast'),'{}'),coalesce(u.settings->'features','{}'::jsonb)::text))`;
const hasFreshTasteProfile=query`coalesce((select min(p.updated_at)>now()-interval '7 days'
 and bool_and(p.scoring is not null) and min(p.revision)=max(p.revision) and min(p.revision)=${tasteRevisionSql}
 from user_taste_profiles p where p.user_id=u.id),false)`;
const tasteUserEligible=query`not u.disabled and coast_feature_enabled(u.id,'personalisation') and exists(
 select 1 from unnest(array['screen','music','game','book','comic']) as medium where coast_category_enabled(u.id,medium))`;

type TasteSignalSummary = NonNullable<LifetimeTasteProfile['signals'][TasteDimension]>;
type PersonalTasteEntry = {
 medium: TasteMedium; works: number; updatedAt: Date;
 worksWithSignals: number; consumedWorks: number; repeatedWorks: number; explicitWorks: number; inferredWorks: number; ratings: number; medianRating: number|null;
 signals: Partial<Record<TasteDimension, TasteSignalSummary>>;
};
export const tasteAffinityPageSize = 25;
export const maxTasteAffinityPage = Math.floor(Number.MAX_SAFE_INTEGER/tasteAffinityPageSize);

/** The personal view shows the latest saved snapshot without rebuilding profiles or scores. */
export async function personalTaste(userId: string): Promise<PersonalTasteEntry[]> {
 await requireFeature(userId, 'personalisation');
 const rows = await getDb().execute<PersonalTasteEntry>(query`
  select p.medium, p.updated_at as "updatedAt", summary.*
  from users u join user_taste_profiles p on p.user_id=u.id
  cross join lateral jsonb_to_record(p.profile) as summary(
    works int, "worksWithSignals" int, "consumedWorks" int, "repeatedWorks" int, "explicitWorks" int, "inferredWorks" int, ratings int, "medianRating" float8, signals jsonb)
  where u.id=${userId}::uuid and ${readableProfile}`) as PersonalTasteEntry[];
 return rows;
}

/** Read only the selected signal from the caller's saved profile. */
export async function personalTasteAffinities(userId: string, medium: TasteMedium, dimension: TasteDimension, page: number): Promise<{items:TasteAffinity[];pages:number}> {
 await requireFeature(userId,'personalisation');
 const offset=(page-1)*tasteAffinityPageSize;
 const [row]=await getDb().execute<{items:TasteAffinity[]|SavedAffinity[];total:number}>(query`
   with saved as materialized (
     select coalesce(profile->'dimensions'->${dimension}::text,'[]'::jsonb) as entries
     from users u join user_taste_profiles p on p.user_id=u.id
     where u.id=${userId}::uuid and medium=${medium} and ${readableProfile}
   )
   select jsonb_array_length(entries) as total, coalesce((
     select jsonb_agg(entries->position::int order by position)
     from generate_series(${offset}::bigint,least(${offset+tasteAffinityPageSize-1}::bigint,jsonb_array_length(entries)-1)) position
   ),'[]'::jsonb) as items from saved`);
 return {items:decodeTasteAffinities(row?.items??[]),pages:Math.max(1,Math.ceil((row?.total??0)/tasteAffinityPageSize))};
}

export type TasteMatch = ReturnType<ReturnType<typeof scorerFromReference>>;
export type TasteScoreMode = 'published' | 'recalculate';
export const maxTasteBatchSize = 72;
type Target = {id:string;root:string;kind:string;precise:boolean;cached:TasteMatch|null};
type MatchGroup = {reference:TasteReference|null;targets:Target[]};
function hasComparableFeatures(reference:TasteReference){return Object.keys(reference.dimensions).length>0;}

function targetFeatures(target:Target, features:Map<string,TasteFeatures>):TasteFeatures {
 const parent=features.get(target.root)??{};
 if(!target.precise)return parent;
 const child=features.get(target.id)??{};
 const merged={...parent};
 if(target.kind==='track'){
  const artists=child.artists?.filter(artist=>artist.id.startsWith('artist:'));
  if(artists?.length)merged.artists=artists;
 }else{
  // A season or episode can add guests to the show cast and has its own crew.
  for(const dimension of ['cast','directors','writers','composers','cinematographers'] as const){
   const credits=child[dimension]?.filter(person=>person.id.startsWith('tmdb:'));
   if(!credits?.length)continue;
   merged[dimension]=dimension==='cast'
    ? [...new Map([...(parent.cast??[]),...credits].map(person=>[person.id,person])).values()]
    : credits;
  }
 }
 return merged;
}

/** Fetch each required private reference once. Warm targets need only their published result. */
export async function titleTastes(userId:string,workIds:readonly string[],verifiedConfig?:FeatureConfig,mode:TasteScoreMode='published'):Promise<Map<string,TasteMatch>> {
 const config=verifiedConfig??await requireFeature(userId,'personalisation');
 if(workIds.length>maxTasteBatchSize)throw new AppError(400,`Choose up to ${maxTasteBatchSize} titles.`);
 const result=new Map<string,TasteMatch>();
 if(!workIds.length)return result;
 const ids=[...new Set(workIds.map(id=>id.toLowerCase()))];
 const idArray=`{${ids.join(',')}}`; // Callers supply validated UUIDs or catalogue IDs.
 const groups=await getDb().execute<MatchGroup>(query`
  with roots as materialized (
   select w.id,w.kind,coalesce(e.show_id,s.show_id,album.parent_id,w.id) as root,
    case when w.category='music' then 'music' when w.kind in ('season','episode') then 'show' else w.kind end as medium,
    case when album.parent_id is not null then exists(
     select 1 from music_credits cr join music_works artist on artist.id=cr.artist_id and artist.kind='artist'
     where cr.work_id=w.id and cr.role in ('artist','album-artist'))
    when coalesce(e.show_id,s.show_id) is not null then exists(select 1 from work_features f where f.work_id=w.id and f.provider='tmdb'
     and (f.features->'cast'->0 is not null or f.features->'directors'->0 is not null or f.features->'writers'->0 is not null
      or f.features->'composers'->0 is not null or f.features->'cinematographers'->0 is not null))
     or exists(select 1 from metadata_snapshots snap where snap.media_id=w.id and snap.provider='tmdb'
      and (snap.raw#>'{cast,0}' is not null or snap.raw#>'{facts,credits,0}' is not null))
    else false end as precise
   from works w left join episodes e on e.media_id=w.id left join seasons s on s.media_id=w.id
   left join lateral (
    select r.parent_id from media_relationships r join works parent on parent.id=r.parent_id and parent.kind='album'
    where w.kind='track' and r.child_id=w.id and r.kind='contains' order by r.position,r.parent_id limit 1
   ) album on true
   where w.id=any(${idArray}::uuid[])
  )
  select batch.targets,case when batch.cold then p.scoring end as reference
  from users u join user_taste_profiles p on p.user_id=u.id
  join lateral (
   select jsonb_agg(jsonb_build_object('id',r.id,'root',r.root,'kind',r.kind,'precise',r.precise,'cached',ts.breakdown)) as targets,
    bool_or(ts.work_id is null) as cold
   from roots r left join user_taste_scores ts on ${mode==='published'} and not r.precise and ts.user_id=p.user_id and ts.work_id=r.root and ts.revision=p.revision
   where r.medium=p.medium
  ) batch on batch.targets is not null
  where u.id=${userId}::uuid and ${readableProfile}`);
 const missing=new Set<string>();
 for(const {targets,reference} of groups){
  const empty=reference?.works&&!hasComparableFeatures(reference)?scorerFromReference(reference)({}):null;
  for(const target of targets){
   const match=target.cached??empty;
   if(match)result.set(target.id,match);
   else if(reference?.works){missing.add(target.root);if(target.precise)missing.add(target.id);}
  }
 }
 if(missing.size){
  const features=await workTasteFeatures([...missing],config.metadataSource);
  for(const group of groups){
   if(!group.reference?.works)continue;
   const score=scorerFromReference(group.reference);
   const scored=new Map<string,TasteMatch>();
   for(const t of group.targets){
    if(result.has(t.id))continue;
    const key=t.precise?t.id:t.root;
    const match=scored.get(key)??score(targetFeatures(t,features));
    scored.set(key,match);
    result.set(t.id,match);
   }
  }
 }
 return new Map(workIds.flatMap(id=>{const match=result.get(id.toLowerCase());return match?[[id,match] as const]:[];}));
}

export async function titleTaste(userId:string,workId:string,mode?:TasteScoreMode){
 return (await titleTastes(userId,[workId],undefined,mode)).get(workId)??null;
}
/** Piggyback on existing maintenance/outbox. Ten stale users per run; no cartesian user/catalogue scan. */
const scheduleSchema=v.object({enabled:v.optional(v.boolean(),true),intervalMinutes:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10080)),60)});
export async function tasteJob(){
 const config=await getConfig();const sql=getSql(),[settings]=await sql`select value from system_settings where key='taste-refresh'`;
 const parsed=v.safeParse(scheduleSchema,settings?.value),schedule=parsed.success?parsed.output:v.parse(scheduleSchema,{});
 const [last]=await sql`select updated_at as completed,payload->'_jobOutcome' as outcome from outbox_actions where kind='taste.refresh' and state='succeeded' order by updated_at desc limit 1`;
 const [lastRun]=await sql`select id,state,updated_at as at,payload->'_jobOutcome' as outcome,last_error as "lastError" from outbox_actions where kind='taste.refresh' and state in ('succeeded','failed','cancelled') order by updated_at desc,id desc limit 1`;
 const [active]=await sql`select exists(select 1 from outbox_actions where kind='taste.refresh' and state in ('pending','running','failed')) as active`;
 const interval=last?.outcome?.deferred || last?.outcome?.checked>=10 ? 1 : schedule.intervalMinutes;
 return {schedule,timing:{lastRun:lastRun?{id:String(lastRun.id),state:lastRun.state as 'succeeded'|'failed'|'cancelled',at:new Date(lastRun.at).toISOString(),outcome:lastRun.outcome,lastError:lastRun.lastError}:null,instanceId:'taste',kind:'taste.refresh',nextAt:config.features.personalisation!==false&&!config.developerMode&&schedule.enabled&&!active.active?new Date(Math.max(Date.now(),new Date(last?.completed??0).getTime()+interval*60000)).toISOString():null,lastAt:last?.completed?new Date(last.completed).toISOString():null,eligible:1,fresh:0,reviews:0}};
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
 if(active.active){
   const [counts]=await tx.execute<{healthy:number;failed:number}>(query`select count(*) filter(where state in ('pending','running'))::int as healthy,count(*) filter(where state='failed')::int as failed from outbox_actions where kind='taste.refresh' and state in ('pending','running','failed')`);
   if(force)await tx.execute(query`update outbox_actions set payload=payload||'{"_manual":true}'::jsonb where kind='taste.refresh' and state='pending'`);return {queued:0,active:counts.healthy,needsAttention:counts.failed};}
 // Check the backlog promptly. A weekly rebuild picks up metadata-only changes.
 // The configured cadence separates batches, and manual runs retain admission/deduplication.
 if(!force){const [last]=await tx.execute<{due:boolean}>(query`select updated_at<now()-make_interval(mins=>case when coalesce((payload->'_jobOutcome'->>'deferred')::int,0)>0 or coalesce((payload->'_jobOutcome'->>'checked')::int,0)>=10 then 1 else ${schedule.intervalMinutes} end) as due from outbox_actions where kind='taste.refresh' and state='succeeded' order by updated_at desc limit 1`);if(last&&!last.due)return {queued:0,active:0};}
 const [needed]=await tx.execute<{userId:string}>(query`select u.id as "userId" from users u where ${tasteUserEligible} and not ${hasFreshTasteProfile} order by u.created_at,u.id limit 1`);
 if(!needed)return {queued:0,active:0};
 await tx.execute(query`insert into outbox_actions(user_id,kind,payload,compaction_key) values(${needed.userId}::uuid,'taste.refresh',${{_manual:force}}::jsonb,'taste.refresh')`);
 return {queued:1,active:0};
}
const refreshCheckpointSchema=v.object({
 task:v.literal('taste-refresh'),users:v.pipe(v.array(v.pipe(v.string(),v.uuid())),v.maxLength(10)),
 next:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(10)),
 checked:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(10)),
 refreshed:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(10)),
 deferred:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(10)),
});
type RefreshCheckpoint=v.InferOutput<typeof refreshCheckpointSchema>;

async function buildLifetimeProfiles(userId:string,config:FeatureConfig){
 const enabled=tasteMedia.filter(({category})=>categoryEnabled(config,category));
 const categories=[...new Set(enabled.map(({category})=>category))];
 const accumulators=new Map<TasteMedium,ReturnType<typeof createTasteAccumulator>>();
 const sql=getSql();
 await visitTasteHistory(userId,categories,async works=>{
  await assertJobLease(sql);
  const features=await workTasteFeatures(works.map(work=>work.id),config.metadataSource);
  for(const work of works){
   let accumulator=accumulators.get(work.medium);
   if(!accumulator){
    accumulator=createTasteAccumulator({count:work.ratingCount,median:work.medianRating});
    accumulators.set(work.medium,accumulator);
   }
   accumulator.add(work,features.get(work.id)??{});
  }
 });
 return new Map(enabled.map(({value})=>[value,(accumulators.get(value)??createTasteAccumulator()).snapshot()]));
}

export async function refreshTasteCaches(){
 const sql=getSql();
 const parsed=v.safeParse(refreshCheckpointSchema,await readJobCheckpoint());
 let checkpoint:RefreshCheckpoint|null=parsed.success?parsed.output:null;
 if(!checkpoint){
  const stale=await getDb().execute<{id:string}>(query`select u.id from users u where ${tasteUserEligible} and not ${hasFreshTasteProfile} order by (select min(updated_at) from user_taste_profiles where user_id=u.id) asc nulls first,u.id limit 10`);
  checkpoint={task:'taste-refresh',users:stale.map(user=>user.id),next:0,checked:0,refreshed:0,deferred:0};
  await saveJobCheckpoint(checkpoint);
 }
 while(checkpoint.next<checkpoint.users.length){
  const user:{id:string}={id:checkpoint.users[checkpoint.next]};
  // Other users' calculations must not age this user's revision snapshot.
  const [snapshot]=await getDb().execute<{revision:string}>(query`select ${tasteRevisionSql} as revision from users u where u.id=${user.id}::uuid and ${tasteUserEligible}`);
  if(!snapshot){
   checkpoint.next++;
   await saveJobCheckpoint(checkpoint);
   if(checkpoint.next<checkpoint.users.length)await jobCheckpoint();
   continue;
  }
  const config=await getFeatureConfig(user.id);
  const [profiles,evidence]=await Promise.all([buildLifetimeProfiles(user.id,config),interestWorks(user.id)]);
  const references=new Map([...profiles].map(([medium,profile])=>[medium,prepareTasteReference(profile)]));
  const scoreable=[...profiles].filter(([medium])=>hasComparableFeatures(references.get(medium)!));
  const candidateKinds=scoreable.map(([medium])=>medium==='music'?'album':medium);
  const probes=scoreable.flatMap(([medium,profile])=>tasteDimensions.flatMap(dimension=>{
   const selected=[];
   for(const [id,,value,samples] of profile.dimensions[dimension]??[]){
    if(value<=0)continue;
    if(dimension==='cast'&&samples<2)continue;
    selected.push({medium,features:{[dimension]:[{id}]}});
    if(selected.length===8)break;
   }
   return selected;
  }));
  const positive=evidence.filter(work=>work.weight>0),seedIds=positive.map(work=>work.id),genres=[...new Set(positive.flatMap(work=>work.genres))];
  const candidates=candidateKinds.length?await sql<{id:string;medium:TasteMedium}[]>`with provider_ids as (
   select distinct unnest(s.items) as id from recommendation_sets s join provider_instances i on i.id=s.instance_id and i.enabled left join provider_connections c on c.id=s.connection_id and c.status='connected' and c.account_generation=s.account_generation
   where s.connection_id is null and s.seed_id=any(${sql.array(seedIds,'UUID')}::uuid[]) or c.user_id=${user.id} and ${config.enableTrakt}
  ), feature_ids as (
   select distinct f.work_id as id from work_features f join works w on w.id=f.work_id
   where exists(select 1 from jsonb_to_recordset(${JSON.stringify(probes)}::text::jsonb) p(medium text,features jsonb)
    where f.features @> p.features and case when w.category='music' then 'music' else w.kind end=p.medium)
  ), ranked as (
   select w.id,case when w.category='music' then 'music' else w.kind end as medium,
    row_number() over(partition by case when w.category='music' then 'music' else w.kind end order by (p.id is not null) desc,(fi.id is not null) desc,coalesce(m.release_date,g.release_date,a.release_date,b.release_date) desc nulls last,w.id) as rank
   from works w left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id left join reading_works b on b.id=w.id left join provider_ids p on p.id=w.id left join feature_ids fi on fi.id=w.id
   where w.kind=any(${sql.array(candidateKinds,'TEXT')}::text[])
   and (p.id is not null or fi.id is not null or coalesce(m.genres,g.genres,a.genres,b.subjects,'{}'::text[])&&${sql.array(genres,'TEXT')}::text[])
   and not w.id=any(${sql.array(evidence.map(work=>work.id),'UUID')}::uuid[])
   and not exists(select 1 from tracking_state t where t.user_id=${user.id} and t.media_id=w.id and (t.watched or t.dropped or t.collected or t.watchlist or t.favourite))
  ) select id,medium from ranked where rank<=500`:[];
  const scorers=new Map([...references].map(([medium,reference])=>[medium,scorerFromReference(reference)]));
  const scores:(TasteMatch & {workId:string})[]=[];
  for(let offset=0;offset<candidates.length;offset+=300){
   await assertJobLease(sql);
   const batch=candidates.slice(offset,offset+300);
   const features=await workTasteFeatures(batch.map(work=>work.id),config.metadataSource);
   for(const work of batch)scores.push({workId:work.id,...scorers.get(work.medium)!(features.get(work.id)??{})});
  }
  // Recheck revisions after calculation; concurrent imports invalidate the result, not history.
  const progress:RefreshCheckpoint=checkpoint;
  checkpoint=await getDb().transaction<RefreshCheckpoint>(async(tx):Promise<RefreshCheckpoint>=>{
   const [current]=await tx.execute<{revision:string}>(query`select ${tasteRevisionSql} as revision from users u where u.id=${user.id}::uuid and not u.disabled and coast_feature_enabled(u.id,'personalisation') for update of u`) as {revision:string}[];
   await assertJobLease(tx,true);
   const applied:boolean=current?.revision===snapshot.revision;
   if(applied){
    await tx.execute(query`delete from user_taste_scores where user_id=${user.id}::uuid`);
    // Publish the complete enabled-medium set. An old disabled medium must not satisfy a later refresh.
    await tx.execute(query`delete from user_taste_profiles where user_id=${user.id}::uuid
      and not (medium = any(array[${query.join([...profiles.keys()].map(medium=>query`${medium}`),query`, `)}]::text[]))`);
    for(const [medium,profile] of profiles)await tx.execute(query`insert into user_taste_profiles(user_id,medium,revision,profile,scoring) values(${user.id}::uuid,${medium},${snapshot.revision},${profile}::jsonb,${references.get(medium)}::jsonb) on conflict(user_id,medium) do update set revision=excluded.revision,profile=excluded.profile,scoring=excluded.scoring,updated_at=now()`);
    if(scores.length)await tx.execute(query`insert into user_taste_scores(user_id,work_id,score,confidence,revision,breakdown) select ${user.id}::uuid,r."workId",r.score,r.confidence,${snapshot.revision},to_jsonb(r)-'workId' from jsonb_to_recordset(${JSON.stringify(scores)}::text::jsonb) r("workId" uuid,score real,confidence real,dimensions jsonb,reasons jsonb,matches int)`);
   }
   const next:RefreshCheckpoint={...progress,next:progress.next+1,checked:progress.checked+1,refreshed:progress.refreshed+Number(applied),deferred:progress.deferred+Number(!applied)};
   // Cursor and outcome commit with this user's publication. A yield/restart
   // resumes the same ten-user census without repeating completed users.
   await saveJobCheckpoint(next,tx);
   return next;
  });
  if(checkpoint.next<checkpoint.users.length)await jobCheckpoint();
 }
 const {checked,refreshed,deferred}=checkpoint;
 return {checked,refreshed,deferred};
}
