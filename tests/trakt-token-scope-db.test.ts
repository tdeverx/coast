import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq,sql} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {encryptCredential} from '../src/lib/server/security/credentials';
import {getTrakt} from '../src/lib/providers/trakt/connection.server';

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
