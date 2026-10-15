import {afterAll,beforeAll,expect,test} from 'bun:test';
import {and,asc,eq,inArray} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {ingestMetadata} from '../src/lib/catalogue/service.server';
import {TraktAdapter} from '../src/lib/providers/trakt/adapter.server';
import {exportTraktListToAdapter} from '../src/lib/sync/trakt-lists.server';
import {acknowledgeProviderList,reconcileProviderList} from '../src/lib/sync/list-values.server';
import {resolveConflict} from '../src/lib/sync/conflicts.server';
import {addListItem,createList,moveListItem,removeListItem,reorderList,updateList} from '../src/lib/core/lists/service.server';
import type {SyncPreferences} from '../src/lib/providers/contracts';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip,tag=crypto.randomUUID();
const sync:SyncPreferences={history:false,progress:false,collection:false,ratings:false,watchlist:false,lists:true,scrobble:false};
let userId:string,connection:typeof s.providerConnections.$inferSelect;
const instances:string[]=[],works:string[]=[],unsupported:string[]=[];
let first:string,second:string;
const movie=(id:number)=>({title:`List delivery ${id}`,ids:{trakt:id}});
const external=[1991000001,1991000002];

beforeAll(async()=>{
  if(!enabled)return;
  const db=getDb();
  [userId]=(await db.insert(s.users).values({username:`list-delivery-${tag}`}).returning()).map(row=>row.id);
  for(let n=0;n<2;n++){
    const [instance]=await db.insert(s.providerInstances).values({provider:'trakt',name:tag,baseUrl:'https://fixture.invalid'}).returning();
    instances.push(instance.id);
    const [account]=await db.insert(s.providerConnections).values({userId,instanceId:instance.id,externalUserId:`account-${n}`,settings:{sync}}).returning();
    if(!n)connection=account;
  }
  for(const id of external)works.push((await ingestMetadata({provider:'trakt',externalId:String(id),kind:'movie',title:`List delivery ${id}`})).id);
  [first,second]=works;
  for(const category of ['game','music','book','comic'] as const){
    const [work]=await db.insert(s.works).values({category,kind:category==='music'?'track':category}).returning();
    works.push(work.id);unsupported.push(work.id);
  }
  const collection=(await ingestMetadata({provider:'tmdb',externalId:'1991000003',kind:'collection',title:'Unsupported collection'})).id;
  works.push(collection);unsupported.push(collection);
});
afterAll(async()=>{
  if(!enabled)return;
  await getDb().delete(s.users).where(eq(s.users.id,userId));
  await getDb().delete(s.providerInstances).where(inArray(s.providerInstances.id,instances));
  await getDb().delete(s.works).where(inArray(s.works.id,works));
});
const members=(listId:string)=>getDb().select().from(s.listItems).where(eq(s.listItems.listId,listId)).orderBy(asc(s.listItems.position));

run('export acknowledges the sent snapshot when another local edit commits during delivery',async()=>{
  const db=getDb(),list=await createList(userId,{name:'Concurrent list',mediaId:first});
  await db.update(s.lists).set({source:'trakt',sourceConnectionId:connection.id,externalId:'123'}).where(eq(s.lists.id,list.id));
  let entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const adapter=new TraktAdapter(async(path,init)=>{
    if(init?.method==='PUT')return{};
    if(init?.method==='POST'){
      if(path.endsWith('/items')){entered();await gate;}
      return{};
    }
    return[{id:1,movie:movie(external[0])}];
  },'fixture','fixture');
  const sending=exportTraktListToAdapter(userId,connection.id,{listId:list.id},{adapter,sync,connection});
  await ready;
  try{await addListItem(userId,list.id,second);}finally{release();}
  const sent=await sending;
  expect(sent?.items).toEqual([first]);
  await acknowledgeProviderList(connection.id,list.id,sent!,connection.accountGeneration);
  const [baseline]=await db.select().from(s.syncListValues).where(eq(s.syncListValues.listId,list.id));
  expect(baseline.agreed?.items).toEqual([first]);
  expect(await reconcileProviderList(userId,connection.id,list.id,sent!)).toBe('local');
  expect((await members(list.id)).map(row=>row.mediaId)).toEqual([first,second]);
  expect(await db.select().from(s.outboxActions).where(and(eq(s.outboxActions.compactionKey,`trakt-list:${list.id}`),eq(s.outboxActions.state,'pending')))).toHaveLength(2);
});

run('screen-only round trips, remote edits and accepted deletion retain unsupported local works',async()=>{
  const db=getDb(),list=await createList(userId,{name:'Mixed list',mediaId:first});
  for(const id of unsupported)await addListItem(userId,list.id,id);
  const full={name:list.name,description:'',items:[first,...unsupported]};
  await acknowledgeProviderList(connection.id,list.id,full,connection.accountGeneration);
  let [baseline]=await db.select().from(s.syncListValues).where(eq(s.syncListValues.listId,list.id));
  expect(baseline.agreed?.items).toEqual([first]);
  expect(await reconcileProviderList(userId,connection.id,list.id,{...full,items:[first]})).toBe('agree');
  expect(await reconcileProviderList(userId,connection.id,list.id,{...full,items:[second]})).toBe('remote');
  expect((await members(list.id)).map(row=>row.mediaId)).toEqual([second,...unsupported]);
  const deleted={...full,items:[],deleted:true};
  expect(await reconcileProviderList(userId,connection.id,list.id,deleted)).toBe('conflict');
  [baseline]=await db.select().from(s.syncListValues).where(eq(s.syncListValues.listId,list.id));
  await resolveConflict(userId,baseline.id,'accepted');
  expect((await members(list.id)).map(row=>row.mediaId)).toEqual(unsupported);
  expect(await reconcileProviderList(userId,connection.id,list.id,deleted)).toBe('agree');
  expect(await db.select().from(s.lists).where(eq(s.lists.id,list.id))).toHaveLength(1);
});

run('every browser list mutation rolls back if one destination cannot retain its export intent',async()=>{
  const db=getDb(),list=await createList(userId,{name:'Atomic list',mediaId:first});
  await addListItem(userId,list.id,second);
  const [a,b]=await members(list.id);
  const snapshot=async()=>JSON.stringify({list:await db.select().from(s.lists).where(eq(s.lists.id,list.id)),
    members:await members(list.id),jobs:await db.select({id:s.outboxActions.id}).from(s.outboxActions)
      .where(eq(s.outboxActions.userId,userId)).orderBy(asc(s.outboxActions.id)),
    lists:await db.select({id:s.lists.id}).from(s.lists).where(eq(s.lists.userId,userId)).orderBy(asc(s.lists.id))});
  const [other]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.instanceId,instances[1]));
  await getSql().unsafe(`CREATE FUNCTION list_delivery_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='trakt.list-export' AND NEW.connection_id='${other.id}'::uuid THEN RAISE EXCEPTION 'synthetic list delivery failure'; END IF; RETURN NEW; END $$`);
  await getSql().unsafe('CREATE TRIGGER list_delivery_outbox_failure BEFORE INSERT ON outbox_actions FOR EACH ROW EXECUTE FUNCTION list_delivery_outbox_failure()');
  try{
    const before=await snapshot();
    for(const mutate of [
      ()=>createList(userId,{name:'Must roll back',mediaId:first}),
      ()=>updateList(userId,list.id,{name:'Must roll back'}),
      ()=>addListItem(userId,list.id,unsupported[0]),
      ()=>removeListItem(userId,list.id,a.id),
      ()=>reorderList(userId,list.id,[b.id,a.id]),
      ()=>moveListItem(userId,list.id,{entryId:a.id,direction:1}),
    ]){
      await expect(mutate()).rejects.toThrow();
      expect(await snapshot()).toBe(before);
    }
  }finally{
    await getSql().unsafe('DROP TRIGGER list_delivery_outbox_failure ON outbox_actions');
    await getSql().unsafe('DROP FUNCTION list_delivery_outbox_failure()');
  }
});

run('playlist creation applies the same reading restriction as adding a member later',async()=>{
  const db=getDb(),before=await db.select().from(s.lists).where(eq(s.lists.userId,userId));
  for(const id of unsupported.slice(2,4))await expect(createList(userId,{name:'Reading playlist',playlist:true,mediaId:id})).rejects.toThrow('Reading works');
  expect(await db.select().from(s.lists).where(eq(s.lists.userId,userId))).toHaveLength(before.length);
  expect((await createList(userId,{name:'Screen playlist',playlist:true,mediaId:first})).playlist).toBe(true);
  expect((await createList(userId,{name:'Reading list',mediaId:unsupported[2]})).playlist).toBe(false);
});
