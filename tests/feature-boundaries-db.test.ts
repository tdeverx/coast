import {beforeAll,beforeEach,afterAll,test,expect} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {sql} from 'drizzle-orm';
import {defaultConfig} from '../src/lib/server/config';
import {changeContinue} from '../src/lib/core/tracking/continue.server';
import {setRewatch} from '../src/lib/core/tracking/rewatch.server';
import {addLocalSeasonEpisodes} from '../src/lib/core/media/service.server';
import {createList,getList,getLists} from '../src/lib/core/lists/service.server';
import {trackWithExports} from '../src/lib/sync/changes.server';
import {setUpNext} from '../src/lib/core/lists/up-next.server';
import {missingDemand,adminDemand} from '../src/lib/collection/demand.server';
import {titleInsights,personCredits} from '../src/lib/catalogue/details.server';
import {mediaStatistics} from '../src/lib/server/queries/media-statistics';
import {publicMedia,publicSearch} from '../src/lib/social/public.server';
import {searchMedia,discoverMedia,ensureDetails} from '../src/lib/catalogue/service.server';
import {friendDiscovery} from '../src/lib/social/insights.server';
import {recommendations} from '../src/lib/social/service.server';
import {requestOptions,requestMedia} from '../src/lib/providers/seerr/requests.server';
import {createPlan,remindPlan} from '../src/lib/experiments/planning.server';
import {setStatus} from '../src/lib/social/status.server';
const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const a=crypto.randomUUID(),b=crypto.randomUUID(),movie=crypto.randomUUID(),show=crypto.randomUUID();let previous:unknown;
const config={...defaultConfig,experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true,experimentalParties:true,experimentalPlanning:true};
async function choices(id:string,features:Record<string,boolean>){await getSql()`update users set settings=${{features,social:{audience:'public'}}}::jsonb where id=${id}`;}
beforeAll(async()=>{
 if(!enabled)return;const db=getSql();previous=(await db`select value from system_settings where key='coast'`)[0]?.value;
 await db`insert into users(id,username,role) values(${a},${'gate-a-'+a},'admin'),(${b},${'gate-b-'+b},'user')`;
 await db`insert into media(id,kind,title) values(${movie},'movie','Feature boundary movie'),(${show},'show','Feature boundary show')`;
 await db`insert into shows(media_id) values(${show})`;
 await db`insert into external_ids(media_id,provider,external_id,media_kind) values(${movie},'tmdb','900000099','movie')`;
 await db`insert into friendships(user_a,user_b,requested_by,state) values(${[a,b].sort()[0]},${[a,b].sort()[1]},${a},'accepted')`;
});
beforeEach(async()=>{if(!enabled)return;await choices(a,{});await choices(b,{});await getSql()`insert into system_settings(key,value) values('coast',${config}::jsonb) on conflict(key) do update set value=excluded.value`;});
afterAll(async()=>{if(!enabled)return;const db=getSql();await db`delete from users where id in (${a},${b})`;await db`delete from works where id in (${movie},${show})`;if(previous)await db`update system_settings set value=${previous}::jsonb where key='coast'`;else await db`delete from system_settings where key='coast'`;});
run('direct Continue, rewatch, manual-episode and initial-list-item writes reject a withdrawn medium',async()=>{
 await choices(a,{screen:false});
 await expect(changeContinue(a,{mediaId:movie,action:'add'})).rejects.toMatchObject({code:'feature_disabled'});
 await expect(setRewatch(a,{mediaId:movie,startedAt:new Date().toISOString()})).rejects.toMatchObject({code:'feature_disabled'});
 await expect(addLocalSeasonEpisodes(a,show,1,2)).rejects.toMatchObject({code:'feature_disabled'});
 await expect(createList(a,{name:'Denied initial member',mediaId:movie})).rejects.toMatchObject({code:'feature_disabled'});
 const [row]=await getSql()`select (select count(*)::int from up_next where user_id=${a}) as queued,(select count(*)::int from rewatches where user_id=${a}) as rewatches,(select count(*)::int from episodes where show_id=${show}) as episodes,(select count(*)::int from lists where user_id=${a}) as lists`;
 expect(row).toEqual({queued:0,rewatches:0,episodes:0,lists:0});
});
run('direct title/people enrichment and personal statistics fail before provider work',async()=>{
 await choices(a,{screen:false});
 await expect(titleInsights(a,movie,'tmdb')).rejects.toMatchObject({code:'feature_disabled'});
 await expect(personCredits(a,1)).rejects.toMatchObject({code:'feature_disabled'});
 await expect(mediaStatistics(a,movie,'all')).rejects.toMatchObject({code:'feature_disabled'});
 await expect(ensureDetails(a,movie)).rejects.toMatchObject({code:'feature_disabled'});
 expect(await searchMedia(a,'Feature')).toEqual({items:[],providerUnavailable:false,truncated:false});
 expect((await discoverMedia(a)).items).toEqual([]);
 expect(await requestOptions(a,movie)).toEqual([]);
 await expect(requestMedia(a,{mediaId:movie,instanceId:crypto.randomUUID(),addToWatchlist:false})).rejects.toMatchObject({code:'feature_disabled'});
});
run('mixed list details/counts and missing-demand counts omit disabled media without deleting membership',async()=>{
 const list=await createList(a,{name:'Retained membership',mediaId:movie});
 await trackWithExports(a,{mediaId:movie,action:'collect',value:true});await setUpNext(a,{mediaId:movie,queued:true});
 expect((await missingDemand(a,new URL('https://coast.test/missing'))).items.map(item=>item.workId)).toContain(movie);
 await choices(a,{screen:false});
 expect((await getList(a,list.id)).items).toHaveLength(0);
 expect((await getLists(a)).find(item=>item.id===list.id)?.itemCount).toBe(0);
 expect((await missingDemand(a,new URL('https://coast.test/missing'))).total).toBe(0);
 expect((await adminDemand(new URL('https://coast.test/admin/demand'))).users.map(item=>item.userId)).not.toContain(a);
 expect((await getSql()`select count(*)::int as count from list_items where list_id=${list.id}`)[0].count).toBe(1);
});
run('guest catalogue/search and shared provider jobs obey installation ceilings, not a scheduler opt-out',async()=>{
 expect((await publicMedia([movie])).map(item=>item.id)).toContain(movie);
 await choices(a,{game:false,screen:false});
 const [personal]=await getSql()`select coast_job_allowed(${a}::uuid,'igdb.steam-metadata','{}'::jsonb) as shared,coast_job_allowed(${a}::uuid,'steam.sync','{}'::jsonb) as personal,coast_job_allowed(${a}::uuid,'tmdb.recommendations','{}'::jsonb) as recommendations`;
 expect(personal).toEqual({shared:true,personal:false,recommendations:true});
 await getSql()`update system_settings set value=jsonb_set(jsonb_set(value,'{features}','{"screen":false}'::jsonb),'{experimentalGaming}','false'::jsonb) where key='coast'`;
 expect(await publicMedia([movie])).toEqual([]);expect(await publicSearch('Feature')).toEqual([]);
 const [installation]=await getSql()`select coast_job_allowed(${a}::uuid,'igdb.steam-metadata','{}'::jsonb) as shared,coast_job_allowed(${a}::uuid,'tmdb.recommendations','{}'::jsonb) as recommendations`;
 expect(installation).toEqual({shared:false,recommendations:false});
});
run('Social withdrawal leaves public privacy intact but removes optional friend discovery/recommendation cohorts',async()=>{
 await trackWithExports(b,{mediaId:movie,action:'watch',occurredAt:new Date().toISOString()});
 await getSql()`insert into social_recommendations(sender_id,recipient_id,work_id) values(${b},${a},${movie})`;
 expect((await friendDiscovery(a)).map(item=>item.workId)).toContain(movie);
 expect((await recommendations(a)).map(item=>item.workId)).toContain(movie);
 await choices(b,{social:false});
 expect((await getSql()`select social_visible(${b}::uuid,${a}::uuid,'activity','screen') as visible`)[0].visible).toBe(true);
 expect((await friendDiscovery(a)).map(item=>item.workId)).not.toContain(movie);
 expect((await recommendations(a)).map(item=>item.workId)).not.toContain(movie);
});
run('plan reminders enforce owner and recipient media policy while Presence preferences cannot revive reporting',async()=>{
 const plan=await createPlan(a,{workId:movie,startsAt:new Date(Date.now()+30*60000).toISOString(),party:true,friends:[b]});
 await choices(a,{screen:false});await remindPlan(a,plan.id);
 expect(await getSql()`select 1 from notifications where source_key=${'plan:'+plan.id}`).toHaveLength(0);
 await choices(a,{});await choices(b,{screen:false});await remindPlan(a,plan.id);
 const notices=await getSql()`select user_id from notifications where source_key=${'plan:'+plan.id}`;
 expect(notices.map((row:{user_id:string})=>row.user_id)).toEqual([a]);
 await choices(a,{presence:false});
 await getSql()`insert into user_presence(user_id,heartbeat_at,active_at) values(${a},now(),now()) on conflict(user_id) do update set heartbeat_at=now(),active_at=now()`;
 expect((await setStatus(a,{preference:'busy'})).status).toBe('offline');
});

run('Presence Off blocks optional Trakt live reports while history imports and operational server stops remain admitted',async()=>{
 await choices(a,{presence:false});const db=getSql();
 const [policy]=await db`select coast_job_allowed(${a}::uuid,'trakt.scrobble','{"event":"start"}'::jsonb) as live,coast_job_allowed(${a}::uuid,'trakt.import','{}'::jsonb) as history,coast_job_allowed(${a}::uuid,'jellyfin.scrobble','{"event":"stop"}'::jsonb) as cleanup`;
 expect(policy).toEqual({live:false,history:true,cleanup:true});
 const {executeLiveScrobbleToAdapter}=await import('../src/lib/sync/trakt-export.server');let calls=0;const connectionId=crypto.randomUUID();
 const context={connection:{id:connectionId,userId:a},sync:{scrobble:true},adapter:{scrobble:async()=>{calls++;}}} as unknown as Parameters<typeof executeLiveScrobbleToAdapter>[3];
 await expect(executeLiveScrobbleToAdapter(a,connectionId,{mediaId:movie,sessionId:crypto.randomUUID(),event:'start',progress:0},context)).rejects.toMatchObject({code:'feature_disabled'});
 expect(calls).toBe(0);
});

run('direct statistics, insights and credits endpoints return feature refusal rather than an internal outage',async()=>{
 await choices(a,{screen:false});
 const {GET:statistics}=await import('../src/routes/api/v1/media/[id]/statistics/+server');
 const {GET:insights}=await import('../src/routes/api/v1/media/[id]/insights/+server');
 const {GET:credits}=await import('../src/routes/api/v1/people/[id]/credits/+server');
 const {load:person}=await import('../src/routes/people/[id]/+page.server');
 const event={locals:{user:{id:a}},params:{id:movie},url:new URL('https://coast.test/fixture')};
 for(const response of await Promise.all([statistics(event as Parameters<typeof statistics>[0]),insights(event as Parameters<typeof insights>[0])])){expect(response.status).toBe(403);expect((await response.json()).code).toBe('feature_disabled');}
 const response=await credits({...event,params:{id:'1'}} as Parameters<typeof credits>[0]);expect(response.status).toBe(403);expect((await response.json()).code).toBe('feature_disabled');
 await expect(person({...event,params:{id:'1'}} as Parameters<typeof person>[0])).rejects.toMatchObject({status:403});
});
run('watchlist availability notices remain independent of the Media requests opt-out',async()=>{
 await choices(a,{requests:false});const {notify,inbox}=await import('../src/lib/server/notifications');
 await notify({userId:a,kind:'availability',title:'Watchlist available without requests',sourceKey:`available:${movie}`,data:{actorId:a,subjectId:movie,workId:movie,destination:`/media/${movie}`}});
 const items=await inbox({id:a,username:'fixture',role:'admin',settings:{}} as Parameters<typeof inbox>[0]);
 expect(items.map(item=>item.title)).toContain('Watchlist available without requests');
});

run('playlist starts and sharing-source selection enforce their own capability independently of media tracking',async()=>{
 const list=await createList(a,{name:'Playback stays separate',playlist:true,mediaId:movie});
 await choices(a,{playback:false});const {restartPlaylist}=await import('../src/lib/core/lists/sequence.server');
 await expect(restartPlaylist(a,list.id)).rejects.toMatchObject({code:'feature_disabled'});
 expect((await getSql()`select playback_started_at from lists where id=${list.id}`)[0].playback_started_at).toBeNull();
 await choices(a,{sharing:false});const {handler}=await import('../src/lib/server/api/index.server');
 const url=new URL(`https://coast.test/api/v1/sharing/sources?workId=${movie}`),request=new Request(url);
 const response=await handler({request,url,params:{path:'sharing/sources'},locals:{user:{id:a,username:'fixture',role:'admin',settings:{}}}} as Parameters<typeof handler>[0]);
 expect(response.status).toBe(403);expect((await response.json()).code).toBe('feature_disabled');
});

run('personal and administrator withdrawal wait for an admitted tracking transaction to commit',async()=>{
 const {getDb}=await import('../src/lib/server/db');
 const {trackInTransaction,track}=await import('../src/lib/core/tracking/service.server');
 const {updateUserSettings}=await import('../src/lib/server/auth');
 const {updateConfig}=await import('../src/lib/application/configuration.server');
 const actor={id:a,username:'gate-admin',role:'admin',settings:{}} as import('../src/lib/server/auth').SessionUser;
 for(const global of [false,true]){
  await choices(a,{});await getSql()`update system_settings set value=${config}::jsonb where key='coast'`;
  let entered!:()=>void,release!:()=>void,pid=0,disabled=false;
  const ready=new Promise<void>(resolve=>entered=resolve),hold=new Promise<void>(resolve=>release=resolve);
  const writing=getDb().transaction(async tx=>{
   pid=(await tx.execute<{pid:number}>(sql`select pg_backend_pid() as pid`))[0].pid;
   await trackInTransaction(tx,a,{mediaId:movie,action:'favourite',value:true});entered();await hold;
  });
  await ready;
  const disabling=(global?updateConfig(actor,{features:{screen:false}}):updateUserSettings(actor,{features:{screen:false}})).then(()=>{disabled=true;});
  try{
   let blocked=false;
   for(let i=0;i<100&&!blocked;i++){
    blocked=!!(await getSql()`select 1 from pg_stat_activity where ${pid}::int=any(pg_blocking_pids(pid)) limit 1`).length;
    if(!blocked)await Bun.sleep(10);
   }
   expect(blocked).toBe(true);expect(disabled).toBe(false);
  }finally{release();await writing;await disabling;}
  expect(disabled).toBe(true);
  await expect(track(a,{mediaId:movie,action:'favourite',value:false})).rejects.toMatchObject({code:'feature_disabled'});
 }
});

run('tracking rechecks current policy after waiting for a personal or administrator settings writer',async()=>{
 const {track}=await import('../src/lib/core/tracking/service.server');
 for(const global of [false,true]){
  await choices(a,{});await getSql()`update system_settings set value=${config}::jsonb where key='coast'`;
  let entered!:()=>void,release!:()=>void,pid=0;
  const ready=new Promise<void>(resolve=>entered=resolve),hold=new Promise<void>(resolve=>release=resolve);
  const disabling=getSql().begin(async tx=>{
   pid=(await tx`select pg_backend_pid() as pid`)[0].pid;
   if(global){await tx`select pg_advisory_xact_lock(hashtextextended('coast:configuration',0))`;await tx`update system_settings set value=jsonb_set(value,'{features}','{"screen":false}'::jsonb) where key='coast'`;}
   else await tx`update users set settings=jsonb_set(settings,'{features}','{"screen":false}'::jsonb) where id=${a}`;
   entered();await hold;
  });
  await ready;
  const writing=track(a,{mediaId:movie,action:'watchlist',value:true}).then(()=>null,cause=>cause);
  try{
   let blocked=false;
   for(let i=0;i<100&&!blocked;i++){
    blocked=!!(await getSql()`select 1 from pg_stat_activity where ${pid}::int=any(pg_blocking_pids(pid)) limit 1`).length;
    if(!blocked)await Bun.sleep(10);
   }
   expect(blocked).toBe(true);
  }finally{release();await disabling;}
  expect(await writing).toMatchObject({code:'feature_disabled'});
 }
});
