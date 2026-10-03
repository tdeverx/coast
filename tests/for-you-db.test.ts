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
 await db.insert(s.systemSettings).values({key:'coast',value:{...config,experimentalFeatures:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalFeatures:true}}});
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
