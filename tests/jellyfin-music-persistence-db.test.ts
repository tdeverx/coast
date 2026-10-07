import {afterAll,beforeAll,expect,test} from 'bun:test';
import {and,eq,inArray} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {observeMusicPageAccess,persistMusic} from '../src/lib/music/persistence.server';
import type {MusicItem} from '../src/lib/music/model';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const tag=crypto.randomUUID(),workIds:string[]=[];
let userId:string,instanceId:string,connection:typeof s.providerConnections.$inferSelect;
const item=(id:string):MusicItem=>({id,kind:'track',title:'Rich metadata',artists:[],albumArtists:[],artistNames:[],genres:['Fixture'],externalIds:{musicbrainztrack:crypto.randomUUID()},overview:'Kept shared description',durationSeconds:60});
beforeAll(async()=>{
  if(!enabled)return;const db=getDb();
  const [user]=await db.insert(s.users).values({username:`music-persistence-${tag}`}).returning();userId=user.id;
  const [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid'}).returning();instanceId=instance.id;
  [connection]=await db.insert(s.providerConnections).values({userId,instanceId,externalUserId:tag}).returning();
});
afterAll(async()=>{
  if(!enabled||!userId)return;const db=getDb();
  await db.delete(s.users).where(eq(s.users.id,userId));await db.delete(s.providerInstances).where(eq(s.providerInstances.id,instanceId));
  if(workIds.length)await db.delete(s.works).where(inArray(s.works.id,workIds));
});

run('shared music snapshots omit account observations and replace obsolete personal fields',async()=>{
  const rich={...item(crypto.randomUUID()),favourite:true,playCount:9,positionSeconds:12,expectedMembers:7,workId:crypto.randomUUID(),artworkUrl:'/account/artwork'};
  const saved=await persistMusic(instanceId,rich);workIds.push(saved.workId!);
  const db=getDb();await db.update(s.providerItems).set({snapshot:{favourite:true,playCount:99,positionSeconds:35}}).where(eq(s.providerItems.id,saved.providerItemId!));
  await persistMusic(instanceId,rich);
  const [row]=await db.select().from(s.providerItems).where(eq(s.providerItems.id,saved.providerItemId!));
  expect(row.snapshot.overview).toBe(rich.overview);expect(row.snapshot.externalIds).toEqual(rich.externalIds);
  for(const key of ['favourite','playCount','positionSeconds','expectedMembers','workId','artworkUrl'])expect(key in row.snapshot).toBe(false);
  expect(saved.favourite).toBe(true);
});

run('light access pages batch missing metadata and omit items removed during hydration',async()=>{
  const rich=item(crypto.randomUUID()),gone=crypto.randomUUID(),scanId=crypto.randomUUID(),calls:string[][]=[];
  const light={...rich,genres:[],externalIds:{},overview:undefined,favourite:true,playCount:3,positionSeconds:4,expectedMembers:7};
  const result=await observeMusicPageAccess(userId,connection.id,instanceId,connection.accountGeneration,
    [light,{...light,id:gone}],scanId,async ids=>{calls.push(ids);return [{...rich,favourite:false,playCount:0}];});
  expect(calls).toEqual([[rich.id,gone]]);expect(result).toHaveLength(1);expect(result[0]).toMatchObject({favourite:true,playCount:3,positionSeconds:4});
  workIds.push(result[0].workId!);
  const db=getDb();const [metadata]=await db.select().from(s.musicWorks).where(eq(s.musicWorks.id,result[0].workId!));
  expect(metadata.overview).toBe(rich.overview??null);expect(metadata.genres).toEqual(['Fixture']);
  const grants=await db.select().from(s.availability).where(and(eq(s.availability.connectionId,connection.id),eq(s.availability.scanId,scanId)));
  expect(grants).toHaveLength(1);expect(grants[0].source.coastMembershipCount).toBe(7);
  const second=await observeMusicPageAccess(userId,connection.id,instanceId,connection.accountGeneration,[light],crypto.randomUUID(),async()=>{throw new Error('Known mappings must not fetch rich metadata');});
  expect(second[0].workId).toBe(result[0].workId);
  expect((await db.select().from(s.musicWorks).where(eq(s.musicWorks.id,result[0].workId!)))[0].genres).toEqual(['Fixture']);
});

run('account generation changes during hydration never grant the old account access',async()=>{
  const rich=item(crypto.randomUUID()),scanId=crypto.randomUUID(),generation=connection.accountGeneration;
  await expect(observeMusicPageAccess(userId,connection.id,instanceId,generation,[rich],scanId,async()=>{
    [connection]=await getDb().update(s.providerConnections).set({accountGeneration:crypto.randomUUID()}).where(eq(s.providerConnections.id,connection.id)).returning();
    return [rich];
  })).rejects.toThrow('connected account changed');
  const [mapping]=await getDb().select().from(s.providerItems).where(and(eq(s.providerItems.instanceId,instanceId),eq(s.providerItems.externalId,rich.id)));
  if(mapping)workIds.push(mapping.mediaId);
  expect(await getDb().select().from(s.availability).where(eq(s.availability.scanId,scanId))).toHaveLength(0);
});
