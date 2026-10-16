// Isolated process: only authorization/storage boundaries are mocked; adapter and queue are actual modules.
import {expect,mock} from 'bun:test';
import {JellyfinAdapter} from '../../src/lib/providers/jellyfin/adapter.server';
import {queueProviderRequest,providerRequestMetrics} from '../../src/lib/server/security/request-priority';
import {users,readingWorks,readingSessions} from '../../src/lib/server/db/schema';
import * as transport from '../../src/lib/server/security/provider-fetch';
const deferred=<T=void>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};};
const userId=crypto.randomUUID(),workId=crypto.randomUUID(),sessionId=crypto.randomUUID(),connectionId=crypto.randomUUID(),externalId='123456781234123412341234567890ab';
const session={id:sessionId,userId,workId,connectionId,externalId,accountGeneration:'fixture-generation',format:'pdf',edition:'fixture'};
let adapter:JellyfinAdapter,downloads=0,metadataExecutions=0,authorizations=0;
const db={select(){return {from(table:unknown){return {async where(){authorizations++;if(table===users)return [{id:userId}];if(table===readingWorks)return [{id:workId,kind:'book',title:'Fixture'}];if(table===readingSessions)return [session];throw Error('Unexpected authorization query');}};}};},transaction(){throw Error('Cancelled preparation reached database mutation');}};
mock.module('../../src/lib/server/db',()=>({getDb:()=>db}));
mock.module('../../src/lib/server/features',()=>({requireFeature:async()=>({}),requireFeatureInTransaction:async()=>{},getFeatureConfig:async()=>({})}));
mock.module('../../src/lib/server/experimental',()=>({requireEnabledCategory(){}}));
mock.module('../../src/lib/providers/jellyfin/connection.server',()=>({getJellyfin:async()=>({connection:{externalUserId:'synthetic-user',accountGeneration:'fixture-generation',credentials:'synthetic'},instance:{id:'fixture'},adapter})}));
mock.module('../../src/lib/providers/instances.server',()=>({instanceFetchConfig:async()=>({})}));
mock.module('../../src/lib/server/security/credentials',()=>({decryptCredential:async()=>JSON.stringify({accessToken:'synthetic'})}));
mock.module('../../src/lib/catalogue/reading-files.server',()=>({observeReadingFile:async()=>{throw Error('Cancelled preparation reached file observation');}}));
mock.module('../../src/lib/core/reading/service.server',()=>({updateReading:async()=>{throw Error('Unexpected progress update');}}));
mock.module('../../src/lib/server/security/provider-fetch',()=>({...transport,secureProviderFetch:async()=>{downloads++;throw Error('Cancelled permission lookup reached Download');}}));
const {prepareReading,streamReading}=await import('../../src/lib/reading/sessions.server');

for(const operation of ['prepare','file'] as const){
 const origin=`https://${operation}-reading-cancellation.invalid`,blocked=deferred(),entered=deferred(),requested=deferred();
 const blocker=queueProviderRequest(origin,0,async()=>{entered.resolve();await blocked.promise;});await entered.promise;
 let observed:AbortSignal|undefined;
 adapter=new JellyfinAdapter((_path,init)=>{observed=init?.signal??undefined;requested.resolve();return queueProviderRequest(origin,0,async()=>{metadataExecutions++;return {Id:externalId,Type:'Book',Path:'/synthetic/fixture.pdf'};},observed);},'synthetic-device');
 const abort=new AbortController(),request=new Request('https://coast-fixture.invalid/file',{signal:abort.signal});
 const pending=operation==='prepare'?prepareReading(userId,workId,{source:'jellyfin',connectionId,externalId},abort.signal):streamReading(userId,sessionId,request);
 // Observe immediately so an assertion failure cannot leave a rejection unhandled.
 void pending.catch(()=>{});
 try{
  await requested.promise;expect(observed).toBe(operation==='prepare'?abort.signal:request.signal);
  expect(providerRequestMetrics()).toMatchObject({providerOutstanding:2,providerWaiting:1});
  abort.abort();expect(providerRequestMetrics()).toMatchObject({providerOutstanding:1,providerWaiting:0});
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
 }finally{blocked.resolve();await blocker;await pending.catch(()=>{});}
 expect(providerRequestMetrics()).toMatchObject({providerOutstanding:0,providerWaiting:0});
}

// Active permission reads also pass the signal through the adapter/helper boundary.
{
 const abort=new AbortController();let observed:AbortSignal|undefined;
 adapter=new JellyfinAdapter((_path,init)=>{observed=init?.signal??undefined;return new Promise((_resolve,reject)=>observed!.addEventListener('abort',()=>reject(observed!.reason),{once:true}));},'synthetic-device');
 const pending=adapter.readingItem('synthetic-user',externalId,abort.signal);
 expect(observed).toBe(abort.signal);abort.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
}
{
 const abort=new AbortController();abort.abort();const before=authorizations;
 adapter=new JellyfinAdapter(async()=>{throw Error('Already canceled lookup reached transport');},'synthetic-device');
 await expect(adapter.readingItem('synthetic-user',externalId,abort.signal)).rejects.toMatchObject({name:'AbortError'});
 await expect(streamReading(userId,sessionId,new Request('https://coast-fixture.invalid/file',{signal:abort.signal}))).rejects.toMatchObject({name:'AbortError'});
 expect(authorizations).toBe(before);
}
{
 adapter=new JellyfinAdapter(async()=>({Id:externalId,Type:'Book',Path:'/synthetic/fixture.pdf'}),'synthetic-device');
 expect((await adapter.readingItem('synthetic-user',externalId)).Id).toBe(externalId);
 adapter=new JellyfinAdapter(async()=>({Id:'223456781234123412341234567890ab',Type:'Book',Path:'/synthetic/other.pdf'}),'synthetic-device');
 await expect(adapter.readingItem('synthetic-user',externalId)).rejects.toThrow('different reading file');
}
console.log(JSON.stringify({queuedCases:2,activeCases:1,alreadyCancelledCases:2,identityCases:2,metadataExecutions,downloads}));
