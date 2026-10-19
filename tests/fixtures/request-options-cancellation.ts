import {expect} from 'bun:test';
import * as v from 'valibot';
import {SeerrAdapter} from '../../src/lib/providers/seerr/adapter.server';
import {ProviderActionError} from '../../src/lib/providers/contracts';
import {queueProviderRequest,providerRequestMetrics} from '../../src/lib/server/security/request-priority';
async function body(path:string,start:string,end?:string){const source=await Bun.file(path).text();return new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(source.indexOf(start),end?source.indexOf(end,source.indexOf(start)):undefined).replaceAll('export ',''));}
function load(code:string,name:string,deps:Record<string,unknown>){return Function(...Object.keys(deps),code+`;return ${name};`)(...Object.values(deps));}
const transportCode=await body('src/lib/providers/instances.server.ts','export function instanceTransport');
const connectionCode=await body('src/lib/providers/seerr/connection.server.ts','export async function getSeerr');
const optionsCode=await body('src/lib/providers/seerr/requests.server.ts','export async function requestOptions','export async function requestMedia');
const handlerCode=await body('src/lib/server/api/requests.server.ts','export async function handleRequests');
const deferred=()=>{let resolve!:()=>void;return {promise:new Promise<void>(done=>resolve=done),resolve:()=>resolve()};};
const table=()=>new Proxy({},{get:()=>({})});
const tables={media:table(),externalIds:table(),providerInstances:table(),providerConnections:table(),mediaRequests:table()};
let cancelledProviderExecutions=0,verifiedStages=0;
for(const stage of ['mapped-user','permissions','options']){
 const blocker=deferred(),entered=deferred(),waiting=deferred();
 const origin=`https://${stage}.request-options-fixture.invalid`;
 const held=queueProviderRequest(origin,0,async()=>{entered.resolve();await blocker.promise;});await entered.promise;
 const controller=new AbortController(),request=new Request('https://coast-fixture.invalid/api/v1/requests/options?mediaId=00000000-0000-4000-8000-000000000001',{signal:controller.signal});
 let connectionReads=0,writes=0,queued=0;const signals:AbortSignal[]=[];
 const instance={id:'seerr',name:'Request service',linkedMediaInstanceId:'jellyfin',credentials:'inert'};
 const linked={id:'linked',accountGeneration:'linked-generation',externalUserId:'linked-user'};
 const connection={id:'connected',accountGeneration:'generation',settings:{requestOptionsCache:{}},externalUserId:'7'};
 const user={id:7,email:'fixture@example.invalid',username:'Fixture',permissions:32};
 const getDb=()=>({select:()=>({from:(target:unknown)=>({where:async()=>target===tables.media?[{kind:'movie'}]:target===tables.externalIds?[{externalId:'1'}]:target===tables.providerInstances?[instance]:target===tables.mediaRequests?[]:target===tables.providerConnections?[++connectionReads===1?linked:connection]:[]})}),transaction:async(work:(tx:unknown)=>unknown)=>work(getDb()),update:()=>({set:()=>({where:async()=>{writes++;return [];}})})});
 const instanceFetchConfig=async()=>({});
 const createProviderTransport=()=>async(path:string,init?:RequestInit)=>{
  expect(init?.signal).toBe(request.signal);signals.push(init!.signal!);
  const isMapped=path.includes('/user/jellyfin/'),isPermission=path.endsWith('/auth/me');
  if(stage!=='mapped-user'&&isMapped)return user;
  if(stage==='options'&&isPermission)return user;
  queued++;if(queued===(stage==='options'?2:1))waiting.resolve();
  return queueProviderRequest(origin,0,async()=>{cancelledProviderExecutions++;throw Error('Cancelled request reached provider');},init?.signal??undefined);
 };
 const instanceTransport=load(transportCode,'instanceTransport',{instanceFetchConfig,createProviderTransport});
 const base={...tables,v,getDb,eq:()=>{},and:()=>{},sql:()=>{},getConfig:async()=>({enableRequests:true}),getInstance:async()=>instance,decryptCredential:async()=>'{"apiKey":"inert"}',SeerrAdapter,instanceTransport,saveConnection:async()=>{throw Error('Existing fixture account must not remap');},assertSeerrAccount:async()=>{},PermanentActionError:Error};
 const getSeerr=load(connectionCode,'getSeerr',base);
 const requestOptions=load(optionsCode,'requestOptions',{...base,getSeerr,getFeatureConfig:async()=>({features:{screen:true,requests:true}}),ProviderActionError,instanceFetchConfig});
 const handle=load(handlerCode,'handleRequests',{requestOptions,uuid:(value:string)=>value,json:(value:unknown)=>value});
 const pending=handle({uid:'viewer',path:['requests','options'],method:'GET',request,url:new URL(request.url),body:{}});void pending.catch(()=>{});
 try{
  await waiting.promise;expect(providerRequestMetrics().providerWaiting).toBe(stage==='options'?2:1);
  const priorWrites=writes;controller.abort();
  expect(providerRequestMetrics()).toMatchObject({providerOutstanding:1,providerWaiting:0});
  await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(writes).toBe(priorWrites);expect(signals.length).toBeGreaterThan(0);
  expect(writes).toBe(stage==='options'?1:0);verifiedStages++;
 }finally{blocker.resolve();await held;await pending.catch(()=>{});}
 expect(providerRequestMetrics()).toMatchObject({providerOutstanding:0,providerWaiting:0});
}
console.log(JSON.stringify({verifiedStages,cancelledProviderExecutions}));
