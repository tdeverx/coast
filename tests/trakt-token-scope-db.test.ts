import {afterAll,beforeAll,expect,spyOn,test} from 'bun:test';
import {eq,sql} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {decryptCredential,encryptCredential} from '../src/lib/server/security/credentials';
import {finishTraktDevice,getTrakt,startTraktDevice,updateSyncPreferences} from '../src/lib/providers/trakt/connection.server';

import * as instances from '../src/lib/providers/instances.server';
import {ProviderHttpError} from '../src/lib/server/security/provider-fetch';
import * as providerFetch from '../src/lib/server/security/provider-fetch';
import {initialTraktSyncPreferences} from '../src/lib/providers/trakt/access';
import {providerRequestMetrics,queueProviderRequest} from '../src/lib/server/security/request-priority';
import {jobExecution,JobYield} from '../src/lib/server/queue/execution';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
let userId:string,instanceId:string,connectionId:string;
beforeAll(async()=>{
  if(!enabled)return;const db=getDb(),tag=crypto.randomUUID();
  const [user]=await db.insert(s.users).values({username:`trakt-token-${tag}`}).returning();userId=user.id;
  const credentials=await encryptCredential(JSON.stringify({clientId:'fixture-client',clientSecret:'fixture-secret'}));
  const [instance]=await db.insert(s.providerInstances).values({provider:'trakt',name:tag,baseUrl:'https://api.trakt.tv',credentials}).returning();instanceId=instance.id;
  const token=await encryptCredential(JSON.stringify({access_token:'fixture-valid',refresh_token:'fixture-refresh',created_at:Math.floor(Date.now()/1000),expires_in:3600}));
  const [connection]=await db.insert(s.providerConnections).values({userId,instanceId,externalUserId:tag,credentials:token}).returning();connectionId=connection.id;
});
afterAll(async()=>{if(enabled){const db=getDb();await db.delete(s.users).where(eq(s.users.id,userId));await db.delete(s.providerInstances).where(eq(s.providerInstances.id,instanceId));}});

run('valid Trakt token resolution does not wait for another request holding the refresh lock',async()=>{
  let locked!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>{locked=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const lock=getDb().transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`trakt-refresh:${connectionId}`},0))`);locked();await hold;});
  await entered;
  const resolving=getTrakt(userId,connectionId);
  try {
    const resolved=await Promise.race([resolving.then(()=>true),Bun.sleep(1000).then(()=>false)]);
    expect(resolved).toBe(true);
  } finally {release();await lock;await resolving;}
});

run('an adapter resolved before an account switch rejects before invoking the upstream transport',async()=>{
  const resolved=await getTrakt(userId,connectionId);
  await getDb().update(s.providerConnections).set({externalUserId:crypto.randomUUID()}).where(eq(s.providerConnections.id,connectionId));
  await expect(resolved.adapter.profile()).rejects.toThrow('account changed');
});

const fixtureTokens = {access_token:'fixture-device-access',refresh_token:'fixture-device-refresh',created_at:1,expires_in:3600,token_type:'bearer',scope:'public'};

run('import-only credentials cannot write and revoking export stops a write waiting for a provider slot',async()=>{
  const read=await getTrakt(userId,connectionId);
  await expect(read.adapter.write('watchlist',{movies:[]})).rejects.toThrow('export');
  await expect(getTrakt(userId,connectionId,'export')).rejects.toThrow('export');
  const preferences={...initialTraktSyncPreferences,accountGeneration:read.connection.accountGeneration};
  await expect(updateSyncPreferences(userId,connectionId,{...preferences,accountGeneration:crypto.randomUUID(),traktAccess:{import:true,export:true}})).rejects.toThrow('account changed');
  const [legacy]=await getDb().insert(s.outboxActions).values({userId,connectionId,accountGeneration:preferences.accountGeneration,
    kind:'trakt.export',payload:{},state:'pending'}).returning({id:s.outboxActions.id});
  await updateSyncPreferences(userId,connectionId,{...preferences,traktAccess:{import:false,export:true}});
  const [oldWork]=await getDb().select({state:s.outboxActions.state}).from(s.outboxActions).where(eq(s.outboxActions.id,legacy.id));
  expect(oldWork.state).toBe('cancelled');
  await expect(getTrakt(userId,connectionId)).rejects.toThrow('import');
  const write=await getTrakt(userId,connectionId,'export');
  let release!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  const slot=queueProviderRequest('https://api.trakt.tv',0,()=>hold);
  const fetch=spyOn(globalThis,'fetch').mockRejectedValue(new Error('Unexpected upstream request'));
  const waiting=write.adapter.write('watchlist',{movies:[]});
  try {
    const deadline=performance.now()+3000;
    while(!providerRequestMetrics().providerWaiting && performance.now()<deadline)await Bun.sleep(5);
    expect(providerRequestMetrics().providerWaiting).toBe(1);
    await updateSyncPreferences(userId,connectionId,{...preferences,traktAccess:{import:true,export:false}});
    release();await slot;
    await expect(waiting).rejects.toThrow('export');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    release();await Promise.allSettled([slot,waiting]);fetch.mockRestore();
  }
});

run('restoring export cannot resume an adapter owned by a cancelled worker',async()=>{
  const db=getDb();
  const [current]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,connectionId));
  const allow={...initialTraktSyncPreferences,accountGeneration:current.accountGeneration,traktAccess:{import:true,export:true}};
  await updateSyncPreferences(userId,connectionId,allow);
  const [job]=await db.insert(s.outboxActions).values({userId,connectionId,accountGeneration:current.accountGeneration,
    kind:'trakt.export',payload:{},state:'running',attempts:1}).returning({id:s.outboxActions.id});
  const adapter=(await getTrakt(userId,connectionId,'export')).adapter;
  await updateSyncPreferences(userId,connectionId,{...allow,traktAccess:{import:true,export:false}});
  await updateSyncPreferences(userId,connectionId,allow);
  const fetch=spyOn(globalThis,'fetch').mockRejectedValue(new Error('Unexpected upstream request'));
  try {
    await expect(jobExecution.run({id:job.id,attempts:1,purpose:'manual',started:performance.now(),checkpoints:0},
      ()=>adapter.write('watchlist',{movies:[]}))).rejects.toBeInstanceOf(JobYield);
    expect(fetch).not.toHaveBeenCalled();
  } finally {fetch.mockRestore();}
});

async function withDevice(testLink: (owner: string, upstream: {
  profileId: string; token: () => Promise<typeof fixtureTokens>; profile: () => Promise<void>;
}) => Promise<void>) {
  const db = getDb();
  const [owner] = await db.insert(s.users).values({username:'device-'+crypto.randomUUID()}).returning();
  const upstream = {profileId:crypto.randomUUID() as string,token:async()=>fixtureTokens,profile:async()=>{}};
  const transport = spyOn(instances, 'instanceTransport').mockReturnValue(async path => {
    if (path === '/oauth/device/code') return { device_code:crypto.randomUUID(),user_code:'FIXTURE',verification_url:'https://fixture.invalid/device',expires_in:600,interval:0 };
    if (path === '/oauth/device/token') return upstream.token();
    if (path === '/users/settings') { await upstream.profile(); return {user:{username:'Fixture',ids:{uuid:upstream.profileId}}}; }
    throw new Error('Unexpected synthetic Trakt call.');
  });
  try { await testLink(owner.id, upstream); }
  finally { transport.mockRestore(); await db.delete(s.users).where(eq(s.users.id,owner.id)); }
}

run('Trakt device and refresh credentials go to the auth host while account reads go to the API host', async () => {
  const [instance] = await getDb().select().from(s.providerInstances).where(eq(s.providerInstances.id,instanceId));
  const destinations: string[] = [];
  const transport = spyOn(providerFetch, 'createProviderTransport').mockImplementation(config => async path => {
    destinations.push(config.baseUrl + path);
    return null;
  });
  try {
    const send = instances.instanceTransport(instance);
    const paths = ['/oauth/device/code','/oauth/device/token','/oauth/token','/users/settings'];
    for (const path of paths) await send(path);
    expect(destinations).toEqual(paths.map((path, index) => (index < 3 ? 'https://auth.trakt.tv' : 'https://api.trakt.tv') + path));
  } finally { transport.mockRestore(); }
});

run('device linking preserves per-account categories while the displayed code always owns direction consent', async () => {
  await withDevice(async(owner, upstream) => {
    const db = getDb(), accountA = upstream.profileId;
    const lookup = async () => (await db.select().from(s.providerConnections).where(eq(s.providerConnections.userId,owner)))[0];
    const link = async (access?: {import:boolean;export:boolean}) => {
      const request = await startTraktDevice(owner,instanceId,access);
      const pending = await lookup();
      expect(pending.credentials).not.toContain(request.challengeId);
      const stored = JSON.parse(await decryptCredential(pending.credentials!));
      expect(stored).toMatchObject({challengeId:request.challengeId,access:access??{import:true,export:false}});
      await finishTraktDevice(owner,instanceId,request.challengeId);
      return lookup();
    };
    const a = await link();
    expect(a.settings).toMatchObject({sync:initialTraktSyncPreferences,traktAccess:{import:true,export:false}});
    const chosen = {...initialTraktSyncPreferences,ratings:false,collection:true};
    await db.update(s.providerConnections).set({status:'disconnected',credentials:null,settings:{...a.settings,sync:chosen}}).where(eq(s.providerConnections.id,a.id));
    const [write] = await db.insert(s.outboxActions).values({userId:owner,connectionId:a.id,accountGeneration:a.accountGeneration,kind:'trakt.export',payload:{}}).returning();
    const same = await link({import:false,export:false});
    expect(same.accountGeneration).toBe(a.accountGeneration);
    expect(same.settings).toMatchObject({sync:chosen,traktAccess:{import:false,export:false}});
    expect((await db.select().from(s.outboxActions).where(eq(s.outboxActions.id,write.id)))[0].state).toBe('cancelled');
    const disconnect = () => db.update(s.providerConnections).set({status:'disconnected',credentials:null}).where(eq(s.providerConnections.id,a.id));
    await disconnect();
    upstream.profileId=crypto.randomUUID();
    const b = await link({import:false,export:true});
    expect(b.accountGeneration).not.toBe(a.accountGeneration);
    expect(b.settings).toMatchObject({sync:initialTraktSyncPreferences,traktAccess:{import:false,export:true}});
    await disconnect();
    upstream.profileId=accountA;
    const restored=await link({import:true,export:true});
    expect(restored.syncAccountId).toBe(a.syncAccountId);
    expect(restored.settings).toMatchObject({sync:chosen,traktAccess:{import:true,export:true}});
  });
});

run('overlapping and replaced polls cannot spend a second code or publish stale consent', async () => {
  await withDevice(async(owner,upstream) => {
    const first = await startTraktDevice(owner,instanceId,{import:false,export:true});
    let entered!:()=>void, release!:()=>void, exchanges=0;
    const started = new Promise<void>(done=>{entered=done;}), held = new Promise<void>(done=>{release=done;});
    upstream.token = async () => { exchanges++; entered(); await held; return fixtureTokens; };
    const outstanding = finishTraktDevice(owner,instanceId,first.challengeId).catch((error:unknown)=>error);
    try {
      await started;
      expect(await finishTraktDevice(owner,instanceId,first.challengeId)).toEqual({pending:true});
      expect(exchanges).toBe(1);
      const next=await startTraktDevice(owner,instanceId);
      release();
      expect(await outstanding).toMatchObject({status:409,message:expect.stringContaining('replaced or cancelled')});
      await expect(finishTraktDevice(owner,instanceId,first.challengeId)).rejects.toThrow('replaced or cancelled');
      expect(exchanges).toBe(1);
      expect(await finishTraktDevice(owner,instanceId,next.challengeId)).toMatchObject({pending:false});
      const [saved]=await getDb().select().from(s.providerConnections).where(eq(s.providerConnections.userId,owner));
      expect(saved.settings.traktAccess).toEqual({import:true,export:false});
    } finally { release(); await outstanding; }
  });
});

run('Trakt polling honors Retry-After, stops on denial and resumes identity verification after a transient outage',async()=>{
  await withDevice(async(owner,upstream)=>{
    const db=getDb();
    const attempt=await startTraktDevice(owner,instanceId);
    let exchanges=0;
    upstream.token=async()=>{exchanges++;throw new ProviderHttpError(429,45);};
    const poll=()=>finishTraktDevice(owner,instanceId,attempt.challengeId), before=Date.now();
    expect(await poll()).toEqual({pending:true});
    expect(await poll()).toEqual({pending:true});
    expect(exchanges).toBe(1);
    const [row]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.userId,owner));
    const saved=JSON.parse(await decryptCredential(row.credentials!));
    expect(saved.interval).toBe(5);
    expect(saved.nextPoll).toBeGreaterThanOrEqual(before+45_000);
    await db.update(s.providerConnections).set({credentials:await encryptCredential(JSON.stringify({...saved,nextPoll:0}))}).where(eq(s.providerConnections.id,row.id));
    upstream.token=async()=>{throw new ProviderHttpError(418);};
    await expect(poll()).rejects.toThrow('declined');
    await expect(poll()).rejects.toThrow('replaced or cancelled');
    const next=await startTraktDevice(owner,instanceId);
    exchanges=0;
    upstream.token=async()=>{exchanges++;return fixtureTokens;};
    upstream.profile=async()=>{throw new ProviderHttpError(503);};
    await expect(finishTraktDevice(owner,instanceId,next.challengeId)).rejects.toThrow('503');
    upstream.profile=async()=>{};
    expect(await finishTraktDevice(owner,instanceId,next.challengeId)).toMatchObject({pending:false});
    expect(exchanges).toBe(1);
  });
});
