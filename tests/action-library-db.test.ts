import {afterAll,beforeAll,describe,expect,test} from 'bun:test';
import {eq,inArray} from 'drizzle-orm';
import {getDb,closeDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {getConfig} from '../src/lib/server/config';
import {libraryContent} from '../src/lib/server/queries/library-content';

const target=process.env.TEST_DATABASE_URL;
describe.skipIf(!target)('action Library container counts and pagination',()=>{
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),track=crypto.randomUUID(),issue=crypto.randomUUID();
 const lists=Array.from({length:75},(_,index)=>({id:crypto.randomUUID(),userId:owner,name:`Playlist ${String(index).padStart(3,'0')}`,playlist:true}));
 const groups=Array.from({length:75},(_,index)=>({id:crypto.randomUUID(),provider:'comic-vine' as const,kind:'comic' as const,externalId:`4050-${900000000+index}`,title:`Series ${String(index).padStart(3,'0')}`}));
 beforeAll(async()=>{
  await getDb().insert(s.users).values([{id:owner,username:`action-${owner}`},{id:other,username:`action-${other}`}]);
  const config={...await getConfig(),experimentalMusic:true,experimentalComics:true};
  await getDb().insert(s.systemSettings).values({key:'coast',value:config}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:config}});
  await getDb().insert(s.works).values([{id:track,kind:'track',category:'music'},{id:issue,kind:'comic',category:'comic'}]);
  await getDb().insert(s.musicWorks).values({id:track,title:'Track',kind:'track'});
  await getDb().insert(s.readingWorks).values({id:issue,title:'Issue',kind:'comic',provider:'comic-vine',externalId:'4000-999000001',sourceUrl:'https://comicvine.gamespot.com/issue/4000-999000001/'});
  await getDb().insert(s.lists).values([...lists,{id:crypto.randomUUID(),userId:other,name:'Private playlist',playlist:true}]);
  await getDb().insert(s.listItems).values(lists.map(list=>({listId:list.id,mediaId:track,position:1})));
  await getDb().insert(s.readingGroups).values(groups);
  await getDb().insert(s.readingGroupMembers).values(groups.map(group=>({groupId:group.id,workId:issue,position:'1'})));
 });
 afterAll(async()=>{
  await getDb().delete(s.readingGroups).where(inArray(s.readingGroups.id,groups.map(group=>group.id)));
  await getDb().delete(s.users).where(inArray(s.users.id,[owner,other]));
  await getDb().delete(s.works).where(inArray(s.works.id,[track,issue]));
  await closeDb();
 });
 const read=(parameters:string,user=owner)=>libraryContent(user,new URL(`http://fixture/library?${parameters}`));
 test('playlist pages count containers, retain exact ordering and exclude another account',async()=>{
  const first=await read('surface=listen&selection=playlist&sort=title&scope=all');
  expect(first.total).toBe(75);expect(first.items).toHaveLength(60);expect(first.pages).toBe(2);
  expect(first.items[0].title).toBe('Playlist 000');expect(first.items[59].title).toBe('Playlist 059');
  const range=await read('surface=listen&selection=playlist&sort=title&scope=all&page=2&firstPage=1');
  expect(range.items).toHaveLength(75);expect(range.range?.counts).toEqual([60,15]);
  expect(range.items.every(item=>'href' in item&&item.href.startsWith('/lists?view='))).toBe(true);
  expect((await read('surface=listen&selection=playlist&scope=all',other)).items.map(item=>item.title)).toEqual(['Private playlist']);
  expect((await read('surface=listen&selection=playlist&scope=available')).total).toBe(0);
 });
 test('series counts verified groups, not issues, and applies personal membership before counting',async()=>{
  const second=await read('surface=read&kind=series&sort=title&scope=all&page=2');
  expect(second.total).toBe(75);expect(second.items).toHaveLength(15);expect(second.items[0].title).toBe('Series 060');
  expect((await read('surface=read&kind=series&collection=true&scope=all')).total).toBe(0);
  await getDb().insert(s.trackingState).values({userId:owner,mediaId:issue,watchlist:true});
  expect((await read('surface=read&kind=series&collection=true&scope=all')).total).toBe(75);
  expect((await read('surface=read&kind=series&scope=available')).total).toBe(0);
  await getDb().delete(s.trackingState).where(eq(s.trackingState.userId,owner));
 });
});
