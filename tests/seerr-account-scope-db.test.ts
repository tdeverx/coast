import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import {jobExecution,JobYield} from '../src/lib/server/queue/execution';
import * as s from '../src/lib/server/db/schema';
import {assertSeerrAccount,type SeerrAccountScope} from '../src/lib/providers/seerr/connection.server';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
let scope:SeerrAccountScope;
beforeAll(async()=>{
  if(!enabled)return;
  const db=getDb(),tag=crypto.randomUUID();
  const [user]=await db.insert(s.users).values({username:`seerr-scope-${tag}`}).returning();
  const [linkedInstance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid'}).returning();
  const [instance]=await db.insert(s.providerInstances).values({provider:'seerr',name:tag,baseUrl:'https://fixture.invalid',linkedMediaInstanceId:linkedInstance.id}).returning();
  const [linked]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:linkedInstance.id,externalUserId:tag}).returning();
  const [connection]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:instance.id,externalUserId:'42'}).returning();
  scope={userId:user.id,instanceId:instance.id,connectionId:connection.id,accountGeneration:connection.accountGeneration,externalUserId:'42',
    linkedInstanceId:linkedInstance.id,linkedConnectionId:linked.id,linkedGeneration:linked.accountGeneration,linkedExternalUserId:tag};
});
afterAll(async()=>{
  if(!enabled||!scope)return;
  const db=getDb();await db.delete(s.users).where(eq(s.users.id,scope.userId));
  await db.delete(s.providerInstances).where(eq(s.providerInstances.id,scope.instanceId));
  await db.delete(s.providerInstances).where(eq(s.providerInstances.id,scope.linkedInstanceId));
});

run('verified dual-account scope permits a transactional observation write',async()=>{
  await getDb().transaction(async tx=>{
    const account=await assertSeerrAccount(tx,scope);
    expect(account.id).toBe(scope.connectionId);
    await tx.update(s.providerConnections).set({settings:{fixtureObserved:true}}).where(eq(s.providerConnections.id,scope.connectionId));
  });
  const [account]=await getDb().select().from(s.providerConnections).where(eq(s.providerConnections.id,scope.connectionId));
  expect(account.settings.fixtureObserved).toBe(true);
});

run('obsolete generations and identities cannot publish request observations',async()=>{
  for(const changed of [
    {...scope,accountGeneration:crypto.randomUUID()},
    {...scope,linkedGeneration:crypto.randomUUID()},
    {...scope,externalUserId:'other-request-user'},
    {...scope,linkedExternalUserId:'other-media-user'},
    {...scope,userId:crypto.randomUUID()},
    {...scope,linkedInstanceId:crypto.randomUUID()},
  ])await expect(getDb().transaction(async tx=>{
    await assertSeerrAccount(tx,changed);
    await tx.update(s.providerConnections).set({settings:{stale:true}}).where(eq(s.providerConnections.id,scope.connectionId));
  })).rejects.toThrow('account changed');
  const [account]=await getDb().select().from(s.providerConnections).where(eq(s.providerConnections.id,scope.connectionId));
  expect(account.settings.stale).toBeUndefined();
});

run('a cancelled worker cannot publish an observation even when both accounts still match',async()=>{
 const db=getDb();
 const [action]=await db.insert(s.outboxActions).values({userId:scope.userId,connectionId:scope.connectionId,kind:'seerr.sync',payload:{},state:'cancelled',attempts:1}).returning();
 await expect(jobExecution.run({id:action.id,attempts:1,purpose:'scheduled',started:performance.now(),checkpoints:0},()=>db.transaction(async tx=>{
  await assertSeerrAccount(tx,scope);
  await tx.update(s.providerConnections).set({settings:{stale:true}}).where(eq(s.providerConnections.id,scope.connectionId));
 }))).rejects.toBeInstanceOf(JobYield);
 const [account]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,scope.connectionId));
 expect(account.settings.stale).toBeUndefined();
});

run('a linked-account disconnect during an upstream wait blocks the eventual write',async()=>{
  const db=getDb();
  await db.update(s.providerConnections).set({status:'disconnected'}).where(eq(s.providerConnections.id,scope.linkedConnectionId));
  await expect(db.transaction(async tx=>{
    await assertSeerrAccount(tx,scope);
    await tx.update(s.providerConnections).set({settings:{stale:true}}).where(eq(s.providerConnections.id,scope.connectionId));
  })).rejects.toThrow('account changed');
  const [account]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,scope.connectionId));
  expect(account.settings.stale).toBeUndefined();
});
