import {beforeAll,afterAll,expect,test} from 'bun:test';
import {eq} from 'drizzle-orm';
import {getDb,closeDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {getConfig} from '../src/lib/server/config';
import {discoveryContent} from '../src/lib/server/queries/discovery';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const user=crypto.randomUUID(),other=crypto.randomUUID();
let album:string,track:string,inaccessible:string,future:string,instance:string,connection:string;
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getDb(),config=await getConfig();
 await db.insert(s.systemSettings).values({key:'coast',value:{...config,experimentalFeatures:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalFeatures:true}}});
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
run('disabled experimental discovery and invalid segments reject without provider requests',async()=>{
 const config=await getConfig();await getDb().update(s.systemSettings).set({value:{...config,experimentalFeatures:false}}).where(eq(s.systemSettings.key,'coast'));
 await expect(discoveryContent(user,{surface:'play',section:'trending'})).rejects.toThrow('disabled');
 await expect(discoveryContent(user,{surface:'listen',section:'recent'})).rejects.toThrow('disabled');
 await expect(discoveryContent(user,{surface:'invalid',section:'recent'})).rejects.toThrow();
});
