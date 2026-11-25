import { getFeatureConfig, requireFeature, type FeatureConfig } from '#lib/server/features.js';
import { categoryEnabled } from '#lib/experimental.js';
import {sql as query} from 'drizzle-orm';
import {getDb,getSql,type Database} from '#lib/server/db/index.js';
import {getConfig} from '#lib/server/config.js';
import {warmTasteScores} from './taste-shortlist.server';
import {interestWorks} from '#lib/recommendations/interests.server.js';
import {type TasteReference,tasteDimensions,tasteMedia,type LifetimeTasteProfile,type TasteAffinity,type TasteDimension,type TasteFeatures,type TasteMedium} from './taste-profile';
import {visitTasteObservations} from './taste-history.server';
import {trainTasteMedium} from './taste-training';
import {createTasteSelectionTrainer,summarizeTasteSelection,type TasteSelection} from './taste-selection';
import {addTasteOpportunities} from './taste-selection.server';
import * as v from 'valibot';
import {assertJobLease,jobCheckpoint,readJobCheckpoint,saveJobCheckpoint} from '#lib/server/queue/execution.js';
type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
// A saved profile can outlive a new watch. A withdrawn evidence source takes effect on the next read.
const tastePolicySql=query`'taste-v13-'||md5(concat_ws(':',coast_feature_enabled(u.id,'social')::text,
 coalesce((select string_agg(concat_ws('/',c.id,c.status,c.account_generation,c.sync_account_id,i.enabled),',' order by c.id)
  from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=u.id),''),
 case when u.access_defaults->>'libraryOnly'='true' then 'library-only' end))`;
export const readableTasteProfileSql=query`coast_feature_enabled(u.id,'personalisation')
 and coast_category_enabled(u.id,case when p.medium in ('show','movie') then 'screen' else p.medium end)
 and split_part(p.revision,':',1)=${tastePolicySql}`;
// Keep old personal evidence readable while the worker republishes. Only serve a warm
// numeric result if it was calculated with the same scorer used for cache misses.
export const shortlistScoreFormat='fit-3';
/** Presence and ordinary shelf refreshes do not change a published taste profile. */
export async function cardTastePublication(userId:string) {
 const [row]=await getDb().execute<{scope:string|null;revision:string|null}>(query`
  select md5(string_agg(p.medium||':'||split_part(p.revision,':',1),',' order by p.medium)) as scope,
   md5(string_agg(p.medium||':'||p.revision||':'||p.published_at::text,',' order by p.medium)) as revision
  from user_taste_match_models p join users u on u.id=p.user_id
  where u.id=${userId}::uuid and not u.disabled and p.fold=-1 and ${readableTasteProfileSql}
  and right(p.revision,length(${personalMatchVersion}::text)+1)=':'||${personalMatchVersion}::text`);
 return row?.scope && row.revision ? {scope:row.scope,revision:row.revision} : null;
}
export const tasteRevisionSql=query`${tastePolicySql}||':'||md5(concat_ws(':',coalesce(u.settings->>'region','GB'),
 coalesce((select revision::text from content_revisions where scope=u.id::text and domain='tracking'),'0'),
 coalesce((select revision::text from content_revisions where scope=u.id::text and domain='social'),'0'),
 coalesce((select (value-'experimentalCardTasteScores')::text from system_settings where key='coast'),'{}'),coalesce(u.settings->'features','{}'::jsonb)::text,coalesce(u.settings->'featurePermissions','{}'::jsonb)::text))||':'||${shortlistScoreFormat}::text`;
// A provider list changes which titles need a warm score, independently of the viewer's evidence.
const shortlistRevisionSql=query`coalesce((select max(s.updated_at)::text from recommendation_sets s
 left join provider_connections c on c.id=s.connection_id where s.connection_id is null or c.user_id=u.id),'')`;
const hasFreshTasteProfile=query`coalesce((select min(p.updated_at)>now()-interval '7 days'
 and bool_and(p.scoring is not null) and min(p.revision)=max(p.revision) and min(p.revision)=${tasteRevisionSql}
 from user_taste_profiles p where p.user_id=u.id),false)`;
const hasFreshShortlist=query`exists(select 1 from user_taste_profiles p where p.user_id=u.id and p.shortlist_revision=${shortlistRevisionSql})`;
export const personalMatchVersion='personal-v1';
export const personalMatchRevision=query`${tasteRevisionSql}||':'||${personalMatchVersion}::text`;
// A publication updates all admitted media atomically. Empty histories publish an empty model.
const hasFreshMatches=query`exists(select 1 from user_taste_match_models m where m.user_id=u.id and m.fold=-1
 and m.revision=${personalMatchRevision} and m.published_at>now()-interval '7 days')`;
const tasteRefreshDue=query`(not ${hasFreshTasteProfile} or not ${hasFreshShortlist} or not ${hasFreshMatches})`;
const tasteUserEligible=query`not u.disabled and coast_feature_enabled(u.id,'personalisation') and exists(
 select 1 from unnest(array['screen','music','game','book','comic']) as medium where coast_category_enabled(u.id,medium))`;

type TasteSignalPreview = Pick<TasteAffinity, 'name' | 'value' | 'samples' | 'viewingChoice'>;
type TasteSignalSummary = { count: number; preview: TasteSignalPreview[] };

/** Build the owner's display at publication so summary reads stay small and pagination keeps its saved order. */
function appendTasteChoiceDisplay(profile: LifetimeTasteProfile & {choiceOnly?: Partial<Record<TasteDimension, TasteAffinity[]>>}, selection: TasteSelection) {
 const genreNames = Object.fromEntries((profile.dimensions.genres ?? []).map(([id,name]) => [id,name]));
 for (const dimension of tasteDimensions) {
  const rules = selection[dimension];
  if (!rules) continue;
  const entries = profile.dimensions[dimension] ?? [];
  const observed = new Set(entries.map(entry => entry[0]));
  const extras: TasteAffinity[] = [];
  for (const [id, patterns] of Object.entries(rules)) {
   if (observed.has(id) || !patterns.length) continue;
   extras.push({id,name:patterns[0].name ?? id,value:0,samples:0,
    viewingChoice:summarizeTasteSelection(patterns,0,genreNames)});
  }
  extras.sort((a,b) => (a.viewingChoice?.value ?? 0) - (b.viewingChoice?.value ?? 0) || a.id.localeCompare(b.id));
  if (extras.length) (profile.choiceOnly ??= {})[dimension] = extras;
  const preview: TasteSignalPreview[] = entries.slice(0,3).map(([id,name,value,samples]) => ({
   name,value,samples,...(Object.hasOwn(rules,id) ? {viewingChoice:summarizeTasteSelection(rules[id],value,genreNames)} : {}),
  }));
  for (const {name,value,samples,viewingChoice} of extras.slice(0,3-preview.length))
   preview.push({name,value,samples,viewingChoice});
  profile.signals[dimension] = {count:entries.length+extras.length,preview};
 }
}
type PersonalTasteEntry = {
 medium: TasteMedium; works: number; updatedAt: Date;
 worksWithSignals: number; consumedWorks: number; repeatedWorks: number; explicitWorks: number; inferredWorks: number; ratings: number; medianRating: number|null;
 signals: Partial<Record<TasteDimension, TasteSignalSummary>>;
};

/** The personal view shows the latest saved snapshot without rebuilding profiles or scores. */
export async function personalTaste(userId: string): Promise<PersonalTasteEntry[]> {
 await requireFeature(userId, 'personalisation');
 const rows = await getDb().execute<PersonalTasteEntry>(query`
  select p.medium, p.updated_at as "updatedAt", summary.*
  from users u join user_taste_profiles p on p.user_id=u.id
  cross join lateral jsonb_to_record(p.profile) as summary(
    works int, "worksWithSignals" int, "consumedWorks" int, "repeatedWorks" int, "explicitWorks" int, "inferredWorks" int, ratings int, "medianRating" float8, signals jsonb)
  where u.id=${userId}::uuid and ${readableTasteProfileSql}`) as PersonalTasteEntry[];
 return rows;
}

export type TasteScoreMode = 'published' | 'recalculate';

export function targetFeatures(target:{root:string;id:string;kind:string;precise:boolean}, features:Map<string,TasteFeatures>):TasteFeatures {
 const parent=features.get(target.root)??{};
 if(!target.precise)return parent;
 const child=features.get(target.id)??{};
 const merged={...parent};
 if(target.kind==='track'){
  const artists=child.artists?.filter(artist=>artist.id.startsWith('artist:'));
  if(artists?.length)merged.artists=artists;
  for(const dimension of ['tags','writers','composers','studios'] as const){
   if(child[dimension]?.length)
    merged[dimension]=[...new Map([...(parent[dimension]??[]),...child[dimension]].map(feature=>[feature.id,feature])).values()];
  }
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
 const [needed]=await tx.execute<{userId:string}>(query`select u.id as "userId" from users u where ${tasteUserEligible} and ${tasteRefreshDue} order by u.created_at,u.id limit 1`);
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

async function buildLifetimeProfiles(userId:string,config:FeatureConfig,region:string){
 const enabled=tasteMedia.filter(({category})=>categoryEnabled(config,category));
 const categories=[...new Set(enabled.map(({category})=>category))];
 const accumulators=new Map<TasteMedium,ReturnType<typeof trainTasteMedium>>();
 const selection: Partial<Record<TasteMedium, ReturnType<typeof createTasteSelectionTrainer>>> = {};
 const knownTitles = new Map<string,boolean>();
 await visitTasteObservations(userId,categories,config.metadataSource,region,(row,ratingCount,medianRating)=>{
  const {work}=row;
  let accumulator=accumulators.get(work.medium);
  if(!accumulator){
   accumulator=trainTasteMedium(work.medium,ratingCount,medianRating);
   accumulators.set(work.medium,accumulator);
  }
  accumulator.add(row);
  knownTitles.set(work.id,work.chosen);
 });
 for(const [medium,accumulator] of accumulators)
  if(accumulator.selection.ready())selection[medium]=accumulator.selection;
 await addTasteOpportunities(userId,config.metadataSource,region,config.libraryOnly===true,selection,knownTitles);
 const profiles=new Map<TasteMedium,{profile:LifetimeTasteProfile;reference:TasteReference}>();
 for(const {value} of enabled){
  const trained=await (accumulators.get(value)??trainTasteMedium(value,0,null)).finish();
  if(trained.reference.selection)appendTasteChoiceDisplay(trained.profile,trained.reference.selection);
  profiles.set(value,trained);
 }
 return profiles;
}

async function loadPublishedProfiles(userId:string,revision:string){
 const rows=await getSql()<Array<{medium:TasteMedium;profile:LifetimeTasteProfile;reference:TasteReference}>>`
  select medium,profile,scoring as reference from user_taste_profiles where user_id=${userId} and revision=${revision}`;
 return new Map(rows.map(row=>[row.medium,row]));
}

export async function refreshTasteCaches(){
 const parsed=v.safeParse(refreshCheckpointSchema,await readJobCheckpoint());
 let checkpoint:RefreshCheckpoint|null=parsed.success?parsed.output:null;
 if(!checkpoint){
  const stale=await getDb().execute<{id:string}>(query`select u.id from users u where ${tasteUserEligible} and ${tasteRefreshDue} order by (select min(updated_at) from user_taste_profiles where user_id=u.id) asc nulls first,u.id limit 10`);
  checkpoint={task:'taste-refresh',users:stale.map(user=>user.id),next:0,checked:0,refreshed:0,deferred:0};
  await saveJobCheckpoint(checkpoint);
 }
 while(checkpoint.next<checkpoint.users.length){
  const user:{id:string}={id:checkpoint.users[checkpoint.next]};
  // Other users' calculations must not age this user's revision snapshot.
  const [snapshot]=await getDb().execute<{revision:string;region:string;shortlist:string;reuse:boolean;freshMatches:boolean;freshShortlist:boolean}>(query`select ${tasteRevisionSql} as revision,${shortlistRevisionSql} as shortlist,${hasFreshTasteProfile} as reuse,${hasFreshShortlist} as "freshShortlist",${hasFreshMatches} as "freshMatches",coalesce(u.settings->>'region','GB') as region from users u where u.id=${user.id}::uuid and ${tasteUserEligible}`);
  if(!snapshot){
   checkpoint.next++;
   await saveJobCheckpoint(checkpoint);
   if(checkpoint.next<checkpoint.users.length)await jobCheckpoint();
   continue;
  }
  const config=await getFeatureConfig(user.id);
  const needsShortlist=!snapshot.reuse||!snapshot.freshShortlist;
  const [profiles,evidence]=needsShortlist?await Promise.all([
    snapshot.reuse?loadPublishedProfiles(user.id,snapshot.revision):buildLifetimeProfiles(user.id,config,snapshot.region),
    interestWorks(user.id)]):[new Map(),[]];
  const scores=needsShortlist?await warmTasteScores(user.id,snapshot.region,config,evidence,profiles):[];
  const personal=await import('./taste-personal-publish.server');
  const matches=snapshot.freshMatches?null:await personal.buildPersonalMatches(user.id,config,snapshot.region);
  // Recheck revisions after calculation; concurrent imports invalidate the result, not history.
  const progress:RefreshCheckpoint=checkpoint;
  checkpoint=await getDb().transaction<RefreshCheckpoint>(async(tx):Promise<RefreshCheckpoint>=>{
   const [current]=await tx.execute<{revision:string;shortlist:string}>(query`select ${tasteRevisionSql} as revision,${shortlistRevisionSql} as shortlist from users u where u.id=${user.id}::uuid and not u.disabled and coast_feature_enabled(u.id,'personalisation') for update of u`) as {revision:string;shortlist:string}[];
   await assertJobLease(tx,true);
   const applied=!!current&&current.revision===snapshot.revision&&(!needsShortlist||!snapshot.reuse||(profiles.size>0&&current.shortlist===snapshot.shortlist));
   if(applied&&matches)await personal.savePersonalMatches(tx,user.id,snapshot.revision+':'+personalMatchVersion,matches);
   if(applied&&needsShortlist){
    await tx.execute(query`delete from user_taste_scores where user_id=${user.id}::uuid`);
    // Publish the complete enabled-medium set. An old disabled medium must not satisfy a later refresh.
    if(!snapshot.reuse)await tx.execute(query`delete from user_taste_profiles where user_id=${user.id}::uuid
      and not (medium = any(array[${query.join([...profiles.keys()].map(medium=>query`${medium}`),query`, `)}]::text[]))`);
    if(!snapshot.reuse)for(const [medium,{profile,reference}] of profiles)await tx.execute(query`insert into user_taste_profiles(user_id,medium,revision,profile,scoring,shortlist_revision) values(${user.id}::uuid,${medium},${snapshot.revision},${profile}::jsonb,${reference}::jsonb,${snapshot.shortlist}) on conflict(user_id,medium) do update set revision=excluded.revision,profile=excluded.profile,scoring=excluded.scoring,shortlist_revision=excluded.shortlist_revision,updated_at=now()`);
    if(snapshot.reuse)await tx.execute(query`update user_taste_profiles set shortlist_revision=${snapshot.shortlist} where user_id=${user.id}::uuid and revision=${snapshot.revision}`);
    if(scores.length)await tx.execute(query`insert into user_taste_scores(user_id,work_id,score,confidence,revision,breakdown)
     select ${user.id}::uuid,(r->>'workId')::uuid,(r->>'score')::real,(r->>'confidence')::real,${snapshot.revision},r-'workId'
     from jsonb_array_elements(${JSON.stringify(scores)}::text::jsonb) r`);
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
