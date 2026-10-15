import {afterAll,afterEach,beforeAll,expect,spyOn,test} from 'bun:test';
import {and,eq,sql} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {ingestMetadata} from '../src/lib/catalogue/service.server';
import {SeerrAdapter,SeerrPermission} from '../src/lib/providers/seerr/adapter.server';
import * as accountModule from '../src/lib/providers/seerr/connection.server';
import {type getSeerr,type SeerrAccountScope} from '../src/lib/providers/seerr/connection.server';
import {refreshRequests} from '../src/lib/providers/seerr/requests.server';
import {jobExecution,JobYield} from '../src/lib/server/queue/execution';
import {ProviderHttpError} from '../src/lib/server/security/provider-fetch';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
let scope:SeerrAccountScope,instance:typeof s.providerInstances.$inferSelect,connection:typeof s.providerConnections.$inferSelect,mediaId:string;
let restoreAccount=()=>{};
afterEach(()=>restoreAccount());
const account={id:42,permissions:SeerrPermission.REQUEST},old=new Date('2000-01-01T00:00:00Z');
beforeAll(async()=>{
 if(!enabled)return;const db=getDb(),tag=crypto.randomUUID();
 const [user]=await db.insert(s.users).values({username:`seerr-refresh-${tag}`}).returning();
 const [linkedInstance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid'}).returning();
 [instance]=await db.insert(s.providerInstances).values({provider:'seerr',name:tag,baseUrl:'https://fixture.invalid',linkedMediaInstanceId:linkedInstance.id}).returning();
 const [linked]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:linkedInstance.id,externalUserId:tag}).returning();
 [connection]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:instance.id,externalUserId:'42'}).returning();
 scope={userId:user.id,instanceId:instance.id,connectionId:connection.id,accountGeneration:connection.accountGeneration,externalUserId:'42',linkedInstanceId:linkedInstance.id,linkedConnectionId:linked.id,linkedGeneration:linked.accountGeneration,linkedExternalUserId:tag};
 mediaId=(await ingestMetadata({provider:'tmdb',externalId:'1992000002',kind:'movie',title:'Seerr refresh fixture'})).id;
});
afterAll(async()=>{
 if(!enabled||!scope)return;const db=getDb();await db.delete(s.users).where(eq(s.users.id,scope.userId));await db.delete(s.providerInstances).where(eq(s.providerInstances.id,scope.instanceId));await db.delete(s.providerInstances).where(eq(s.providerInstances.id,scope.linkedInstanceId));await db.delete(s.works).where(eq(s.works.id,mediaId));
});
async function fixture(total:number,listed=total,options:{partial?:boolean;status?:number;details?:(id:number)=>Promise<void>}={}){
 const db=getDb();
 await db.delete(s.outboxActions).where(eq(s.outboxActions.userId,scope.userId));await db.delete(s.mediaRequests).where(eq(s.mediaRequests.userId,scope.userId));
 await db.update(s.providerConnections).set({settings:{}}).where(eq(s.providerConnections.id,connection.id));
 if(total)await db.insert(s.mediaRequests).values(Array.from({length:total},(_,index)=>({userId:scope.userId,instanceId:scope.instanceId,mediaId,externalId:String(index+1),state:'pending' as const,updatedAt:old})));
 const [action]=await db.insert(s.outboxActions).values({userId:scope.userId,connectionId:connection.id,kind:'seerr.sync',state:'running',attempts:1,payload:{}}).returning();
 const pages:number[]=[],details:number[]=[];
 let injectPartial=options.partial;
 const adapter=new SeerrAdapter(async path=>{
  const url=new URL(path,'https://fixture.invalid');
  if(url.pathname.endsWith('/request')){
   const offset=Number(url.searchParams.get('skip'));pages.push(offset);
   if(injectPartial){injectPartial=false;jobExecution.getStore()!.started=performance.now()-10001;}
   return {results:Array.from({length:Math.max(0,Math.min(100,listed-offset))},(_,index)=>({id:offset+index+1,status:options.status??1,requestedBy:{id:42}}))};
  }
  const id=Number(url.pathname.split('/').at(-1));details.push(id);await options.details?.(id);return{id,status:1,requestedBy:{id:42}};
 },'fixture',42);
 const resolve:typeof getSeerr=async()=>({adapter,scope,instance,connection,account,linkedJellyfinUserId:scope.linkedExternalUserId});
 const accountSpy=spyOn(accountModule,'getSeerr').mockImplementation(resolve);restoreAccount=()=>accountSpy.mockRestore();
 const execute=()=>jobExecution.run({id:action.id,attempts:1,purpose:'scheduled',started:performance.now(),checkpoints:0},()=>refreshRequests(scope.userId,scope.instanceId,{connectionId:connection.id,accountGeneration:connection.accountGeneration}));
 const checkpoint=async()=>{const [row]=await db.select().from(s.outboxActions).where(eq(s.outboxActions.id,action.id));return row.payload._checkpoint as Record<string,unknown>;};
 return {action,pages,details,execute,checkpoint};
}
run('Seerr scan yields after five pages and resumes with constant-size cursor and unchanged visible timestamps',async()=>{
 const db=getDb(),f=await fixture(600);
 await expect(f.execute()).rejects.toBeInstanceOf(JobYield);
 expect(f.pages).toEqual([0,100,200,300,400]);const point=await f.checkpoint();expect(point.offset).toBe(500);expect(JSON.stringify(point).length).toBeLessThan(300);
 expect(await db.select().from(s.providerJobSnapshots).where(eq(s.providerJobSnapshots.actionId,f.action.id))).toHaveLength(0);
 const [before]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,connection.id));expect(before.settings.requestsVerifiedAt).toBeUndefined();
 await f.execute();expect(f.pages).toEqual([0,100,200,300,400,500,600]);expect(f.details).toEqual([]);
 const requests=await db.select().from(s.mediaRequests).where(eq(s.mediaRequests.userId,scope.userId));expect(requests).toHaveLength(600);expect(requests.every(request=>request.updatedAt.getTime()===old.getTime())).toBe(true);
 expect(new Set(requests.map(request=>request.observedScanId))).toEqual(new Set([String(point.scanId)]));expect((await f.checkpoint()).phase).toBe('complete');
 const [after]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,connection.id));expect(typeof after.settings.requestsVerifiedAt).toBe('string');
});
run('a slow partial page retains only that bounded page and resumes without refetching it',async()=>{
 const db=getDb(),f=await fixture(100,100,{partial:true});
 await expect(f.execute()).rejects.toBeInstanceOf(JobYield);expect((await f.checkpoint()).next).toBe(1);expect(f.pages).toEqual([0]);
 const [snapshot]=await db.select().from(s.providerJobSnapshots).where(eq(s.providerJobSnapshots.actionId,f.action.id));expect((snapshot.data.results as unknown[]).length).toBe(100);
 await f.execute();expect(f.pages).toEqual([0,100]);expect(await db.select().from(s.providerJobSnapshots).where(eq(s.providerJobSnapshots.actionId,f.action.id))).toHaveLength(0);
 expect((await f.checkpoint()).phase).toBe('complete');
});
run('missing requests require individual 404 and a retryable failure cannot publish freshness',async()=>{
 const db=getDb();let fail=true;
 const f=await fixture(2,0,{details:async id=>{if(id===1)throw new ProviderHttpError(404);if(fail)throw new ProviderHttpError(429,30);}});
 await expect(f.execute()).rejects.toBeInstanceOf(ProviderHttpError);
 expect((await f.checkpoint()).phase).toBe('missing');
 const [accountBefore]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,connection.id));expect(accountBefore.settings.requestsVerifiedAt).toBeUndefined();
 const [retained]=await db.select().from(s.mediaRequests).where(and(eq(s.mediaRequests.userId,scope.userId),eq(s.mediaRequests.externalId,'2')));expect(retained.state).toBe('pending');
 fail=false;await f.execute();
 const requests=await db.select().from(s.mediaRequests).where(eq(s.mediaRequests.userId,scope.userId));expect(requests.find(request=>request.externalId==='1')?.state).toBe('cancelled');expect(requests.find(request=>request.externalId==='2')?.state).toBe('pending');expect((await f.checkpoint()).phase).toBe('complete');
});
run('a replaced attempt cannot stamp a request page or its checkpoint',async()=>{
 const db=getDb(),f=await fixture(100,100,{partial:true});
 await expect(f.execute()).rejects.toBeInstanceOf(JobYield);
 await db.update(s.outboxActions).set({attempts:2}).where(eq(s.outboxActions.id,f.action.id));
 const [before]=await db.select({count:sql<number>`count(*)::int`}).from(s.mediaRequests).where(and(eq(s.mediaRequests.userId,scope.userId),sql`${s.mediaRequests.observedScanId} is not null`));
 await expect(f.execute()).rejects.toBeInstanceOf(JobYield);
 const [after]=await db.select({count:sql<number>`count(*)::int`}).from(s.mediaRequests).where(and(eq(s.mediaRequests.userId,scope.userId),sql`${s.mediaRequests.observedScanId} is not null`));
 expect(after.count).toBe(before.count);expect((await f.checkpoint()).next).toBe(1);
});

run('status notifications and the page checkpoint roll back and resume together',async()=>{
 const db=getDb(),f=await fixture(1,1,{status:2});
 await db.execute(sql`create function reject_fixture_notice() returns trigger language plpgsql as $$begin raise exception 'fixture notification failure'; end;$$`);
 await db.execute(sql`create trigger reject_fixture_notice before insert on notifications for each row execute function reject_fixture_notice()`);
 try {
  await expect(f.execute()).rejects.toThrow('Failed query: INSERT INTO notifications');
  const [request]=await db.select().from(s.mediaRequests).where(eq(s.mediaRequests.userId,scope.userId));
  expect(request.state).toBe('pending');expect(request.observedScanId).toBeNull();
  expect((await f.checkpoint()).offset).toBe(0);expect((await f.checkpoint()).next).toBe(0);
 } finally {
  await db.execute(sql`drop trigger reject_fixture_notice on notifications`);
  await db.execute(sql`drop function reject_fixture_notice()`);
 }
 await f.execute();
 const [request]=await db.select().from(s.mediaRequests).where(eq(s.mediaRequests.userId,scope.userId));
 expect(request.state).toBe('approved');expect((await f.checkpoint()).phase).toBe('complete');
 const notices=await db.select().from(s.notifications).where(and(eq(s.notifications.userId,scope.userId),eq(s.notifications.sourceKey,`seerr:${scope.instanceId}:1:approved`)));
 expect(notices).toHaveLength(1);expect(notices[0].data?.workId).toBe(mediaId);
});
run('a missing old request cannot cancel its replacement identity',async()=>{
 const db=getDb();
 const f=await fixture(1,0,{details:async()=>{
  await db.update(s.mediaRequests).set({externalId:'1001'}).where(eq(s.mediaRequests.userId,scope.userId));
  throw new ProviderHttpError(404);
 }});
 await f.execute();
 const [request]=await db.select().from(s.mediaRequests).where(eq(s.mediaRequests.userId,scope.userId));
 expect(request.externalId).toBe('1001');expect(request.state).toBe('pending');expect((await f.checkpoint()).phase).toBe('complete');
});
