import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {ingestMetadata} from '../src/lib/catalogue/service.server';
import {SeerrAdapter,SeerrPermission} from '../src/lib/providers/seerr/adapter.server';
import {type getSeerr,type SeerrAccountScope} from '../src/lib/providers/seerr/connection.server';
import {executeSeerrManagement,executeSeerrRequest} from '../src/lib/providers/seerr/requests.server';
import {jobExecution} from '../src/lib/server/queue/execution';
import {PermanentActionError,type OutboxAction} from '../src/lib/server/queue';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
let scope:SeerrAccountScope,instance:typeof s.providerInstances.$inferSelect,connection:typeof s.providerConnections.$inferSelect,mediaId:string;
const account={id:42,permissions:SeerrPermission.REQUEST|SeerrPermission.MANAGE_REQUESTS};
beforeAll(async()=>{
  if(!enabled)return;
  const db=getDb(),tag=crypto.randomUUID();
  const [user]=await db.insert(s.users).values({username:`seerr-delivery-${tag}`}).returning();
  const [linkedInstance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid'}).returning();
  [instance]=await db.insert(s.providerInstances).values({provider:'seerr',name:tag,baseUrl:'https://fixture.invalid',linkedMediaInstanceId:linkedInstance.id}).returning();
  const [linked]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:linkedInstance.id,externalUserId:tag}).returning();
  [connection]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:instance.id,externalUserId:'42'}).returning();
  scope={userId:user.id,instanceId:instance.id,connectionId:connection.id,accountGeneration:connection.accountGeneration,externalUserId:'42',
    linkedInstanceId:linkedInstance.id,linkedConnectionId:linked.id,linkedGeneration:linked.accountGeneration,linkedExternalUserId:tag};
  mediaId=(await ingestMetadata({provider:'tmdb',externalId:'1992000001',kind:'movie',title:'Seerr delivery fixture'})).id;
});
afterAll(async()=>{
  if(!enabled)return;
  const db=getDb();await db.delete(s.users).where(eq(s.users.id,scope.userId));
  await db.delete(s.providerInstances).where(eq(s.providerInstances.id,scope.instanceId));
  await db.delete(s.providerInstances).where(eq(s.providerInstances.id,scope.linkedInstanceId));
  await db.delete(s.works).where(eq(s.works.id,mediaId));
});

async function fixture(kind:'seerr.request'|'seerr.manage',conflict=false){
  const db=getDb();
  const [request]=await db.insert(s.mediaRequests).values({userId:scope.userId,instanceId:scope.instanceId,mediaId,
    externalId:kind==='seerr.manage'?'123':null,state:'pending'}).returning();
  const payload=kind==='seerr.request'?{requestId:request.id}:{requestId:request.id,action:'approve',resolved:!conflict,expectedState:'pending'};
  const [row]=await db.insert(s.outboxActions).values({userId:scope.userId,connectionId:scope.connectionId,
    kind,payload,state:'running',attempts:1}).returning();
  const action:OutboxAction={...row,accountGeneration:row.accountGeneration,correlationId:row.correlationId};
  let entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const adapter=new SeerrAdapter(async(path,init)=>{
    if(path.endsWith('/auth/me'))return account;
    if(path.includes('/movie/'))return{id:1992000001,seasons:[]};
    if(conflict&&path.endsWith('/request/123')&&init?.method!=='POST'){
      entered();await gate;return{id:123,status:3,requestedBy:{id:42}};
    }
    if(path.endsWith('/request/123'))return{id:123,status:1,requestedBy:{id:42}};
    if(init?.method==='POST'){entered();await gate;return{id:123,status:2};}
    throw new Error(`Unexpected fixture endpoint ${path}`);
  },'fixture',42);
  const resolve:typeof getSeerr=async(userId,instanceId,expected)=>{
    expect({userId,instanceId,expected}).toEqual({userId:scope.userId,instanceId:scope.instanceId,
      expected:{connectionId:scope.connectionId,accountGeneration:scope.accountGeneration}});
    return{adapter,scope,instance,connection,account,linkedJellyfinUserId:scope.linkedExternalUserId};
  };
  const execute=(resolver=resolve)=>jobExecution.run({id:action.id,attempts:1,purpose:'interactive',started:performance.now(),checkpoints:0},
    ()=>kind==='seerr.request'?executeSeerrRequest(action,resolver):executeSeerrManagement(action,resolver));
  return{request,action,execute,ready,release:()=>release()};
}

run('request and management resolve only the queued identity and reject remapping before mutation',async()=>{
  for(const kind of ['seerr.request','seerr.manage'] as const){
    const f=await fixture(kind);
    const resolver:typeof getSeerr=async(_user,_instance,expected)=>{
      expect(expected).toEqual({connectionId:scope.connectionId,accountGeneration:scope.accountGeneration});
      throw new PermanentActionError('The connected request account changed.');
    };
    await expect(f.execute(resolver)).rejects.toThrow('account changed');
    const [saved]=await getDb().select().from(s.mediaRequests).where(eq(s.mediaRequests.id,f.request.id));
    expect(saved.state).toBe('pending');
  }
});

run('delivery and conflict publication reject revoked accounts, services, users and worker leases after upstream waits',async()=>{
  const db=getDb();
  const cases=[
    {change:()=>db.update(s.providerConnections).set({status:'disconnected'}).where(eq(s.providerConnections.id,scope.connectionId)),restore:()=>db.update(s.providerConnections).set({status:'connected'}).where(eq(s.providerConnections.id,scope.connectionId))},
    {change:()=>db.update(s.providerConnections).set({accountGeneration:crypto.randomUUID()}).where(eq(s.providerConnections.id,scope.linkedConnectionId)),restore:()=>db.update(s.providerConnections).set({accountGeneration:scope.linkedGeneration}).where(eq(s.providerConnections.id,scope.linkedConnectionId))},
    {change:()=>db.update(s.providerInstances).set({enabled:false}).where(eq(s.providerInstances.id,scope.linkedInstanceId)),restore:()=>db.update(s.providerInstances).set({enabled:true}).where(eq(s.providerInstances.id,scope.linkedInstanceId))},
    {change:()=>db.update(s.providerConnections).set({status:'disconnected'}).where(eq(s.providerConnections.id,scope.linkedConnectionId)),restore:()=>db.update(s.providerConnections).set({status:'connected'}).where(eq(s.providerConnections.id,scope.linkedConnectionId))},
    {change:()=>db.update(s.providerConnections).set({accountGeneration:crypto.randomUUID()}).where(eq(s.providerConnections.id,scope.connectionId)),restore:()=>db.update(s.providerConnections).set({accountGeneration:scope.accountGeneration}).where(eq(s.providerConnections.id,scope.connectionId))},
    {change:()=>db.update(s.providerInstances).set({enabled:false}).where(eq(s.providerInstances.id,scope.instanceId)),restore:()=>db.update(s.providerInstances).set({enabled:true}).where(eq(s.providerInstances.id,scope.instanceId))},
    {change:()=>db.update(s.users).set({disabled:true}).where(eq(s.users.id,scope.userId)),restore:()=>db.update(s.users).set({disabled:false}).where(eq(s.users.id,scope.userId))},
  ];
  for(const [kind,conflict] of [['seerr.request',false],['seerr.manage',false],['seerr.manage',true]] as const){
    for(const invalidation of [...cases,null]){
      const f=await fixture(kind,conflict),executing=f.execute();
      await f.ready;
      try{
        if(invalidation)await invalidation.change();
        else await db.update(s.outboxActions).set({state:'cancelled'}).where(eq(s.outboxActions.id,f.action.id));
        f.release();
        await expect(executing).rejects.toThrow();
        const [saved]=await db.select().from(s.mediaRequests).where(eq(s.mediaRequests.id,f.request.id));
        expect(saved.state).toBe('pending');expect(saved.externalId).toBe(f.request.externalId);
        expect(await db.select().from(s.syncValues).where(eq(s.syncValues.category,`request:${f.request.id}`))).toHaveLength(0);
      }finally{f.release();if(invalidation)await invalidation.restore();}
    }
  }
});

run('successful request and management publish the accepted state and baseline',async()=>{
  const db=getDb(),created=await fixture('seerr.request'),creating=created.execute();
  await created.ready;created.release();await creating;
  expect((await db.select().from(s.mediaRequests).where(eq(s.mediaRequests.id,created.request.id)))[0]).toMatchObject({state:'approved',externalId:'123'});
  const managed=await fixture('seerr.manage');
  await db.insert(s.syncValues).values({connectionId:scope.connectionId,mediaId,category:`request:${managed.request.id}`,conflict:true,remote:{value:'pending'},agreed:{value:'approved'}});
  const managing=managed.execute();await managed.ready;managed.release();await managing;
  expect((await db.select().from(s.mediaRequests).where(eq(s.mediaRequests.id,managed.request.id)))[0].state).toBe('approved');
  expect((await db.select().from(s.syncValues).where(eq(s.syncValues.category,`request:${managed.request.id}`)))[0]).toMatchObject({conflict:false,remote:{value:'approved'},agreed:{value:'approved'}});
});
