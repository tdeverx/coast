import {expect,test} from 'bun:test';
import {eq,inArray} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import {media,metadataOverrides,metadataSnapshots,trackingEvents,users} from '../src/lib/server/db/schema';
import {profileActivity,profileData} from '../src/lib/server/queries/profile';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;

run('profile genres preserve explicit empty overrides, media precedence and fresh nonempty snapshot fallback',async()=>{
 if(process.env.COAST_AUDIT_REAL_DATA_CLONE==='1')throw Error('Authored correctness setup must not run on the actual-data clone.');
 const db=getDb(),now=new Date('2026-09-28T12:00:00Z');let owner:string|undefined;const ids:string[]=[];
 try{
  const [user]=await db.insert(users).values({username:`profile-genres-${crypto.randomUUID()}`,passwordHash:'fixture'}).returning();owner=user.id;
  const items=await db.insert(media).values([
   {kind:'movie' as const,title:'Media precedence',genres:['Media']},
   {kind:'movie' as const,title:'Empty override',genres:['HiddenByEmptyOverride']},
   {kind:'movie' as const,title:'Snapshot fallback',genres:[]},
   {kind:'movie' as const,title:'Explicit override',genres:['IgnoredByOverride']},
   {kind:'movie' as const,title:'Missing fallback',genres:[]},
   {kind:'movie' as const,title:'Null override',genres:['MediaNullOverride']},
  ]).returning();ids.push(...items.map(item=>item.id));
  await db.insert(trackingEvents).values(ids.map(mediaId=>({userId:user.id,mediaId,action:'watch' as const,occurredAt:new Date('2026-09-27T12:00:00Z')})));
  await db.insert(metadataOverrides).values([{mediaId:ids[1],genres:[]},{mediaId:ids[3],genres:['Override']},{mediaId:ids[5],genres:null}]);
  const snapshots=await db.insert(metadataSnapshots).values([
   {mediaId:ids[0],provider:'fixture',genres:['IgnoredSnapshotA']},
   {mediaId:ids[1],provider:'fixture',genres:['IgnoredSnapshotB']},
   {mediaId:ids[2],provider:'fixture-old',genres:['OldSnapshot'],updatedAt:new Date('2026-09-25T12:00:00Z')},
   {mediaId:ids[2],provider:'fixture-current',genres:['SnapshotCurrent'],updatedAt:new Date('2026-09-26T12:00:00Z')},
   {mediaId:ids[2],provider:'fixture-empty',genres:[],updatedAt:new Date('2026-09-27T12:00:00Z')},
   {mediaId:ids[3],provider:'fixture',genres:['IgnoredSnapshotD']},
  ]).returning();
  expect((await profileActivity(user.id,now)).genres).toEqual([
   {name:'Media',count:1,filter:'Media'},
   {name:'MediaNullOverride',count:1,filter:'MediaNullOverride'},
   {name:'Override',count:1,filter:'Override'},
   {name:'SnapshotCurrent',count:1,filter:'SnapshotCurrent'},
  ]);
  expect((await profileData(user.id,{view:'history',genre:'SnapshotCurrent'},now)).history.map(item=>item.id)).toEqual([ids[2]]);
  expect((await profileData(user.id,{view:'history',genre:'HiddenByEmptyOverride'},now)).history).toEqual([]);
  await db.update(metadataSnapshots).set({genres:['RefreshedSnapshot'],updatedAt:new Date('2026-09-27T15:00:00Z')}).where(eq(metadataSnapshots.id,snapshots[3].id));
  expect((await profileActivity(user.id,now)).genres.some(genre=>genre.name==='RefreshedSnapshot')).toBe(true);
  expect((await profileData(user.id,{view:'history',genre:'RefreshedSnapshot'},now)).history.map(item=>item.id)).toEqual([ids[2]]);
  await db.update(media).set({genres:['NewMedia']}).where(eq(media.id,ids[2]));
  expect((await profileActivity(user.id,now)).genres.some(genre=>genre.name==='RefreshedSnapshot')).toBe(false);
  expect((await profileData(user.id,{view:'history',genre:'NewMedia'},now)).history.map(item=>item.id)).toEqual([ids[2]]);
 }finally{
  if(owner)await db.delete(users).where(eq(users.id,owner));
  if(ids.length)await db.delete(media).where(inArray(media.id,ids));
 }
});
