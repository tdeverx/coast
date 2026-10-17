import {beforeAll,afterAll,expect,test} from 'bun:test';
import {getDb,getSql,closeDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {getConfig} from '../src/lib/server/config';
import {progressData} from '../src/lib/server/queries/progress';
import {friendDiscovery} from '../src/lib/social/insights.server';
import {activityFeed} from '../src/lib/social/queries.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const user=crypto.randomUUID(),friend=crypto.randomUUID();
const show=crypto.randomUUID(),season=crypto.randomUUID(),episodes=[crypto.randomUUID(),crypto.randomUUID()],game=crypto.randomUUID(),track=crypto.randomUUID();
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getDb(),config=await getConfig();
 await db.insert(s.systemSettings).values({key:'coast',value:{...config,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}});
 await db.insert(s.users).values([{id:user,username:`for-you-${user}`},{id:friend,username:`for-you-${friend}`,settings:{profile:{avatar:'/fixture-avatar.gif'}}}]);
 await db.insert(s.friendships).values({userA:[user,friend].sort()[0],userB:[user,friend].sort()[1],state:'accepted',requestedBy:user});
 await db.insert(s.media).values([{id:show,kind:'show',title:'Friend show'},{id:season,kind:'season',title:'Season one'},...episodes.map((id,index)=>({id,kind:'episode' as const,title:`Episode ${index+1}`,runtimeMinutes:30}))]);
 await db.insert(s.shows).values({mediaId:show});await db.insert(s.seasons).values({mediaId:season,showId:show,seasonNumber:1});
 await db.insert(s.episodes).values(episodes.map((id,index)=>({mediaId:id,showId:show,seasonId:season,seasonNumber:1,episodeNumber:index+1})));
 await db.insert(s.games).values({id:game,title:'Active game'});
 await db.insert(s.works).values({id:track,category:'music',kind:'track'});
 await db.insert(s.musicWorks).values({id:track,kind:'track',title:'Resumable track'});
});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1')await closeDb();});
run('Next combines saved and queued titles once, filters before 60-item pagination',async()=>{
 const db=getDb(),movies=Array.from({length:61},()=>crypto.randomUUID());
 await db.insert(s.media).values(movies.map((id,index)=>({id,kind:'movie' as const,title:`Saved ${index}`})));
 await db.insert(s.trackingState).values(movies.map(mediaId=>({mediaId,userId:user,watchlist:true})));
 await db.insert(s.upNext).values({userId:user,mediaId:movies[0]});
 const first=await progressData(user,{view:'next'}),second=await progressData(user,{view:'next',page:2});
 expect(first.total).toBe(61);expect(first.pages).toBe(2);expect(first.items).toHaveLength(60);expect(second.items).toHaveLength(1);
 expect(new Set([...first.items,...second.items].map(i=>i.id)).size).toBe(61);
 expect((await progressData(user,{view:'next',scope:'available'})).total).toBe(0);
});
run('Playing and Listening use concrete activity and retain feature/privacy gates',async()=>{
 const db=getDb();await db.insert(s.gamePlaythroughs).values({userId:user,gameId:game,status:'in-progress'});
 await db.insert(s.musicProgress).values({userId:user,trackId:track,positionSeconds:50,durationSeconds:200});
 expect((await progressData(user,{category:'screen'})).emptyAllMedia).toBe(false);
 expect((await progressData(user,{category:'game'})).items.map(i=>i.id)).toEqual([game]);
 expect((await progressData(user,{category:'music'})).items.map(i=>'workId' in i?i.workId:i.id)).toEqual([track]);
 expect((await progressData(user,{category:'music',scope:'available'})).items).toHaveLength(0);
 await getSql()`update users set settings=${{social:{sections:{progress:'private'}}}}::jsonb where id=${user}`;
 await expect(progressData(user,{category:'game'},friend)).rejects.toThrow();
 await getSql()`update users set settings='{}'::jsonb where id=${user}`;
 await db.insert(s.trackingState).values({userId:user,mediaId:game,favourite:true,watchlist:true});
 expect((await progressData(user,{category:'game',view:'favourites'})).items.map(i=>i.id)).toEqual([game]);
 expect((await progressData(user,{category:'game',view:'next'})).items).toHaveLength(0);
 await getSql()`update game_playthroughs set status='completed',completed_at=now() where user_id=${user}`;
 expect((await progressData(user,{category:'game'})).items).toHaveLength(0);
 expect((await progressData(user,{category:'game',view:'next'})).items.map(i=>i.id)).toEqual([game]);
});
run('grouped episode activity uses the show and a concise count with a privacy-safe actor',async()=>{
 const db=getSql();for(let i=0;i<episodes.length;i++)await db`insert into social_activity(user_id,work_id,source_key,event_kind,section,source,occurred_at) values(${friend},${episodes[i]},${'for-you:'+episodes[i]},'watch','activity','coast',now()+${i}*interval '1 minute')`;
 const feed=await activityFeed(user),item=feed.items.find(i=>i.id===show)!;
 expect(item.kind).toBe('show');expect(item.captionSubtitle).toBe('Watched 2 episodes');expect(item.captionActor?.avatar).toBe('/fixture-avatar.gif');
 await db`update users set settings=${{social:{sections:{details:'private'}},profile:{avatar:'/fixture-avatar.gif'}}}::jsonb where id=${friend}`;
 expect((await activityFeed(user)).items.find(i=>i.id===show)?.captionActor?.avatar).toBeNull();
});

run('repeated dated Jellyfin snapshots appear once as ordinary watches without deleting history',async()=>{
 const db=getDb(),raw=getSql(),ids=Array.from({length:21},()=>crypto.randomUUID());
 await db.insert(s.media).values(ids.map(id=>({id,kind:'movie' as const,title:'Imported movie'})));
 for(const batch of ['first','repeat'])for(const id of ids)await raw`insert into social_activity(user_id,work_id,source_key,event_kind,section,source,batch_key,occurred_at,date_known) values(${friend},${id},${'repeat:'+batch+':'+id},'watch','activity','jellyfin',${'repeat:'+batch},'2020-01-01T00:00:00Z',true)`;
 const watches=(await activityFeed(user,{friendId:friend})).events.filter(event=>ids.includes(event.workId));
 expect(watches).toHaveLength(21);expect(watches.every(e=>e.eventKind==='watch'&&e.count===1)).toBe(true);
 expect((await raw`select count(*)::int n from social_activity where source_key like 'repeat:%'`)[0].n).toBe(42);
});

run('an actively watched saved show remains in Continue rather than duplicating Next',async()=>{
 const db=getDb();await db.insert(s.trackingState).values([{userId:user,mediaId:show,watchlist:true},{userId:user,mediaId:episodes[0],positionSeconds:30,durationSeconds:1800}]);
 expect((await progressData(user,{view:'watching',kind:'show'})).items.map(item=>item.id)).toContain(episodes[0]);
 expect((await progressData(user,{view:'next',kind:'show'})).items).toHaveLength(0);
});

run('imported activity joins the ordinary date-sorted feed with privacy and stable pagination',async()=>{
 const db=getDb(),raw=getSql(),owner=crypto.randomUUID(),ids=Array.from({length:63},()=>crypto.randomUUID());
 await db.insert(s.users).values({id:owner,username:`import-${owner}`});
 await db.insert(s.friendships).values({userA:[user,owner].sort()[0],userB:[user,owner].sort()[1],requestedBy:user,state:'accepted'});
 await db.insert(s.media).values(ids.map((id,index)=>({id,kind:'movie' as const,title:`Import ${index}`})));
 for(let i=0;i<ids.length;i++)await raw`insert into social_activity(user_id,work_id,source_key,event_kind,section,source,batch_key,occurred_at,date_known) values(${owner},${ids[i]},${'expanded:'+ids[i]},'watch','activity','trakt','expanded-fixture',${i===62?'2026-10-01T00:00:00Z':new Date(Date.UTC(2020,0,i+1)).toISOString()},${i!==62})`;
 const local=crypto.randomUUID();
 await db.insert(s.media).values({id:local,kind:'movie',title:'Local watch between imported watches'});
 await raw`insert into social_activity(user_id,work_id,source_key,event_kind,section,source,occurred_at) values(${owner},${local},${'local:'+local},'watch','activity','coast','2020-01-31T12:00:00Z')`;
 const first=await activityFeed(user,{friendId:owner});
 expect(first.items).toHaveLength(60);expect(first.hasMore).toBe(true);expect(first.events[0].workId).toBe(ids[61]);
 expect(first.events.every(e=>e.eventKind==='watch'&&e.dateKnown)).toBe(true);
 const localIndex=first.events.findIndex(e=>e.workId===local);expect(localIndex).toBeGreaterThan(0);expect(localIndex).toBeLessThan(59);
 expect(new Date(first.events[localIndex-1].occurredAt).getTime()).toBeGreaterThan(new Date(first.events[localIndex].occurredAt).getTime());
 expect(new Date(first.events[localIndex+1].occurredAt).getTime()).toBeLessThan(new Date(first.events[localIndex].occurredAt).getTime());
 const second=await activityFeed(user,{friendId:owner,...first.next});
 expect(second.items).toHaveLength(4);expect(second.hasMore).toBe(false);expect(second.events.at(-1)?.workId).toBe(ids[62]);expect(second.items.at(-1)?.captionActivity?.dateKnown).toBe(false);
 expect(new Set([...first.events,...second.events].map(e=>e.id)).size).toBe(64);
 await raw`update users set settings=${{social:{sections:{activity:'private'}}}}::jsonb where id=${owner}`;
 expect((await activityFeed(user,{friendId:owner})).items).toHaveLength(0);
});

run('activity details use the actor rating, session duration and repeat listens without private notes',async()=>{
 const db=getDb(),raw=getSql(),playthrough=crypto.randomUUID();
 await db.insert(s.ratings).values({userId:friend,mediaId:game,value:4.5});
 await db.insert(s.gamePlaythroughs).values({id:playthrough,userId:friend,gameId:game,status:'in-progress'});
 await db.insert(s.gameSessions).values({id:crypto.randomUUID(),playthroughId:playthrough,minutesPlayed:45,playedAt:new Date(),note:'OWNER ONLY SECRET'});
 for(let i=0;i<2;i++)await db.insert(s.musicListens).values({userId:friend,trackId:track,batchId:crypto.randomUUID(),occurredAt:new Date(Date.now()+i*1000)});
 const feed=await activityFeed(user);
 expect(feed.items.some(i=>i.captionSubtitle==='Rated · 4.5/5')).toBe(true);
 expect(feed.items.some(i=>i.captionSubtitle==='Played · 45 minutes')).toBe(true);
 expect(feed.items.some(i=>i.captionSubtitle?.includes('Listen 2'))).toBe(true);
 expect(JSON.stringify(feed)).not.toContain('OWNER ONLY SECRET');
 expect((await activityFeed(user,{category:'music'})).events.every(e=>e.eventKind==='listen')).toBe(true);
 expect((await activityFeed(user,{category:'game'})).events.every(e=>e.workId===game)).toBe(true);
 await raw`update users set settings=${{social:{sections:{ratings:'private'}}}}::jsonb where id=${friend}`;
 expect((await activityFeed(user)).items.some(i=>i.captionSubtitle?.startsWith('Rated'))).toBe(false);
});

run('episode groups allow three-hour gaps but split beyond that',async()=>{
 const db=getSql(),events=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
 const dates=['2018-01-01T00:00:00Z','2018-01-01T03:00:00Z','2018-01-01T06:01:00Z'];
 for(let i=0;i<events.length;i++)await db`insert into social_activity(id,user_id,work_id,source_key,event_kind,section,source,occurred_at) values(${events[i]},${friend},${episodes[i%episodes.length]},${'group-gap:'+events[i]},'watch','activity','coast',${dates[i]})`;
 const feed=await activityFeed(user,{friendId:friend}),groups=feed.events.filter(e=>events.includes(e.id));
 expect(groups).toHaveLength(2);expect(groups.map(e=>e.count)).toEqual([1,2]);
 expect(groups[1].id).toBe(events[1]);
 const single=feed.items.find(i=>i.entryId===groups[0].id)!;
 expect(single.id).toBe(episodes[0]);expect(single.kind).toBe('episode');expect(single.title).toBe('Episode 1');expect(single.captionSubtitle).toBe('Watched 1 episode');expect(single.captionTitle).toBe('Friend show');expect(single.captionActivity?.action).toBe('Watched');expect(single.captionActivity?.detail).toBe('1 episode');
 const captions=feed.items.filter(i=>i.entryId===groups[1].id);
 expect(captions[0].id).toBe(show);expect(captions[0].kind).toBe('show');
 expect(captions[0].captionSubtitle).toBe('Watched 2 episodes');
});

run('the feed includes private own activity alongside visible friends but never unrelated users',async()=>{
 const db=getDb(),raw=getSql(),owner=crypto.randomUUID(),peer=crypto.randomUUID(),stranger=crypto.randomUUID(),movie=crypto.randomUUID();
 await db.insert(s.users).values([{id:owner,username:`self-${owner}`,settings:{social:{audience:'private'}}},{id:peer,username:`peer-${peer}`},{id:stranger,username:`stranger-${stranger}`,settings:{social:{audience:'public'}}}]);
 await db.insert(s.friendships).values({userA:[owner,peer].sort()[0],userB:[owner,peer].sort()[1],state:'accepted',requestedBy:owner});
 await db.insert(s.media).values({id:movie,kind:'movie',title:'Own-feed fixture movie'});
 for(let i=0;i<2;i++)await raw`insert into social_activity(user_id,work_id,source_key,event_kind,section,source,occurred_at) values(${owner},${episodes[i]},${'own:'+owner+':'+i},'watch','activity','coast',${i?'2020-02-01T00:03:00Z':'2020-02-01T00:00:00Z'})`;
 for(const actor of [peer,stranger])await raw`insert into social_activity(user_id,work_id,source_key,event_kind,section,source,occurred_at) values(${actor},${movie},${'peer:'+actor},'watch','activity','coast','2020-02-01T00:02:00Z')`;
 const feed=await activityFeed(owner,{category:'screen'});
 expect(feed.events.map(e=>e.userId)).toEqual([owner,peer]);
 expect(feed.items[0].captionSubtitle).toBe('Watched 2 episodes');expect(feed.items[0].id).toBe(show);
 expect((await activityFeed(owner,{friendId:owner})).events).toHaveLength(1);
 expect((await activityFeed(peer,{friendId:owner})).events).toHaveLength(0);
 await raw`update users set settings=${{social:{audience:'private'}}}::jsonb where id=${peer}`;
 expect((await activityFeed(owner)).events.map(e=>e.userId)).toEqual([owner]);
});

run('popular with friends ranks root works once per friend and respects privacy and medium',async()=>{
 const db=getSql(),viewer=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID(),stranger=crypto.randomUUID();
 for(const id of [viewer,a,b,stranger])await db`insert into users(id,username) values(${id},${'popular-'+id})`;
 for(const id of [a,b])await db`insert into friendships(user_a,user_b,state,requested_by) values(${[viewer,id].sort()[0]},${[viewer,id].sort()[1]},'accepted',${viewer})`;
 for(const [actor,work] of [[a,episodes[0]],[a,episodes[1]],[b,season],[stranger,game],[viewer,game],[a,game]])await db`insert into social_activity(user_id,work_id,source_key,event_kind,section,source,occurred_at) values(${actor},${work},${crypto.randomUUID()},'watch','activity','coast',now())`;
 const screen=await friendDiscovery(viewer,'screen');
 expect(screen).toHaveLength(1);expect(screen[0].workId).toBe(show);expect(screen[0].friends).toBe(2);
 const playing=await friendDiscovery(viewer,'game');expect(playing).toHaveLength(1);expect(playing[0].friends).toBe(1);
 await db`update users set settings=${{social:{sections:{activity:'private'}}}}::jsonb where id=${b}`;
 expect((await friendDiscovery(viewer,'screen'))[0].friends).toBe(1);
 await db`delete from friendships where user_a=${[viewer,a].sort()[0]} and user_b=${[viewer,a].sort()[1]}`;
 expect(await friendDiscovery(viewer,'screen')).toHaveLength(0);
 expect(await friendDiscovery(viewer,'music')).toHaveLength(0);
 const album=crypto.randomUUID();
 await db`insert into works(id,category,kind) values(${album},'music','album')`;
 await db`insert into media_relationships(parent_id,child_id,kind,position) values(${album},${track},'contains',1)`;
 await db`insert into social_activity(user_id,work_id,source_key,event_kind,section,source,occurred_at) values(${b},${track},${crypto.randomUUID()},'listen','activity','coast',now())`;
 await db`update users set settings='{}'::jsonb where id=${b}`;
 const music=await friendDiscovery(viewer,'music');expect(music).toHaveLength(1);expect(music[0].workId).toBe(album);

});

run('item activity filters before pagination and retains reading detail, privacy and reactions',async()=>{
 const db=getDb(),raw=getSql(),config=await getConfig(),reader=crypto.randomUUID(),visible=crypto.randomUUID(),hidden=crypto.randomUUID(),stranger=crypto.randomUUID(),book=crypto.randomUUID(),comic=crypto.randomUUID(),history=crypto.randomUUID();
 await db.insert(s.systemSettings).values({key:'coast',value:{...config,experimentalBooks:true,experimentalComics:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalBooks:true,experimentalComics:true}}});
 try{
  await db.insert(s.users).values([{id:reader,username:`reader-${reader}`},{id:visible,username:`visible-${visible}`},{id:hidden,username:`hidden-${hidden}`,settings:{social:{sections:{activity:'private'}}}},{id:stranger,username:`stranger-${stranger}`}]);
  for(const id of [visible,hidden])await db.insert(s.friendships).values({userA:[reader,id].sort()[0],userB:[reader,id].sort()[1],state:'accepted',requestedBy:reader});
  await db.insert(s.works).values([{id:book,kind:'book',category:'book'},{id:comic,kind:'comic',category:'comic'}]);
  await db.insert(s.readingWorks).values([{id:book,kind:'book',provider:'openlibrary',externalId:book,title:'Scoped book',sourceUrl:'https://openlibrary.org/'},{id:comic,kind:'comic',provider:'comic-vine',externalId:comic,title:'Other comic',sourceUrl:'https://comicvine.gamespot.com/'}]);
  await db.insert(s.readingHistory).values({id:history,userId:reader,workId:book,state:'reading',page:80,totalPages:320});
  const progress=crypto.randomUUID();
  await db.insert(s.socialActivity).values({id:progress,userId:reader,workId:book,eventKind:'reading-reading',section:'activity',source:'coast',sourceKey:`reading:${history}`,occurredAt:new Date('2030-01-01')});
  await db.insert(s.socialActivity).values(Array.from({length:61},(_,i)=>({userId:reader,workId:book,eventKind:'reading-reading',section:'activity',source:'coast',sourceKey:`scoped:${i}`,occurredAt:new Date(Date.UTC(2029,0,i+1))})));
  for(const id of [visible,hidden,stranger])await db.insert(s.socialActivity).values({userId:id,workId:book,eventKind:'reading-completed',section:'activity',source:'coast',sourceKey:`scoped:${id}`});
  await db.insert(s.socialActivity).values({userId:reader,workId:comic,eventKind:'reading-completed',section:'activity',source:'coast',sourceKey:'other-work'});
  await db.insert(s.socialReactions).values({userId:reader,targetKind:'activity',targetId:progress,emoji:'❤️'});
  const first=await activityFeed(reader,{workId:book,category:'reading'}),next=await activityFeed(reader,{workId:book,category:'reading',...first.next!});
  expect(first.items).toHaveLength(60);expect(first.hasMore).toBe(true);expect(next.items).toHaveLength(3);expect(next.hasMore).toBe(false);
  const items=[...first.items,...next.items];expect(new Set(items.map(item=>item.entryId)).size).toBe(63);expect(items.every(item=>item.id===book)).toBe(true);
  expect(items.some(item=>item.captionActor?.username===`visible-${visible}`)).toBe(true);
  expect(items.some(item=>[hidden,stranger].some(id=>item.captionActor?.username?.endsWith(id)))).toBe(false);
  expect(first.items.find(item=>item.entryId===progress)?.captionActivity?.detail).toBe('80 of 320 pages');
  expect(first.items.find(item=>item.entryId===progress)?.captionActivity?.id).toBe(progress);
  expect(first.items.find(item=>item.entryId===progress)?.captionActivity?.myReaction).toBe('❤️');
  await expect(activityFeed(reader,{workId:'invalid'})).rejects.toThrow();
 }finally{await raw`update system_settings set value=${config}::jsonb where key='coast'`;}
});

run('item Activity includes verified episode and album membership without leaking unrelated titles',async()=>{
 const db=getDb(),viewer=crypto.randomUUID(),series=crypto.randomUUID(),seasonA=crypto.randomUUID(),seasonB=crypto.randomUUID(),epA=crypto.randomUUID(),epB=crypto.randomUUID(),albumA=crypto.randomUUID(),albumB=crypto.randomUUID(),recording=crypto.randomUUID(),unrelated=crypto.randomUUID(),gameId=crypto.randomUUID();
 await db.insert(s.users).values({id:viewer,username:`scope-${viewer}`});
 await db.insert(s.media).values([{id:series,kind:'show',title:'Scoped show'},{id:seasonA,kind:'season',title:'One'},{id:seasonB,kind:'season',title:'Two'},{id:epA,kind:'episode',title:'A'},{id:epB,kind:'episode',title:'B'}]);
 await db.insert(s.shows).values({mediaId:series});await db.insert(s.seasons).values([{mediaId:seasonA,showId:series,seasonNumber:1},{mediaId:seasonB,showId:series,seasonNumber:2}]);
 await db.insert(s.episodes).values([{mediaId:epA,showId:series,seasonId:seasonA,seasonNumber:1,episodeNumber:1},{mediaId:epB,showId:series,seasonId:seasonB,seasonNumber:2,episodeNumber:1}]);
 await db.insert(s.works).values([albumA,albumB,recording,unrelated].map(id=>({id,category:'music' as const,kind:[albumA,albumB].includes(id)?'album' as const:'track' as const})));
 await db.insert(s.musicWorks).values([albumA,albumB,recording,unrelated].map(id=>({id,title:id,kind:[albumA,albumB].includes(id)?'album' as const:'track' as const})));
 await db.insert(s.mediaRelationships).values([{parentId:albumA,childId:recording,kind:'contains',position:1},{parentId:albumB,childId:recording,kind:'contains',position:1},{parentId:albumA,childId:unrelated,kind:'contains',position:2}]);
 await db.insert(s.games).values({id:gameId,title:'Scoped game'});
 await db.insert(s.socialActivity).values([epA,epB,recording,unrelated,gameId].map(workId=>({userId:viewer,workId,eventKind:[epA,epB].includes(workId)?'watch':workId===gameId?'session':'listen',section:'activity',source:'coast',sourceKey:`container:${workId}`})));
 const showFeed=await activityFeed(viewer,{workId:series});expect(showFeed.events).toHaveLength(1);expect(showFeed.events[0].count).toBe(2);
 const seasonFeed=await activityFeed(viewer,{workId:seasonA});expect(seasonFeed.events.map(event=>event.workId)).toEqual([epA]);
 const episodeFeed=await activityFeed(viewer,{workId:epB});expect(episodeFeed.events.map(event=>event.workId)).toEqual([epB]);
 const albumFeed=await activityFeed(viewer,{workId:albumB});expect(albumFeed.events.map(event=>event.workId)).toEqual([recording]);expect(albumFeed.events[0].rootId).toBe(albumB);
 const trackFeed=await activityFeed(viewer,{workId:recording});expect(trackFeed.events.map(event=>event.workId)).toEqual([recording]);
 const gameFeed=await activityFeed(viewer,{workId:gameId});expect(gameFeed.events.map(event=>event.workId)).toEqual([gameId]);
});
run('artist and comic-volume Activity use verified credit and issue membership',async()=>{
 const db=getDb(),raw=getSql(),config=await getConfig(),viewer=crypto.randomUUID(),artist=crypto.randomUUID(),recording=crypto.randomUUID(),other=crypto.randomUUID(),issue=crypto.randomUUID(),volume=crypto.randomUUID();
 await db.insert(s.systemSettings).values({key:'coast',value:{...config,experimentalComics:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalComics:true}}});
 try{
  await db.insert(s.users).values({id:viewer,username:`membership-${viewer}`});
  const [server]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:'Activity credits fixture',baseUrl:'https://fixture.invalid'}).returning();
  await db.insert(s.musicArtists).values({id:artist,instanceId:server.id,externalId:artist,name:'Scoped artist'});
  await db.insert(s.works).values([{id:recording,category:'music',kind:'track'},{id:other,category:'music',kind:'track'},{id:issue,category:'comic',kind:'comic'}]);
  await db.insert(s.musicWorks).values([{id:recording,kind:'track',title:'Artist recording'},{id:other,kind:'track',title:'Other recording'}]);
  await db.insert(s.musicCredits).values({artistId:artist,workId:recording,role:'artist'});
  await db.insert(s.readingWorks).values({id:issue,kind:'comic',provider:'comic-vine',externalId:issue,title:'Volume issue',sourceUrl:'https://comicvine.gamespot.com/'});
  await db.insert(s.readingGroups).values({id:volume,kind:'comic',provider:'comic-vine',externalId:'4050-9000001',title:'Scoped volume'});
  await db.insert(s.readingGroupMembers).values({groupId:volume,workId:issue,position:'1'});
  await db.insert(s.socialActivity).values([recording,other,issue].map(workId=>({userId:viewer,workId,eventKind:workId===issue?'reading-completed':'listen',section:'activity',source:'coast',sourceKey:`membership:${workId}`})));
  expect((await activityFeed(viewer,{artistId:artist})).events.map(event=>event.workId)).toEqual([recording]);
  expect((await activityFeed(viewer,{readingGroupId:volume})).events.map(event=>event.workId)).toEqual([issue]);
 }finally{await raw`update system_settings set value=${config}::jsonb where key='coast'`;}
});
run('merged item Activity preserves undated relationships, private fields and stable event/state pagination',async()=>{
 const db=getDb(),raw=getSql(),viewer=crypto.randomUUID(),movie=crypto.randomUUID(),people=Array.from({length:69},()=>crypto.randomUUID());
 await db.insert(s.users).values([{id:viewer,username:`merged-${viewer}`},...people.map((id,index)=>({id,username:`merged-peer-${index}-${id}`,disabled:index===65,settings:index===66?{features:{social:false}}:index===67?{social:{sections:{favourites:'private' as const,collection:'private' as const}}}:index===0?{profile:{avatar:'https://private.invalid'},social:{sections:{details:'private' as const,ratings:'private' as const}}}:{}}))]);
 await db.insert(s.media).values({id:movie,kind:'movie',title:'Merged Activity'});
 await db.insert(s.friendships).values(people.slice(0,-1).map(id=>({userA:[viewer,id].sort()[0],userB:[viewer,id].sort()[1],state:'accepted' as const,requestedBy:viewer})));
 await db.insert(s.trackingState).values(people.map((userId,index)=>({userId,mediaId:movie,favourite:true,watched:index!==67})));
 await db.insert(s.ratings).values({userId:people[0],mediaId:movie,value:4});
 // Deliberately leave current state with no history: it must still be represented.
 await raw`delete from social_activity where work_id=${movie}::uuid`;
 const real=crypto.randomUUID();await db.insert(s.socialActivity).values({id:real,userId:viewer,workId:movie,eventKind:'watch',section:'activity',source:'coast',sourceKey:`merged:${real}`,dateKnown:false,occurredAt:new Date('1960-01-01')});
 const first=await activityFeed(viewer,{workId:movie,relationship:'all'});
 expect(first.items).toHaveLength(60);expect(first.items[0].captionActivity?.id).toBe(real);expect(first.next?.beforeRelationship).toBe('true');
 const second=await activityFeed(viewer,{workId:movie,relationship:'all',...first.next!});
 const cards=[...first.items,...second.items];expect(cards).toHaveLength(66);expect(new Set(cards.map(item=>item.entryId)).size).toBe(66);expect(second.hasMore).toBe(false);
 const undated=cards.filter(item=>!item.captionActivity);expect(undated).toHaveLength(65);expect(undated.every(item=>item.captionSubtitle?.includes('Favourited'))).toBe(true);
 const privateActor=cards.find(item=>item.captionActor?.username.endsWith(people[0]));expect(privateActor?.captionActor?.avatar).toBeNull();expect(privateActor?.captionSubtitle).not.toContain('/ 5');
 for(const id of people.slice(65))expect(cards.some(item=>item.captionActor?.username.endsWith(id))).toBe(false);
 const favourites=await activityFeed(viewer,{workId:movie,relationship:'favourites'});expect(favourites.items).toHaveLength(60);expect(favourites.items.every(item=>!item.captionActivity)).toBe(true);
 const list=crypto.randomUUID();await db.insert(s.lists).values({id:list,userId:people[1],name:'Current list'});await db.insert(s.listItems).values({listId:list,mediaId:movie,position:0});
 const listed=await activityFeed(viewer,{workId:movie,relationship:'lists'});expect(listed.items).toHaveLength(1);expect(listed.items[0].captionSubtitle).toBe('In a list');expect(listed.items[0].captionActivity).toBeUndefined();
 await raw`update users set settings=${{social:{sections:{collection:'private'}}}}::jsonb where id=${people[1]}::uuid`;
 expect((await activityFeed(viewer,{workId:movie,relationship:'lists'})).items).toEqual([]);
 await expect(activityFeed(viewer,{relationship:'all'})).rejects.toThrow();
});
run('merged relationship segments cover reading, games, music and their verified containers',async()=>{
 const db=getDb(),raw=getSql(),config=await getConfig(),viewer=crypto.randomUUID(),peer=crypto.randomUUID(),book=crypto.randomUUID(),comic=crypto.randomUUID(),game=crypto.randomUUID(),album=crypto.randomUUID(),track=crypto.randomUUID(),artist=crypto.randomUUID(),group=crypto.randomUUID();
 await db.insert(s.systemSettings).values({key:'coast',value:{...config,experimentalBooks:true,experimentalComics:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalBooks:true,experimentalComics:true}}});
 try{
  await db.insert(s.users).values([{id:viewer,username:`relationship-viewer-${viewer}`},{id:peer,username:`relationship-peer-${peer}`}]);
  await db.insert(s.friendships).values({userA:[viewer,peer].sort()[0],userB:[viewer,peer].sort()[1],state:'accepted',requestedBy:viewer});
  await db.insert(s.works).values([{id:book,category:'book',kind:'book'},{id:comic,category:'comic',kind:'comic'},{id:album,category:'music',kind:'album'},{id:track,category:'music',kind:'track'}]);
  await db.insert(s.readingWorks).values([{id:book,kind:'book',provider:'openlibrary',externalId:book,title:'Saved book',sourceUrl:'https://openlibrary.org/'},{id:comic,kind:'comic',provider:'comic-vine',externalId:comic,title:'Read issue',sourceUrl:'https://comicvine.gamespot.com/'}]);
  await db.insert(s.readingProgress).values([{userId:peer,workId:book,state:'planned'},{userId:peer,workId:comic,state:'completed',page:24,totalPages:24,completedAt:new Date()}]);
  await db.insert(s.readingGroups).values({id:group,kind:'comic',provider:'comic-vine',externalId:'4050-9000002',title:'Read volume'});await db.insert(s.readingGroupMembers).values({groupId:group,workId:comic,position:'1'});
  await db.insert(s.games).values({id:game,title:'Playing game'});const [playthrough]=await db.insert(s.gamePlaythroughs).values({userId:peer,gameId:game,status:'in-progress'}).returning();
  await db.insert(s.gameSessions).values({id:crypto.randomUUID(),playthroughId:playthrough.id,minutesPlayed:12,playedAt:new Date()});
  await db.insert(s.musicWorks).values([{id:album,kind:'album',title:'Saved album'},{id:track,kind:'track',title:'Active track'}]);await db.insert(s.mediaRelationships).values({parentId:album,childId:track,kind:'contains',position:1});
  await db.insert(s.musicProgress).values({userId:peer,trackId:track,positionSeconds:40,durationSeconds:200,playCount:1});
  const [server]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:'Merged Activity artist',baseUrl:'https://fixture.invalid'}).returning();await db.insert(s.musicArtists).values({id:artist,instanceId:server.id,externalId:artist,name:'Merged artist'});await db.insert(s.musicCredits).values([{workId:album,artistId:artist,role:'album-artist'},{workId:track,artistId:artist,role:'artist'}]);
  await db.insert(s.trackingState).values([{userId:peer,mediaId:album,watchlist:true},{userId:peer,mediaId:episodes[0],watched:true}]);
  for(const scope of [{workId:book,relationship:'watchlist'},{workId:comic,relationship:'consumed'},{readingGroupId:group,relationship:'consumed'},{workId:game,relationship:'progress'},{workId:game,relationship:'consumed'},{workId:track,relationship:'progress'},{workId:album,relationship:'consumed'},{artistId:artist,relationship:'watchlist'},{workId:show,relationship:'consumed'},{workId:season,relationship:'consumed'}]){
   const result=await activityFeed(viewer,scope);expect(result.items.length).toBeGreaterThan(0);expect(result.items.every(item=>item.captionActor?.username===`relationship-peer-${peer}`)).toBe(true);
  }
  await raw`update users set settings=${{social:{sections:{progress:'private'}}}}::jsonb where id=${peer}::uuid`;
  expect((await activityFeed(viewer,{workId:comic,relationship:'consumed'})).items).toEqual([]);expect((await activityFeed(viewer,{workId:game,relationship:'progress'})).items).toEqual([]);
 }finally{await raw`update system_settings set value=${config}::jsonb where key='coast'`;}
});
