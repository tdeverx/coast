import {afterAll,beforeAll,expect,test} from 'bun:test';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import {getConfig} from '../src/lib/server/config';
import * as s from '../src/lib/server/db/schema';
import {observeMusicLibraryAccess,observeMusicPageAccess,persistMusic} from '../src/lib/music/persistence.server';
import type {MusicItem} from '../src/lib/music/model';
import {jellyfinItemKey} from '../src/lib/providers/jellyfin/paging';
import {musicQueue} from '../src/lib/music/queue.server';
import {logMusic} from '../src/lib/music/persistence.server';
import {musicWorkCredits} from '../src/lib/music/credits.server';
import {workAssessments} from '../src/lib/collection/query.server';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const tag=crypto.randomUUID(),workIds:string[]=[];
let userId:string,instanceId:string,connection:typeof s.providerConnections.$inferSelect;
const item=(id:string):MusicItem=>({id:jellyfinItemKey(id),kind:'track',title:'Rich metadata',artists:[],albumArtists:[],artistNames:[],genres:['Fixture'],externalIds:{musicbrainztrack:crypto.randomUUID()},overview:'Kept shared description',durationSeconds:60});
beforeAll(async()=>{
  if(!enabled)return;const db=getDb();
  const config=await getConfig();
  await getSql()`insert into system_settings(key,value) values('coast',${{...config,experimentalMusic:true}}::jsonb) on conflict(key) do update set value=excluded.value`;
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
  const rich=item(crypto.randomUUID()),gone=jellyfinItemKey(crypto.randomUUID()),scanId=crypto.randomUUID(),calls:string[][]=[];
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

run('GUID spellings preserve one work and reuse older stored provider spellings',async()=>{
  const db=getDb(),external=crypto.randomUUID(),rich={...item(external),externalIds:{}};
  const first=await persistMusic(instanceId,rich);workIds.push(first.workId!);
  await db.update(s.providerItems).set({externalId:external.toUpperCase()}).where(eq(s.providerItems.id,first.providerItemId!));
  await db.update(s.workEditions).set({externalId:external.toUpperCase()}).where(eq(s.workEditions.workId,first.workId!));
  const second=await persistMusic(instanceId,{...rich,id:external});
  expect(second.workId).toBe(first.workId);expect(second.providerItemId).toBe(first.providerItemId);
  expect(await db.select().from(s.workEditions).where(eq(s.workEditions.workId,first.workId!))).toHaveLength(1);
});

run('selected releases retain repeated recordings and exclude other-release bonus tracks from queues and logs',async()=>{
  const db=getDb(),releaseGroup=crypto.randomUUID(),albumExternal=jellyfinItemKey(crypto.randomUUID());
  const standard=await persistMusic(instanceId,{...item(albumExternal),kind:'album',externalIds:{musicbrainzreleasegroup:releaseGroup}});workIds.push(standard.workId!);
  const recording=crypto.randomUUID();
  const first=await persistMusic(instanceId,{...item(crypto.randomUUID()),albumId:albumExternal,discNumber:1,trackNumber:1,externalIds:{musicbrainztrack:recording}});workIds.push(first.workId!);
  const repeat=await persistMusic(instanceId,{...item(crypto.randomUUID()),albumId:albumExternal,discNumber:1,trackNumber:3,externalIds:{musicbrainztrack:recording}});
  expect(repeat.workId).toBe(first.workId);
  const deluxeExternal=jellyfinItemKey(crypto.randomUUID());
  const deluxe=await persistMusic(instanceId,{...item(deluxeExternal),kind:'album',externalIds:{musicbrainzreleasegroup:releaseGroup}});expect(deluxe.workId).toBe(standard.workId);
  const bonus=await persistMusic(instanceId,{...item(crypto.randomUUID()),albumId:deluxeExternal,trackNumber:2});workIds.push(bonus.workId!);
  expect((await musicQueue(userId,standard.workId!)).items.map(track=>track.id)).toEqual([first.workId!,first.workId!]);
  const relationships=await db.select().from(s.mediaRelationships).where(eq(s.mediaRelationships.parentId,standard.workId!));
  expect(relationships.map(relation=>relation.childId)).toEqual([first.workId!]);
  const batchId=crypto.randomUUID();expect((await logMusic(userId,standard.workId!,{batchId})).added).toBe(2);
  expect((await logMusic(userId,standard.workId!,{batchId})).added).toBe(0);
  const [progress]=await db.select().from(s.musicProgress).where(and(eq(s.musicProgress.userId,userId),eq(s.musicProgress.trackId,first.workId!)));
  expect(progress.playCount).toBe(2);
  expect(await db.select().from(s.musicListens).where(and(eq(s.musicListens.userId,userId),eq(s.musicListens.trackId,bonus.workId!)))).toHaveLength(0);
  const scanId=crypto.randomUUID();
  await observeMusicPageAccess(userId,connection.id,instanceId,connection.accountGeneration,[{...deluxe,expectedMembers:2},first,repeat],scanId);
  [connection]=await db.update(s.providerConnections).set({settings:{userSync:{phase:'complete',accountGeneration:connection.accountGeneration,scanId}}}).where(eq(s.providerConnections.id,connection.id)).returning();
  // A different release with the same count cannot establish selected membership.
  expect((await workAssessments(userId,userId,[standard.workId!]))[0].completed).toBe(false);
  await observeMusicPageAccess(userId,connection.id,instanceId,connection.accountGeneration,[{...standard,expectedMembers:2}],scanId);
  const [assessment]=await workAssessments(userId,userId,[standard.workId!]);
  expect(assessment.completed).toBe(true);expect(assessment.availability).toBe('available');
});

run('canonical credits retain roles and text while artist destinations use only the viewers active source',async()=>{
  const artist={id:jellyfinItemKey(crypto.randomUUID()),name:'Album artist'};
  const saved=await persistMusic(instanceId,{...item(crypto.randomUUID()),kind:'album',artists:[],albumArtists:[artist],artistNames:[]});workIds.push(saved.workId!);
  const [work]=await getDb().select().from(s.musicWorks).where(eq(s.musicWorks.id,saved.workId!));expect(work.artistNames).toEqual(['Album artist']);
  const own=(await musicWorkCredits([saved.workId!],userId)).get(saved.workId!)!;
  expect(own.albumArtists[0].href).toBe(`/music/${connection.id}/${artist.id}`);expect(own.artists).toEqual([]);
  const visitor=(await musicWorkCredits([saved.workId!],null)).get(saved.workId!)!;
  expect(visitor.albumArtists[0].name).toBe('Album artist');expect(visitor.albumArtists[0].href).toBeUndefined();
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

run('unchanged album refresh leaves membership tuples untouched and changed positions update only their member',async()=>{
  const db=getDb(),external=jellyfinItemKey(crypto.randomUUID());
  const album=await persistMusic(instanceId,{...item(external),kind:'album',externalIds:{}});workIds.push(album.workId!);
  const tracks=Array.from({length:20},(_,index)=>({...item(crypto.randomUUID()),albumId:external,discNumber:1,trackNumber:index+1}));
  for(const track of tracks){const saved=await persistMusic(instanceId,track);workIds.push(saved.workId!);}
  const membership=()=>db.execute<{childId:string;position:number;version:string}>(sql`select child_id as "childId",position,xmin::text as version from media_relationships where parent_id=${album.workId!}::uuid and kind='contains' order by child_id`);
  const before=Array.from(await membership());expect(before).toHaveLength(20);
  for(const track of tracks)await persistMusic(instanceId,track);
  expect(Array.from(await membership())).toEqual(before);
  const firstId=workIds[workIds.length-20];
  await persistMusic(instanceId,{...tracks[0],trackNumber:21});
  const moved=Array.from(await membership());
  expect(moved.filter(member=>member.childId!==firstId)).toEqual(before.filter(member=>member.childId!==firstId));
  expect(moved.find(member=>member.childId===firstId)?.position).toBe(10021);
  expect(moved.find(member=>member.childId===firstId)?.version).not.toBe(before.find(member=>member.childId===firstId)?.version);
  const otherExternal=jellyfinItemKey(crypto.randomUUID());
  const other=await persistMusic(instanceId,{...item(otherExternal),kind:'album',externalIds:{}});workIds.push(other.workId!);
  await persistMusic(instanceId,{...tracks[0],albumId:otherExternal});
  expect((await membership()).map(member=>member.childId)).not.toContain(firstId);
  expect((await db.select().from(s.mediaRelationships).where(eq(s.mediaRelationships.parentId,other.workId!))).map(member=>member.childId)).toEqual([firstId]);
});


run('unchanged rich music pages preserve metadata tuples while refreshing access and changed artwork',async()=>{
 const db=getDb(),external=jellyfinItemKey(crypto.randomUUID()),artist={id:jellyfinItemKey(crypto.randomUUID()),name:'Same rich-page artist'};
 const album=await persistMusic(instanceId,{...item(external),kind:'album',externalIds:{}});workIds.push(album.workId!);
 const tracks=Array.from({length:20},(_,index)=>({...item(crypto.randomUUID()),albumId:external,discNumber:1,trackNumber:index+1,artists:[artist],albumArtists:[artist],primaryImageTag:'original'}));
 const first=await observeMusicLibraryAccess(userId,connection.id,instanceId,connection.accountGeneration,tracks);workIds.push(...first.map(track=>track.workId!));
 const ids=first.map(track=>track.workId!);
 const metadata=async()=>({
  works:Array.from(await db.execute(sql`select id,xmin::text as version from music_works where id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}) order by id`)),
  editions:Array.from(await db.execute(sql`select id,xmin::text as version from work_editions where work_id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}) order by id`)),
  artists:Array.from(await db.execute(sql`select id,xmin::text as version from music_artists where instance_id=${instanceId} and external_id=${artist.id} order by id`)),
  members:Array.from(await db.execute(sql`select child_id,xmin::text as version from media_relationships where parent_id=${album.workId!}::uuid order by child_id`)),
 });
 const before=await metadata(),old=new Date('2000-01-01T00:00:00Z');
 await db.update(s.availability).set({verifiedAt:old}).where(and(eq(s.availability.connectionId,connection.id),inArray(s.availability.mediaId,ids)));
 const second=await observeMusicLibraryAccess(userId,connection.id,instanceId,connection.accountGeneration,tracks);
 expect(second.map(track=>track.workId)).toEqual(first.map(track=>track.workId));expect(await metadata()).toEqual(before);
 const grants=await db.select().from(s.availability).where(and(eq(s.availability.connectionId,connection.id),inArray(s.availability.mediaId,ids)));
 expect(grants).toHaveLength(20);expect(grants.every(grant=>grant.verifiedAt!>old)).toBe(true);
 const changed=await observeMusicLibraryAccess(userId,connection.id,instanceId,connection.accountGeneration,[{...tracks[0],title:'Changed rich title',primaryImageTag:'replacement'}]);
 expect((await db.select().from(s.musicWorks).where(eq(s.musicWorks.id,changed[0].workId!)))[0].title).toBe('Changed rich title');
 expect((await db.select().from(s.providerItems).where(eq(s.providerItems.id,changed[0].providerItemId!)))[0].snapshot.primaryImageTag).toBe('replacement');
 expect((await metadata()).members).toEqual(before.members);
});

run('rich music page access cannot publish for an obsolete generation or cancelled execution',async()=>{
 const track={...item(crypto.randomUUID()),externalIds:{}},saved=await persistMusic(instanceId,track);workIds.push(saved.workId!);
 await expect(observeMusicLibraryAccess(userId,connection.id,instanceId,crypto.randomUUID(),[track])).rejects.toThrow('connected account changed');
 expect(await getDb().select().from(s.availability).where(and(eq(s.availability.connectionId,connection.id),eq(s.availability.mediaId,saved.workId!)))).toHaveLength(0);
 const [action]=await getDb().insert(s.outboxActions).values({userId,connectionId:connection.id,kind:'jellyfin.sync',payload:{},state:'cancelled',attempts:1}).returning();
 const {jobExecution,JobYield}=await import('../src/lib/server/queue/execution');
 await expect(jobExecution.run({id:action.id,attempts:1,purpose:'scheduled',started:performance.now(),checkpoints:0},()=>observeMusicLibraryAccess(userId,connection.id,instanceId,connection.accountGeneration,[track]))).rejects.toBeInstanceOf(JobYield);
 expect(await getDb().select().from(s.availability).where(and(eq(s.availability.connectionId,connection.id),eq(s.availability.mediaId,saved.workId!)))).toHaveLength(0);
});
