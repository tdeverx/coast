import {expect,test} from 'bun:test';
import * as v from 'valibot';
import {SeerrAdapter,SeerrPermission,groupDestination,seerrSeasonCoverage,requestClaimsQuality} from '../src/lib/providers/seerr/adapter.server';
import {ProviderActionError,requestDestinationLock} from '../src/lib/providers/contracts';
import {requestQualityStatus,requestSeasonChoices,requestSeasonStatus,type RequestDestination,type RequestSeasonBlockReason} from '../src/lib/media/requests';

const source=await Bun.file(new URL('../src/lib/providers/seerr/requests.server.ts',import.meta.url)).text();
function body(start:string,end:string){return new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))).replaceAll('export ',''));}
const optionsSource=body('export async function requestOptions','export async function requestMedia');
const commandSource=body('export async function requestMedia','const seerrCheckpointSchema');
const load=(code:string,name:string,deps:Record<string,unknown>)=>Function(...Object.keys(deps),code+`;return ${name};`)(...Object.values(deps));
const table=()=>new Proxy({},{get:()=>({})});
const tables={media:table(),externalIds:table(),providerInstances:table(),providerConnections:table(),mediaRequests:table()};
const uuid='00000000-0000-4000-8000-000000000001';

function fixture(kind:'movie'|'show',details:unknown,permissions=SeerrPermission.REQUEST|SeerrPermission.REQUEST_4K){
 const instance={id:uuid,name:'Request service',linkedMediaInstanceId:'linked'};
 const connection={id:uuid,settings:{requestOptionsCache:{}}};
 const counters={inserts:0,providerReads:0};
 const adapter=new SeerrAdapter(async path=>{
  counters.providerReads++;
  if(path.includes('/service/'))return[{id:1,name:'Standard',is4k:false},{id:2,name:'4K',is4k:true}];
  if(path.includes('/movie/')||path.includes('/tv/'))return details;
  throw Error('Unexpected provider route');
 },'fixture');
 const db:any={select:()=>({from:(target:unknown)=>({where:async()=>target===tables.media?[{kind}]:target===tables.externalIds?[{externalId:'1'}]:target===tables.providerInstances?[instance]:target===tables.providerConnections?[connection]:[]})}),
  update:()=>({set:()=>({where:async()=>[]})}),execute:async()=>[],
  insert:()=>{counters.inserts++;throw Error('An already covered request must not enqueue work');},transaction:async(fn:(tx:unknown)=>unknown)=>fn(db)};
 const deps={...tables,v,getDb:()=>db,eq:()=>{},and:()=>{},sql:()=>{},groupDestination,seerrSeasonCoverage,requestClaimsQuality,requestDestinationLock,
  getFeatureConfig:async()=>({features:{screen:true,requests:true}}),getSeerr:async()=>({adapter,account:{id:7,permissions},connection,linkedJellyfinUserId:'linked-user'}),
  ProviderActionError,instanceFetchConfig:async()=>{throw Error('Unexpected cache fallback');},getInstance:async()=>instance,
  uuid:v.pipe(v.string(),v.uuid()),requireFeature:async()=>{},requireFeatureInTransaction:async()=>{},connectionFor:async()=>({connection}),trackInTransaction:async()=>{},context:{getStore:()=>undefined},correlationId:()=>uuid};
 const requestOptions=load(optionsSource,'requestOptions',deps);
 const requestMedia=load(commandSource,'requestMedia',{...deps,requestOptions});
 return{requestOptions:()=>requestOptions(uuid,uuid),requestMedia:(is4k=false,seasons:number[]=[])=>requestMedia(uuid,{mediaId:uuid,instanceId:uuid,is4k,seasons}),counters};
}
const movie={id:1,seasons:[],mediaInfo:{status:5,status4k:3,requests:[{id:2,status:2,is4k:true,serverId:2}]}};
const show={id:1,seasons:[{seasonNumber:1,episodeCount:8},{seasonNumber:2,episodeCount:10}],mediaInfo:{status:4,status4k:3,
 requests:[{id:2,status:2,is4k:false,serverId:1,seasons:[{seasonNumber:2,status:2}]},{id:3,status:2,is4k:true,serverId:2,seasons:[{seasonNumber:1,status:2},{seasonNumber:2,status:2}]}],
 seasons:[{seasonNumber:1,status:5,status4k:3},{seasonNumber:2,status:3,status4k:3}]}};

test('fully available/requested movie qualities remain visible with their exact disabled status',async()=>{
 const f=fixture('movie',movie),destinations=await f.requestOptions();
 expect(destinations).toHaveLength(1);
 expect(destinations[0].variants.standard).toMatchObject({requestable:false,available:true,requested:false});
 expect(destinations[0].variants.fourK).toMatchObject({requestable:false,available:false,requested:true});
 expect(requestQualityStatus(destinations,'standard')).toBe('Available');
 expect(requestQualityStatus(destinations,'fourK')).toBe('Requested');
 await expect(f.requestMedia()).rejects.toThrow('already available or requested');
 expect(f.counters.inserts).toBe(0);
});

test('fully covered shows retain standard/4K season rows, including season/episode scopes',async()=>{
 const f=fixture('show',show),destinations=await f.requestOptions();
 expect(destinations).toHaveLength(1);
 expect(requestSeasonChoices(destinations,'standard')).toEqual([
  {number:1,selectable:false,available:true,requested:false},
  {number:2,selectable:false,available:false,requested:true,blockedReason:'Processing'},
 ]);
 expect(requestSeasonChoices(destinations,'fourK')).toEqual([
  {number:1,selectable:false,available:false,requested:true,blockedReason:'Processing'},
  {number:2,selectable:false,available:false,requested:true,blockedReason:'Processing'},
 ]);
 expect(requestSeasonChoices(destinations,'standard',2)).toEqual([{number:2,selectable:false,available:false,requested:true,blockedReason:'Processing'}]);
 await expect(f.requestMedia(false,[1,2])).rejects.toThrow('already available or requested');
 expect(f.counters.inserts).toBe(0);
});

test('stored Seerr season statuses disable only the matching quality without claiming someone requested them',async()=>{
 const f=fixture('show',{id:1,seasons:[{seasonNumber:1,episodeCount:8},{seasonNumber:2,episodeCount:10}],
  mediaInfo:{status:4,status4k:4,requests:[],seasons:[{seasonNumber:1,status:3,status4k:7},{seasonNumber:2,status:1,status4k:4}]}});
 const destinations=await f.requestOptions();
 expect(requestSeasonChoices(destinations,'standard')).toEqual([
  {number:1,selectable:false,available:false,requested:false,blockedReason:'Processing'},
  {number:2,selectable:true,available:false,requested:false},
 ]);
 expect(requestSeasonChoices(destinations,'fourK')).toEqual([
  {number:1,selectable:true,available:false,requested:false},
  {number:2,selectable:false,available:false,requested:false,blockedReason:'Partially available'},
 ]);
 await expect(f.requestMedia(false,[1])).rejects.toThrow();
 await expect(f.requestMedia(true,[2])).rejects.toThrow();
 expect(f.counters.inserts).toBe(0);
});

test('status visibility never invents a permission-denied quality or destination',async()=>{
 const standardOnly=await fixture('movie',movie,SeerrPermission.REQUEST).requestOptions();
 expect(standardOnly).toHaveLength(1);expect(standardOnly[0].variants.fourK).toBeNull();
 expect(await fixture('show',show,0).requestOptions()).toEqual([]);
});

test('a free alternative destination stays actionable while covered destinations retain their statuses',async()=>{
 const covered=await fixture('movie',movie).requestOptions();
 const free:RequestDestination={id:'other',name:'Other',variants:{standard:{serverId:3,requestable:true,available:false,requested:false,seasons:[]},fourK:null}};
 expect(requestQualityStatus([...covered,free],'standard')).toBe('');
 expect(requestQualityStatus(covered,'standard')).toBe('Available');
 expect(requestQualityStatus(covered,'fourK')).toBe('Requested');
 expect(requestQualityStatus([free],'fourK')).toBe('Unavailable');
});

test('season menus preserve provider statuses for both qualities and are selectable only with a free destination',()=>{
 const reasons:RequestSeasonBlockReason[]=['Pending','Processing','Partially available','Blocked','Unavailable'];
 const seasons=reasons.map((blockedReason,index)=>({number:index+1,blockedReason,requested:false,available:false,mine:false}));
 const variant={serverId:1,requestable:true,requested:false,available:false,seasons};
 const source:RequestDestination={id:'primary',name:'Primary',variants:{standard:variant,fourK:{...variant,seasons:[...seasons].reverse()}}};
 for(const quality of ['standard','fourK'] as const){
  const blocked=requestSeasonChoices([source],quality);
  expect(blocked.map(requestSeasonStatus)).toEqual(reasons);
  expect(blocked.every(season=>!season.selectable)).toBe(true);
 }
 const alternate:RequestDestination={id:'alternate',name:'Alternate',variants:{
  standard:{...variant,seasons:[{number:1,mine:false,requested:false,available:false}]},fourK:null}};
 for(const order of [[source,alternate],[alternate,source]]){
  expect(requestSeasonChoices(order,'standard',1)[0].selectable).toBe(true);
  expect(requestSeasonChoices(order,'fourK',1)[0].selectable).toBe(false);
  expect(requestSeasonChoices(order,'standard',2)[0].selectable).toBe(false);
 }
});
