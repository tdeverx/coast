import {beforeAll,afterAll,expect,test} from 'bun:test';
import {eq} from 'drizzle-orm';
import {getDb,closeDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {getConfig} from '../src/lib/server/config';
import {discoveryContent} from '../src/lib/server/queries/discovery';
import {genericFeed,genericRecommendationRows} from '../src/lib/recommendations/generic.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const user=crypto.randomUUID(),other=crypto.randomUUID();
let album:string,track:string,inaccessible:string,future:string,instance:string,connection:string;
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getDb(),config=await getConfig();
 await db.insert(s.systemSettings).values({key:'coast',value:{...config,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}});
 await db.insert(s.users).values([{id:user,username:`discovery-${user}`,passwordHash:'fixture'},{id:other,username:`discovery-${other}`,passwordHash:'fixture',settings:{social:{audience:'private'}}}]);
 [instance]=(await db.insert(s.providerInstances).values({provider:'jellyfin',name:'Fixture',baseUrl:'https://fixture.invalid'}).returning()).map(r=>r.id);
 [connection]=(await db.insert(s.providerConnections).values({instanceId:instance,userId:user,status:'connected',externalUserId:'fixture',credentials:'fixture'}).returning()).map(r=>r.id);
 const ids=await db.insert(s.works).values([{category:'music',kind:'album'},{category:'music',kind:'track'},{category:'music',kind:'album'},{category:'music',kind:'album'}]).returning();[album,track,inaccessible,future]=ids.map(w=>w.id);
 await db.insert(s.musicWorks).values([{id:album,title:'Released album',kind:'album',releaseDate:'2020-01-01'},{id:track,title:'Contained track',kind:'track',releaseDate:'2020-01-01'},{id:inaccessible,title:'Unavailable album',kind:'album',releaseDate:'2025-01-01'},{id:future,title:'Future album',kind:'album',releaseDate:'2099-01-01'}]);
 await db.insert(s.mediaRelationships).values({parentId:album,childId:track,kind:'contains'});
 for(const id of [album,track,future]){const [item]=await db.insert(s.providerItems).values({instanceId:instance,mediaId:id,externalId:id,kind:id===track?'track':'album'}).returning();await db.insert(s.availability).values({userId:user,connectionId:connection,providerItemId:item.id,mediaId:id});}
 await db.insert(s.musicListens).values([{userId:other,trackId:track,batchId:crypto.randomUUID()},{userId:user,trackId:track,batchId:crypto.randomUUID(),occurredAtKnown:false}]);
});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1')await closeDb();});
run('Listen discovery excludes unavailable and future releases, and presents albums rather than their children',async()=>{
 const content=await discoveryContent(user,{surface:'listen',section:'recent'});
 expect(content.items.map(i=>'workId' in i?i.workId:i.id)).toEqual([album]);expect(content.items.every(i=>i.available)).toBe(true);
 expect((await discoveryContent(other,{surface:'listen',section:'recent'})).items).toEqual([]);
});
run('music popularity respects activity privacy and unknown import dates',async()=>{
 expect((await discoveryContent(user,{surface:'listen',section:'trending'})).items).toEqual([]);
 await getDb().insert(s.musicListens).values({userId:user,trackId:track,batchId:crypto.randomUUID()});
 expect((await discoveryContent(user,{surface:'listen',section:'trending'})).items.map(i=>'workId' in i?i.workId:i.id)).toEqual([album]);
});
run('generic recommendations follow catalogue order across viewers and keep the public projection safe',async()=>{
 const db=getDb();
 const [first,second,third,serverOnly,unreleased]=await db.insert(s.media).values([
  {kind:'movie',title:'First film',releaseDate:'2024-05-01',genres:['Science Fiction','Science Fiction']},
  {kind:'movie',title:'Second film',releaseDate:'2024-04-01',genres:['Science Fiction']},
  {kind:'movie',title:'Third film',releaseDate:'2024-03-01',genres:['Science Fiction']},
  {kind:'movie',title:'Server-only film',releaseDate:'2024-02-01',posterPath:'/private-artwork'},
  {kind:'movie',title:'Upcoming film',releaseDate:'2099-01-01',genres:['Upcoming']},
 ]).returning();
 await db.insert(s.externalIds).values([first,second,third,unreleased].map(({id,kind},index)=>({mediaId:id,mediaKind:kind,provider:'tmdb',externalId:String(index+1)})));
 await db.insert(s.trackingState).values({userId:user,mediaId:third.id,watched:true,favourite:true});
 await db.update(s.users).set({settings:{features:{personalisation:false}}}).where(eq(s.users.id,other));
 const url=new URL('http://fixture/?category=screen&kind=movie&seed=generic&genre=Science+Fiction');
 const ids=(data:Awaited<ReturnType<typeof genericRecommendationRows>>)=>data.items.map(i=>i.id);
 const owned=await genericRecommendationRows(user,'recommendations',url);
 expect(ids(owned)).toEqual([first,second,third,serverOnly].map(item=>item.id));
 expect(ids(await genericRecommendationRows(other,'recommendations',url))).toEqual(ids(owned));
 expect(ids(await genericRecommendationRows(null,'recommendations',url))).toEqual([first,second,third].map(item=>item.id));
 const definitions=await genericFeed(null,url);
 expect(definitions.rows).toHaveLength(2);
 expect(definitions.rows.some(row=>row.surface==='genre'&&row.genre==='Science Fiction')).toBe(true);
 const genre=await genericRecommendationRows(null,'row',url);
 expect(genre.title).toBe('Science fiction movies');
 expect(new Set(ids(genre))).toEqual(new Set([first,second,third].map(item=>item.id)));
 url.searchParams.set('page','99');
 expect(await genericRecommendationRows(null,'row',url)).toEqual(genre);
});
run('generic available shows include a show playable through one of its episodes',async()=>{
 const db=getDb();
 const [show,episode]=await db.insert(s.media).values([
  {kind:'show',title:'Generic available show'},
  {kind:'episode',title:'Playable episode'},
 ]).returning();
 await db.insert(s.shows).values({mediaId:show.id});
 await db.insert(s.episodes).values({mediaId:episode.id,showId:show.id,seasonNumber:1,episodeNumber:1});
 const [item]=await db.insert(s.providerItems).values({instanceId:instance,mediaId:episode.id,externalId:episode.id,kind:'episode'}).returning();
 await db.insert(s.availability).values({userId:user,connectionId:connection,providerItemId:item.id,mediaId:episode.id});
 const url=new URL('http://fixture/?category=screen&kind=show&available=true');
 expect((await genericRecommendationRows(user,'recommendations',url)).items.map(item=>item.id)).toEqual([show.id]);
 expect((await genericRecommendationRows(other,'recommendations',url)).items).toEqual([]);
});
run('generic album rows honor each viewer’s connected catalogue',async()=>{
 const url=new URL('http://fixture/?category=music&kind=album');
 expect((await genericFeed(user,url)).rows.map(row=>row.surface)).toEqual(['discovery','discovery','recommendations']);
 expect((await genericRecommendationRows(user,'recommendations',url)).items.map(i=>'workId' in i?i.workId:i.id)).toEqual([album]);
 expect(await genericFeed(other,url)).toEqual({rows:[]});
 await expect(genericFeed(null,url)).rejects.toThrow('unavailable');
});
run('disabled experimental discovery and invalid segments reject without provider requests',async()=>{
 const config=await getConfig();await getDb().update(s.systemSettings).set({value:{...config,experimentalMusic:false,experimentalGaming:false,experimentalParties:false}}).where(eq(s.systemSettings.key,'coast'));
 await expect(discoveryContent(user,{surface:'play',section:'trending'})).rejects.toThrow('disabled');
 await expect(discoveryContent(user,{surface:'listen',section:'recent'})).rejects.toThrow('disabled');
 await expect(discoveryContent(user,{surface:'invalid',section:'recent'})).rejects.toThrow();
});
