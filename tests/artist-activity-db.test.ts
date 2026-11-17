import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq,inArray} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {getConfig} from '../src/lib/server/config';
import {persistMusic,logMusic} from '../src/lib/music/persistence.server';
import {musicDetailData} from '../src/lib/music/detail.server';
import {musicHero} from '../src/lib/music/presentation';
import {detailActivity} from '../src/lib/ui/pages/detail';
import {activityFeed} from '../src/lib/social/queries.server';
import {rate} from '../src/lib/core/ratings/service.server';
import {trackWithExports} from '../src/lib/sync/changes.server';
import type {MusicItem} from '../src/lib/music/model';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const [owner,viewer,stranger,first,second]=Array.from({length:5},()=>crypto.randomUUID());
let config:Awaited<ReturnType<typeof getConfig>>,artist:MusicItem,alias:MusicItem,track:MusicItem;
const workIds=new Set<string>();
const metadata=(kind:MusicItem['kind'],extra:Partial<MusicItem>={}):MusicItem=>({id:crypto.randomUUID(),kind,title:'Artist activity fixture',artists:[],albumArtists:[],artistNames:[],genres:[],externalIds:{},...extra});
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getDb();config=await getConfig();
 await db.insert(s.systemSettings).values({key:'coast',value:{...config,experimentalMusic:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalMusic:true}}});
 await db.insert(s.users).values([owner,viewer,stranger].map(id=>({id,username:'artist-activity-'+id})));
 await db.insert(s.friendships).values({userA:[owner,viewer].sort()[0],userB:[owner,viewer].sort()[1],requestedBy:owner,state:'accepted'});
 await db.insert(s.providerInstances).values([first,second].map(id=>({id,provider:'jellyfin' as const,name:'Artist activity fixture',baseUrl:'https://fixture.invalid'})));
 const mbid=crypto.randomUUID();
 artist=await persistMusic(first,metadata('artist',{externalIds:{musicbrainzartist:mbid}}));
 alias=await persistMusic(second,metadata('artist',{externalIds:{musicbrainzartist:mbid}}));
 workIds.add(artist.workId!);
 track=await persistMusic(first,metadata('track',{artists:[{id:artist.id,name:artist.title}]}));workIds.add(track.workId!);
 await rate(owner,{mediaId:artist.workId!,value:4});
 await trackWithExports(owner,{mediaId:artist.workId!,action:'favourite',value:true});
 await logMusic(owner,track.workId!,{batchId:crypto.randomUUID()});
});
afterAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getDb();await db.delete(s.users).where(inArray(s.users.id,[owner,viewer,stranger]));
 await db.delete(s.providerInstances).where(inArray(s.providerInstances.id,[first,second]));
 await db.delete(s.works).where(inArray(s.works.id,[...workIds]));
 await db.update(s.systemSettings).set({value:config}).where(eq(s.systemSettings.key,'coast'));
});
run('merged aliases and disconnected canonical artist details expose root and credited Activity with exact privacy',async()=>{
 expect(alias.workId).toBe(artist.workId);expect(alias.artistId).not.toBe(artist.workId);
 const merged=detailActivity(musicHero(alias,'source'))!;
 expect(merged).toEqual({artistId:artist.workId!,category:'music'});
 const disconnected=await musicDetailData(owner,artist.workId!);
 expect(disconnected.item.artistId).toBeUndefined();expect(disconnected.item.available).toBe(false);
 expect(detailActivity(musicHero(disconnected.item,''))).toEqual(merged);
 const options={...merged,relationship:'all'};
 const visible=await activityFeed(viewer,options);
 expect(new Set(visible.events.map(event=>event.workId))).toEqual(new Set([artist.workId!,track.workId!]));
 expect(visible.events.filter(event=>event.workId===artist.workId).map(event=>event.eventKind).sort()).toEqual(['favourite','rating']);
 expect(visible.events.filter(event=>event.workId===track.workId).map(event=>event.eventKind)).toEqual(['listen']);
 expect((await activityFeed(stranger,options)).items).toEqual([]);
 await getDb().update(s.users).set({settings:{social:{audience:'friends',sections:{activity:'private',ratings:'private',favourites:'private',collection:'private'}}}}).where(eq(s.users.id,owner));
 const journalHidden=await activityFeed(viewer,options);
 expect(journalHidden.events).toEqual([]);
 // Progress has independent visibility: its permitted undated relationship
 // survives hiding the dated activity journal, without exposing that journal.
 expect(journalHidden.items.map(item=>({kind:item.kind,workId:'workId' in item?item.workId:undefined})))
  .toEqual([{kind:'track',workId:track.workId!}]);
 expect(journalHidden.items[0]).not.toHaveProperty('captionActivity');
 await getDb().update(s.users).set({settings:{social:{audience:'friends',sections:{activity:'private',ratings:'private',favourites:'private',collection:'private',progress:'private'}}}}).where(eq(s.users.id,owner));
 expect((await activityFeed(viewer,options)).items).toEqual([]);
 expect(new Set((await activityFeed(owner,options)).events.map(event=>event.workId))).toEqual(new Set([artist.workId!,track.workId!]));
 await getDb().update(s.users).set({settings:{features:{music:false}}}).where(eq(s.users.id,viewer));
 expect((await activityFeed(viewer,options)).items).toEqual([]);
});
