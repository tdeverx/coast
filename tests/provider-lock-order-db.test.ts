import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq,sql} from 'drizzle-orm';
import {getDb,getSql,closeDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {encryptCredential} from '../src/lib/server/security/credentials';
import {assertSeerrAccount,type SeerrAccountScope} from '../src/lib/providers/seerr/connection.server';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {tryReuseScreenAccess,type JellyfinAccessContext} from '../src/lib/providers/jellyfin/access-proof.server';
import {refreshProviderRecommendations} from '../src/lib/recommendations/providers.server';
import {TraktAdapter} from '../src/lib/providers/trakt/adapter.server';
import type {OutboxAction} from '../src/lib/server/queue';
import {jobFailureDetail,safeDiagnosticErrorCode} from '../src/lib/server/queue';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
let scope:SeerrAccountScope,context:JellyfinAccessContext,action:OutboxAction;
const library='a'.repeat(32),original=TraktAdapter.prototype.recommendations;
async function bounded<T>(work:Promise<T>){
 let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('A read-only account guard blocked a compatible policy fence.')),2000);})]);}
 finally{clearTimeout(timer!);}
}
/** Hold the actual reconciliation policy/user prefix on a second connection.
 * Guards must commit without upgrading that shared user lock to FOR UPDATE. */
async function underPolicyFence<T>(userId:string,work:()=>Promise<T>){
 let pending:Promise<T>|undefined;
 try{return await getSql().begin(async tx=>{
  await tx`select coast_lock_feature_policy(${userId}::uuid)`;
  pending=work();
  return bounded(pending);
 });}finally{await pending?.catch(()=>{});}
}
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getDb(),tag=crypto.randomUUID();
 await db.insert(s.systemSettings).values({key:'coast',value:{enableTrakt:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{enableTrakt:true}}});
 const [user]=await db.insert(s.users).values({username:`lock-order-${tag}`}).returning();
 const [viewer]=await db.insert(s.users).values({username:`lock-viewer-${tag}`}).returning();
 const [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid',serverIdentity:tag}).returning();
 const [linked]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:instance.id,externalUserId:tag,credentials:'fixture'}).returning();
 const [destination]=await db.insert(s.providerConnections).values({userId:viewer.id,instanceId:instance.id,externalUserId:'viewer',credentials:'fixture'}).returning();
 const [requests]=await db.insert(s.providerInstances).values({provider:'seerr',name:tag,baseUrl:'https://fixture.invalid',linkedMediaInstanceId:instance.id}).returning();
 const [connection]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:requests.id,externalUserId:'42'}).returning();
 scope={userId:user.id,instanceId:requests.id,connectionId:connection.id,accountGeneration:connection.accountGeneration,externalUserId:'42',
  linkedInstanceId:instance.id,linkedConnectionId:linked.id,linkedGeneration:linked.accountGeneration,linkedExternalUserId:tag};
 const census={sourceConnectionId:linked.id,accountGeneration:linked.accountGeneration,externalUserId:tag,serverIdentity:tag,serverVersion:'10.11.0',
  scanId:crypto.randomUUID(),total:0,completedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};
 await db.update(s.providerInstances).set({settings:{screenLibraryCensus:{[library]:census}}}).where(eq(s.providerInstances.id,instance.id));
 const adapter=new JellyfinAdapter(async path=>{
  if(path.startsWith('/System/Info/Public'))return {Id:tag,ServerName:'Fixture',ProductName:'Jellyfin Server',Version:'10.11.0'};
  if(path.startsWith('/Users/Me'))return {Id:destination.externalUserId,ServerId:tag,Policy:{IsDisabled:false,EnableMediaPlayback:true,EnableRemoteAccess:true,EnableAllDevices:true,
   EnableAllFolders:true,EnabledFolders:[],BlockedMediaFolders:[],BlockedTags:[],AllowedTags:[],BlockUnratedItems:[],AccessSchedules:[]}};
  if(path.startsWith('/UserViews/GroupingOptions'))return [{Id:library}];
  throw Error('Unexpected fixture request.');
 },viewer.id,'fixture');
 context={connection:destination,instance,adapter};
 const [trakt]=await db.insert(s.providerInstances).values({provider:'trakt',name:tag,baseUrl:'https://fixture.invalid',credentials:await encryptCredential(JSON.stringify({clientId:'fixture',clientSecret:'fixture'}))}).returning();
 const token=await encryptCredential(JSON.stringify({access_token:'fixture',refresh_token:'fixture',created_at:Math.floor(Date.now()/1000),expires_in:3600}));
 const [personal]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:trakt.id,externalUserId:tag,credentials:token}).returning();
 action={id:crypto.randomUUID(),userId:user.id,connectionId:personal.id,accountGeneration:personal.accountGeneration,kind:'trakt.recommendations',payload:{instanceId:trakt.id},attempts:1,correlationId:crypto.randomUUID()};
 TraktAdapter.prototype.recommendations=async()=>[];
});
afterAll(async()=>{
 TraktAdapter.prototype.recommendations=original;
 await closeDb();
});

run('Seerr dual-account guard does not upgrade a concurrent reconciliation user fence',async()=>{
 const account=await underPolicyFence(scope.userId,()=>getDb().transaction(tx=>assertSeerrAccount(tx,scope)));
 expect(account.id).toBe(scope.connectionId);
});
run('Jellyfin cache destination guard shares the reconciliation user fence',async()=>{
 expect(await underPolicyFence(context.connection.userId,()=>tryReuseScreenAccess(context))).toBe(0);
});
run('Jellyfin cache source guard also shares the other account reconciliation fence',async()=>{
 expect(await underPolicyFence(scope.userId,()=>tryReuseScreenAccess(context))).toBe(0);
});
run('personal recommendation publishing shares a concurrent reconciliation user fence',async()=>{
 expect(await underPolicyFence(action.userId,()=>refreshProviderRecommendations(action))).toEqual({checked:2,added:0});
 const rows=await getDb().select().from(s.recommendationSets).where(eq(s.recommendationSets.connectionId,action.connectionId!));
 expect(rows).toHaveLength(2);
});
run('committed user withdrawal and account replacement still reject guarded writes',async()=>{
 const db=getDb();
 await db.update(s.users).set({disabled:true}).where(eq(s.users.id,scope.userId));
 try{
  await expect(db.transaction(tx=>assertSeerrAccount(tx,scope))).rejects.toThrow('account changed');
  expect(await tryReuseScreenAccess(context)).toBeNull();
  await expect(refreshProviderRecommendations(action)).rejects.toThrow('unavailable');
 }finally{await db.update(s.users).set({disabled:false}).where(eq(s.users.id,scope.userId));}
 await db.update(s.providerConnections).set({accountGeneration:crypto.randomUUID()}).where(eq(s.providerConnections.id,scope.linkedConnectionId));
 await expect(db.transaction(tx=>assertSeerrAccount(tx,scope))).rejects.toThrow('account changed');
 expect(await tryReuseScreenAccess(context)).toBeNull();
});
run('real Bun and Drizzle PostgreSQL deadlock errors retain the local diagnostic code',async()=>{
 for(const query of [
  ()=>getSql().unsafe("DO $$BEGIN RAISE EXCEPTION USING ERRCODE='40P01',MESSAGE='private fixture';END$$"),
  ()=>getDb().execute(sql`DO $$BEGIN RAISE EXCEPTION USING ERRCODE='40P01',MESSAGE='private fixture';END$$`),
 ]){
  let error:unknown;
  try{await query();}catch(caught){error=caught;}
  expect(safeDiagnosticErrorCode(error)).toBe('local.database-deadlock');
  expect(jobFailureDetail(error,false)).toEqual({code:'local.database-deadlock',remedy:'retry',retryable:true});
 }
});
