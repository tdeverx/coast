import {expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {visitTasteHistory} from '../src/lib/recommendations/interests.server';
import {track} from '../src/lib/core/tracking/service.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
type HistoryWork=Parameters<Parameters<typeof visitTasteHistory>[2]>[0][number];

run('release timing, repeated binges and overdue episodes use distinct dated watches', async () => {
 const db = getSql(), viewer = crypto.randomUUID(), show = crypto.randomUUID(), movie = crypto.randomUUID();
 const episodes = Array.from({length: 10}, () => crypto.randomUUID());
 await db`insert into users(id,username) values(${viewer},${'habits-'+viewer})`;
 try {
  await db`insert into media(id,kind,title,release_date)
   values(${show},'show','Viewing habits',null),(${movie},'movie','Repeat plays','2020-01-01')`;
  await db`insert into shows(media_id) values(${show})`;
  await db`insert into media(id,kind,title,release_date) select id,'episode','Viewing habits episode',
   case when at<=3 then date '2020-01-01' when at<=6 then date '2020-01-15'
    when at<=8 then date '2020-02-01' when at=9 then date '2099-01-01' end
   from unnest(${db.array(episodes,'UUID')}) with ordinality as e(id,at)`;
  await db`insert into episodes(media_id,show_id,season_number,episode_number)
   select id,${show},1,at from unnest(${db.array(episodes,'UUID')}) with ordinality as e(id,at)`;
  await db`insert into tracking_events(user_id,media_id,action,source,applied,occurred_at_known,occurred_at,rewatch)
   select ${viewer},id,'watch','trakt',true,true,(case when at<=3 then timestamptz '2020-01-01 12:00Z'
      else timestamptz '2020-01-15 12:00Z' end) + ((at-1)%3)*interval '1 hour',true
   from unnest(${db.array(episodes,'UUID')}) with ordinality as e(id,at) where at<=6`;
  await db`insert into tracking_events(user_id,media_id,action,source,applied,occurred_at_known,occurred_at,rewatch)
   select ${viewer},${movie},'watch','trakt',true,true,timestamptz '2020-01-01 13:00Z'+n*interval '10 days',true
   from generate_series(0,2) n`;
  const history = async () => {
   const rows: HistoryWork[] = [];
   await visitTasteHistory(viewer, ['screen'], async page => { rows.push(...page); });
   return new Map(rows.map(work => [work.id, work]));
  };
  let rows = await history();
  expect(rows.get(show)?.watchHabits).toEqual({pace: expect.closeTo(0.65), binge: expect.closeTo(2/3), behind: 0.5});
  expect(rows.get(movie)).toMatchObject({deliberateReturn: true, watchHabits: {pace: 0.65}});
  await db`insert into tracking_state(user_id,media_id,paused) values(${viewer},${show},true)`;
  rows = await history();
  expect(rows.get(show)?.watchHabits?.behind).toBeUndefined();
  const again=(episode:string,day:number)=>db`insert into tracking_events(user_id,media_id,action,source,occurred_at,rewatch)
    values(${viewer},${episode},'watch','coast',timestamptz '2020-03-01'+${day}::int*interval '1 day',true)`;
  await again(episodes[0],1);await again(episodes[0],2);
  expect((await history()).get(show)).toMatchObject({implicit:3,repeated:false,deliberateReturn:false});
  await again(episodes[1],1);
  expect((await history()).get(show)).toMatchObject({implicit:4,repeated:true,deliberateReturn:false});
  await again(episodes[1],2);
  expect((await history()).get(show)).toMatchObject({repeated:true,deliberateReturn:true});
 } finally {
  await db`delete from users where id=${viewer}`;
  await db`delete from media where id=any(${db.array([...episodes, show, movie],'UUID')})`;
 }
});

run('history separates opinions and exposure and gives each canonical work one vote in its medium',async()=>{
 const db=getSql();
 const [viewer,other,show,episode1,episode2,secondShow,movie,reader,artist]=Array.from({length:9},()=>crypto.randomUUID());
 const collect=async(categories:string[])=>{
  const rows:HistoryWork[]=[];
  await visitTasteHistory(viewer,categories,async page=>{rows.push(...page);});
  return new Map(rows.map(work=>[work.id,work]));
 };
 await db`insert into system_settings(key,value) values('coast','{"experimentalBooks":true,"experimentalMusic":true}') on conflict(key) do update set value=excluded.value`;
 await db`insert into users(id,username) values(${viewer},${'history-'+viewer}),(${other},${'history-'+other})`;
 try{
  await db`insert into media(id,kind,title) values(${show},'show','History show'),(${secondShow},'show','Another show'),
   (${episode1},'episode','Episode one'),(${episode2},'episode','Episode two'),(${movie},'movie','Repeated observations')`;
  await db`insert into shows(media_id) values(${show}),(${secondShow})`;
  await db`insert into episodes(media_id,show_id,season_number,episode_number) values(${episode1},${show},1,1),(${episode2},${show},1,2)`;
  await db`insert into works(id,category,kind) values(${reader},'book','book'),(${artist},'music','artist')`;
  await db`insert into reading_works(id,kind,title,provider,external_id,source_url) values(${reader},'book','Reading history','openlibrary',${reader},'https://fixture.invalid/book')`;
  await db`insert into reading_history(user_id,work_id,state,page) values(${viewer},${reader},'reading',15)`;
  await db`insert into tracking_state(user_id,media_id,watched,dropped,favourite) values
   (${viewer},${episode1},true,false,false),(${viewer},${episode2},false,true,true)`;
  await db`insert into tracking_events(user_id,media_id,action,applied) select ${viewer},${movie},'watch',true from generate_series(1,20)`;
  await db`insert into social_reactions(user_id,target_kind,target_id,emoji) values(${viewer},'work',${movie},'🔥')`;
  await db`insert into ratings(user_id,media_id,value) values(${viewer},${episode1},2.5),(${viewer},${episode2},5),
   (${viewer},${secondShow},4.5),(${other},${show},0.5),(${viewer},${artist},1)`;

  await db`update ratings set source='trakt' where user_id=${viewer} and media_id=${secondShow}`;
  let works=await collect(['screen','book','music']);
  expect(works.size).toBe(5);
  expect(works.get(show)).toMatchObject({rating:3.75,ratingCount:2,ratingReliability:expect.closeTo(Math.sqrt(2/4)),medianRating:4.125,explicit:5,implicit:3,dropped:false,consumed:true,repeated:false});
  expect(works.get(show)?.childRatings).toEqual(expect.arrayContaining([{id:episode1,rating:2.5},{id:episode2,rating:5}]));
  expect(works.get(show)?.lastRatedAt).toBeNull();
  expect(works.get(secondShow)?.lastExperiencedAt).toBeNull();
  expect(works.get(secondShow)?.lastRatedAt).toBeNull();
  expect(works.get(movie)).toMatchObject({rating:null,ratingCount:0,medianRating:null,explicit:4,implicit:3,consumed:true,repeated:false});
  expect(works.get(reader)).toMatchObject({rating:null,explicit:0,implicit:2,consumed:true,repeated:false,medium:'book'});
  expect(works.get(artist)).toMatchObject({rating:1,ratingCount:1,medianRating:1,consumed:false,repeated:false,medium:'music'});
  await db`insert into ratings(user_id,media_id,value,updated_at) values(${viewer},${show},2,'2020-05-01T12:00:00Z')`;
  await db`insert into tracking_state(user_id,media_id,dropped,favourite) values(${viewer},${show},true,true)`;
  await db`insert into tracking_events(user_id,media_id,action,applied,rewatch) values(${viewer},${movie},'watch',true,true)`;
  works=await collect(['screen']);
  expect(works.size).toBe(3);
  expect(new Date(works.get(show)!.lastRatedAt!).toISOString()).toBe('2020-05-01T12:00:00.000Z');
  expect(works.get(show)).toMatchObject({rating:2,ratingCount:2,ratingReliability:1,medianRating:3.25,explicit:5,implicit:-2,dropped:true,consumed:true,repeated:false});
  expect(works.get(movie)).toMatchObject({implicit:4,consumed:true,repeated:true});
  await db`update users set settings=jsonb_set(settings,'{features}','{"social":false}') where id=${viewer}`;
  expect((await collect(['screen'])).get(movie)).toMatchObject({explicit:0,implicit:4});
  await db`update users set disabled=true where id=${viewer}`;
  expect((await collect(['screen','book'])).size).toBe(0);
 }finally{
  await db`delete from users where id in (${viewer},${other})`;
  await db`delete from media where id in (${episode1},${episode2},${show},${secondShow},${movie})`;
  await db`delete from works where id in (${reader},${artist})`;
 }
});

run('overlapping provider watches cannot inflate taste returns even when the tracking count includes both',async()=>{
 const db=getSql(),viewer=crypto.randomUUID(),[movie,summary,instance]=Array.from({length:3},()=>crypto.randomUUID());
 const history=async()=>{
  const rows:HistoryWork[]=[];
  await visitTasteHistory(viewer,['screen'],async page=>{rows.push(...page);});
  return new Map(rows.map(work=>[work.id,work]));
 };
 await db`insert into users(id,username) values(${viewer},${'watch-copies-'+viewer})`;
 try{
  await db`insert into media(id,kind,title) values(${movie},'movie','Provider watch copies'),(${summary},'movie','State-only play count')`;
  await db`insert into tracking_state(user_id,media_id,watched,play_count)
   values(${viewer},${movie},true,2),(${viewer},${summary},true,3)`;
  await db`insert into tracking_events(user_id,media_id,action,source,occurred_at,created_at,rewatch)
   values(${viewer},${movie},'watch','jellyfin','2026-01-01 10:00Z','2026-01-02 10:00Z',false),
    (${viewer},${movie},'watch','trakt','2026-01-01 10:00Z','2026-01-03 10:00Z',true)`;
  let items=await history();
  expect(items.get(movie)).toMatchObject({consumed:true,repeated:false,implicit:3});
  expect(items.get(summary)).toMatchObject({consumed:true,repeated:true,implicit:4});
  await db`insert into tracking_events(user_id,media_id,action,source,occurred_at,created_at) values
   (${viewer},${movie},'unwatch','jellyfin','2026-01-05 10:00Z',now()+interval '1 minute'),
   (${viewer},${movie},'watch','jellyfin','2026-01-01 10:00Z',now()+interval '2 minutes')`;
  expect((await history()).get(movie)).toMatchObject({consumed:true,repeated:false,implicit:3});
  await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Watch count fixture','https://fixture.invalid')`;
  const [connection]=await db`insert into provider_connections(user_id,instance_id,status) values(${viewer},${instance},'connected') returning id`;
  const [source]=await db`insert into provider_items(instance_id,external_id,media_id,kind) values(${instance},'movie',${movie},'movie') returning id`;
  await db`insert into availability(user_id,connection_id,provider_item_id,media_id,source)
   values(${viewer},${connection.id},${source.id},${movie},'{"coastUserData":{"playCount":2}}')`;
  expect((await history()).get(movie)).toMatchObject({consumed:true,repeated:true,implicit:4});
  await db`update provider_connections set status='disconnected' where id=${connection.id}`;
  expect((await history()).get(movie)).toMatchObject({consumed:true,repeated:false,implicit:3});
  await db`insert into tracking_events(user_id,media_id,action,source,occurred_at,rewatch)
   values(${viewer},${movie},'watch','trakt','2026-01-01 10:00:00+00',true)`;
  items=await history();
  expect(items.get(movie)).toMatchObject({consumed:true,repeated:true,implicit:4});
 }finally{
  await db`delete from users where id=${viewer}`;
  await db`delete from provider_instances where id=${instance}`;
  await db`delete from media where id in (${movie},${summary})`;
 }
});

run('a genuine backdated watch after Unwatch still counts as return evidence',async()=>{
 const db=getSql(),viewer=crypto.randomUUID(),movie=crypto.randomUUID();
 await db`insert into users(id,username) values(${viewer},${'backdated-watch-'+viewer})`;
 try{
  await db`insert into media(id,kind,title) values(${movie},'movie','Backdated watch')`;
  await track(viewer,{mediaId:movie,action:'watch',occurredAt:'2024-01-01T10:00:00Z'});
  await track(viewer,{mediaId:movie,action:'unwatch',acknowledged:true});
  const watch=await track(viewer,{mediaId:movie,action:'watch',occurredAt:'2024-02-01T10:00:00Z'});
  expect(watch.state.playCount).toBe(2);
  const history:HistoryWork[]=[];
  await visitTasteHistory(viewer,['screen'],async page=>{history.push(...page);});
  expect(history).toEqual([expect.objectContaining({id:movie,consumed:true,repeated:true,implicit:4})]);
 }finally{
  await db`delete from users where id=${viewer}`;
  await db`delete from media where id=${movie}`;
 }
});

run('show completion evidence requires an ended show and a complete episode census',async()=>{
 const db=getSql(),viewer=crypto.randomUUID();
 const scenarios=[
  {status:'Ended',total:10,completed:10,days:120,outcome:true},
  {status:'Canceled',total:10,completed:2,days:120,outcome:false},
  {status:'Ended',total:10,completed:2,days:120,outcome:null,paused:true},
  {status:'Ended',total:10,completed:2,days:5,outcome:null},
  {status:'Returning Series',total:10,completed:10,days:120,outcome:null},
  {status:'Ended',total:5,completed:5,days:120,outcome:null},
  {status:'Ended',total:10,completed:0,days:120,outcome:null},
 ].map(scenario=>({...scenario,id:crypto.randomUUID()}));
 await db`insert into users(id,username) values(${viewer},${'completion-'+viewer})`;
 try{
  for(const {id,status,total,completed,days,paused} of scenarios){
   await db`insert into media(id,kind,title) values(${id},'show','Completion fixture')`;
   await db`insert into metadata_snapshots(media_id,provider,raw)
    values(${id},'tmdb',${{facts:{status,episodeCount:10}}}::jsonb)`;
   await db`insert into tracking_state(user_id,media_id,watched,favourite,position_seconds,completed_episodes,total_episodes,paused,last_watched_at)
    values(${viewer},${id},${completed===total},true,${completed>0?1:0},${completed},${total},${paused??false},now()-make_interval(days=>${days}::int))`;
  }
  const outcomes=new Map<string,boolean|null|undefined>();
  await visitTasteHistory(viewer,['screen'],async page=>{
   for(const row of page)outcomes.set(row.id,row.completion);
  });
  expect(outcomes.size).toBe(scenarios.length);
  for(const {id,outcome} of scenarios)expect(outcomes.get(id)).toBe(outcome);
 }finally{
  await db`delete from users where id=${viewer}`;
  await db`delete from media where id=any(${db.array(scenarios.map(({id})=>id),'UUID')}::uuid[])`;
 }
});

run('repeat exposure counts once across sources, tracks, reading cycles and game sessions',async()=>{
 const db=getSql(),viewer=crypto.randomUUID();
 const [album,track1,track2,book,game,playthrough]=Array.from({length:6},()=>crypto.randomUUID());
 const history=async()=>{
  const items:HistoryWork[]=[];
  await visitTasteHistory(viewer,['music','book','game'],async page=>{items.push(...page);});
  return new Map(items.map(work=>[work.id,work]));
 };
 await db`insert into system_settings(key,value) values('coast','{"experimentalBooks":true,"experimentalMusic":true,"experimentalGaming":true}') on conflict(key) do update set value=excluded.value`;
 await db`insert into users(id,username) values(${viewer},${'frequency-'+viewer})`;
 try{
  for(const [id,kind] of [[album,'album'],[track1,'track'],[track2,'track']]){
   await db`insert into works(id,category,kind) values(${id},'music',${kind})`;
   await db`insert into music_works(id,kind,title) values(${id},${kind},'Album repetition')`;
  }
  await db`insert into media_relationships(parent_id,child_id,kind,position) values(${album},${track1},'contains',1),(${album},${track2},'contains',2)`;
  const batch=crypto.randomUUID();
  await db`insert into music_listens(user_id,track_id,batch_id) values(${viewer},${track1},${batch}),(${viewer},${track2},${batch})`;
  await db`insert into music_progress(user_id,track_id,play_count) values(${viewer},${track1},1)`;
  await db`insert into works(id,category,kind) values(${book},'book','book')`;
  await db`insert into reading_works(id,kind,title,provider,external_id,source_url) values(${book},'book','Reading cycles','openlibrary',${book},'https://fixture.invalid/book')`;
  await db`insert into reading_progress(user_id,work_id,state,completed_at) values(${viewer},${book},'completed',now())`;
  await db`insert into games(id,title) values(${game},'Game sessions')`;
  await db`insert into game_playthroughs(id,user_id,game_id,status,completed_at) values(${playthrough},${viewer},${game},'completed',now())`;
  await db`insert into game_sessions(id,playthrough_id,minutes_played,played_at) values(${crypto.randomUUID()},${playthrough},45,now()),(${crypto.randomUUID()},${playthrough},30,now())`;
  let items=await history();
  expect(items.size).toBe(3);
  for(const id of [album,book,game])expect(items.get(id)).toMatchObject({consumed:true,repeated:false});
  expect(items.get(album)).toMatchObject({chosen:true,completion:null});
  await db`delete from music_listens where user_id=${viewer} and track_id=${track2}`;
  expect((await history()).get(album)).toMatchObject({consumed:true,chosen:false});
  expect(items.get(book)?.completion).toBe(true);
  expect(items.get(game)?.completion).toBe(true);
  await db`insert into music_listens(user_id,track_id,batch_id) values(${viewer},${track1},${crypto.randomUUID()})`;
  await db`update reading_progress set state='reading',completed_at=null where user_id=${viewer} and work_id=${book}`;
  await db`update reading_progress set state='completed',completed_at=now() where user_id=${viewer} and work_id=${book}`;
  await db`insert into game_playthroughs(user_id,game_id,status,completed_at,repeat) values(${viewer},${game},'completed',now(),true)`;
  items=await history();
  for(const id of [album,book,game])expect(items.get(id)).toMatchObject({consumed:true,repeated:true});
  expect(items.get(game)?.deliberateReturn).toBe(false);
  await db`insert into game_playthroughs(user_id,game_id,status,completed_at,repeat)
    values(${viewer},${game},'completed',now()-interval '10 days',true),(${viewer},${game},'completed',now()-interval '20 days',true)`;
  await db`insert into music_listens(user_id,track_id,batch_id,occurred_at,occurred_at_known)
    select ${viewer},track_id,gen_random_uuid(),now()-n*interval '4 days',true
    from unnest(${db.array([track1,track2],'UUID')}) as t(track_id) cross join generate_series(1,5) n`;
  items=await history();
  expect(items.get(game)?.deliberateReturn).toBe(true);
  expect(items.get(album)?.deliberateReturn).toBe(true);
 }finally{
  await db`delete from users where id=${viewer}`;
  await db`delete from games where id=${game}`;
  await db`delete from works where id in (${album},${track1},${track2},${book})`;
 }
});

run('game playtime ranks use the owner’s known durations, deduplicate overlapping sources and preserve ties',async()=>{
 const db=getSql(),[viewer,other,instance,account]=Array.from({length:4},()=>crypto.randomUUID());
 const games=Array.from({length:6},()=>crypto.randomUUID());
 await db`insert into system_settings(key,value) values('coast','{"experimentalGaming":true}') on conflict(key) do update set value=excluded.value`;
 await db`insert into users(id,username) values(${viewer},${'time-'+viewer}),(${other},${'time-'+other})`;
 try{
  await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'steam','Playtime fixture','https://fixture.invalid')`;
  await db`insert into sync_accounts(id,user_id,instance_id,provider,server_identity,external_user_id)
   values(${account},${viewer},${instance},'steam','fixture',${viewer})`;
  await db`insert into provider_connections(user_id,instance_id,sync_account_id,status) values(${viewer},${instance},${account},'connected')`;
  for(const [i,id] of games.entries()){
   await db`insert into games(id,title) values(${id},${'Duration fixture '+i})`;
   const [p]=await db`insert into game_playthroughs(user_id,game_id,status) values(${viewer},${id},'in-progress') returning id`;
   // The two 60-minute games come from different sources. The first also has overlapping provider time.
   if([0,1,3].includes(i))await db`insert into game_sessions(id,playthrough_id,minutes_played,played_at) values(${crypto.randomUUID()},${p.id},${[10,60,0,120][i]},now())`;
   if([1,2,4].includes(i))await db`insert into game_account_state(account_id,game_id,app_id,minutes_played)
    values(${account},${id},${String(100+i)},${i===4?1000:60})`;
  }
  const [foreign]=await db`insert into game_playthroughs(user_id,game_id,status) values(${other},${games[0]},'in-progress') returning id`;
  await db`insert into game_sessions(id,playthrough_id,minutes_played,played_at) values(${crypto.randomUUID()},${foreign.id},1000,now())`;
  const ranks=new Map<string,number|null|undefined>();
  await visitTasteHistory(viewer,['game'],async rows=>{for(const row of rows)ranks.set(row.id,row.playtimeRank);});
  expect(ranks.size).toBe(6);
  const expected=[-4/9,-1/9,-1/9,2/9,4/9];
  for(const [i,rank] of expected.entries())expect(ranks.get(games[i])).toBeCloseTo(rank);
  expect(ranks.get(games[5])).toBeNull();
 }finally{
  await db`delete from users where id in (${viewer},${other})`;
  await db`delete from provider_instances where id=${instance}`;
  await db`delete from games where id=any(${db.array(games,'UUID')}::uuid[])`;
 }
});

run('release pace learns a regular weekly viewer and respects a later library arrival',async()=>{
 const db=getSql(),viewer=crypto.randomUUID(),instance=crypto.randomUUID();
 const shows=Array.from({length:4},()=>crypto.randomUUID());
 const eps=Array.from({length:12},()=>crypto.randomUUID());
 const movie=crypto.randomUUID();
 await db`insert into users(id,username) values(${viewer},${'viewer-pace-'+viewer})`;
 try{
  await db`insert into media(id,kind,title,release_date) select id,'show','Weekly fixture',date '2020-01-01' from unnest(${db.array(shows,'UUID')}) id`;
  await db`insert into shows(media_id) select id from unnest(${db.array(shows,'UUID')}) id`;
  await db`insert into media(id,kind,title,release_date) select id,'episode','Weekly fixture',date '2020-01-01'+((n::int-1)%3)*7
   from unnest(${db.array(eps,'UUID')}) with ordinality e(id,n)`;
  await db`insert into episodes(media_id,show_id,season_number,episode_number)
   select id,(${db.array(shows,'UUID')}::uuid[])[1+(n::int-1)/3],1,1+(n-1)%3 from unnest(${db.array(eps,'UUID')}) with ordinality e(id,n)`;
  await db`insert into tracking_events(user_id,media_id,action,source,occurred_at,occurred_at_known) select
    ${viewer},id,'watch','trakt',release_date+interval '5 days',true from media where id=any(${db.array(eps,'UUID')})`;
  await db`insert into media(id,kind,title,release_date) values(${movie},'movie','Late library arrival',date '2019-07-01')`;
  await db`insert into tracking_events(user_id,media_id,action,source,occurred_at,occurred_at_known)
   values(${viewer},${movie},'watch','jellyfin','2020-01-09T12:00:00Z',true)`;
  await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Fixture','https://fixture.invalid')`;
  const [connection]=await db`insert into provider_connections(user_id,instance_id,status) values(${viewer},${instance},'connected') returning id`;
  const [item]=await db`insert into provider_items(instance_id,external_id,media_id,kind,snapshot) values(${instance},'film',${movie},'movie','{"addedAt":"2020-01-09T10:00:00Z"}') returning id`;
  await db`insert into availability(user_id,connection_id,provider_item_id,media_id) values(${viewer},${connection.id},${item.id},${movie})`;
  const result=new Map<string,HistoryWork>();
  await visitTasteHistory(viewer,['screen'],async rows=>{for(const row of rows)result.set(row.id,row);});
  expect(result.get(movie)?.watchHabits?.pace).toBe(1);
  for(const id of shows)expect(result.get(id)?.watchHabits?.pace).toBeCloseTo(0.75*0.65);
 }finally{
  await db`delete from users where id=${viewer}`;
  await db`delete from provider_instances where id=${instance}`;
  await db`delete from media where id=any(${db.array([movie,...shows,...eps],'UUID')})`;
 }
});
