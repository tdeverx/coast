// Authorization/storage are isolated; route/service function bodies, adapter and provider queue are current source.
import {expect} from 'bun:test';
import * as v from 'valibot';
import {JellyfinAdapter} from '../../src/lib/providers/jellyfin/adapter.server';
import {queueProviderRequest,providerRequestMetrics} from '../../src/lib/server/security/request-priority';
import {musicBrowseSchema,jellyfinMusicIdSchema} from '../../src/lib/providers/jellyfin/music.server';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};};
async function body(path:string,from?:string,to?:string){
 let text=await Bun.file(path).text();if(from)text=text.slice(text.indexOf(from),to?text.indexOf(to,text.indexOf(from)):undefined);
 return new Bun.Transpiler({loader:'ts'}).transformSync(text.replace(/^\s*import[\s\S]*?from ['"][^'"]+['"];?/gm,'').replaceAll('export ',''));
}
function load<T extends (...args:any[])=>any>(code:string,name:string,deps:Record<string,unknown>):T{return Function(...Object.keys(deps),code+`;return ${name};`)(...Object.values(deps));}
const musicCode=await body('src/lib/music/service.server.ts','export async function musicLibrary','export async function setMusicFavourite');
const artworkCode=await body('src/lib/music/artwork.server.ts');
const trailerCode=await body('src/lib/playback/service.server.ts','export async function getTrailer','export async function streamTrailer');
const providersCode=await body('src/lib/server/api/providers.server.ts'),mediaCode=await body('src/lib/server/api/media.server.ts');
const user=crypto.randomUUID(),connectionId=crypto.randomUUID(),item='a'.repeat(32),mediaId=crypto.randomUUID();
let providerExecutions=0,observations=0,downloads=0;
for(const kind of ['browse','detail','artwork','trailer-list','trailer-info']){
 const origin=`https://${kind}.cancel-fixture.invalid`,blocked=deferred(),entered=deferred(),requested=deferred();
 const blocker=queueProviderRequest(origin,0,async()=>{entered.resolve();await blocked.promise;});await entered.promise;
 const controller=new AbortController();
 let observed:AbortSignal|undefined;
 const adapter=new JellyfinAdapter((path,init)=>{
  if(kind==='trailer-info'&&path.includes('/LocalTrailers'))return Promise.resolve([{Id:'trailer',Name:'Local trailer'}]);
  observed=init?.signal??undefined;requested.resolve();
  return queueProviderRequest(origin,0,async()=>{providerExecutions++;throw Error('Cancelled work reached provider');},observed);
 },'fixture-device');
 const getJellyfin=async()=>({adapter,connection:{id:connectionId,externalUserId:'provider-user',accountGeneration:'fixture',credentials:'fixture'},instance:{id:'fixture-instance'}});
 const deps={v,getJellyfin,musicBrowseSchema,jellyfinMusicIdSchema,requireFeature:async()=>{},
  observeMusicLibraryAccess:async()=>{observations++;throw Error('Cancelled browse persisted');},
  observeMusicAccess:async()=>{observations++;throw Error('Cancelled detail persisted');},
  personaliseMusicItems:async()=>{throw Error('Cancelled read personalized');},
 };
 const musicLibrary=load(musicCode,'musicLibrary',deps),musicDetails=load(musicCode,'musicDetails',deps);
 const streamMusicArtwork=load(artworkCode,'streamMusicArtwork',{...deps,serverArtwork:async()=>{downloads++;throw Error('Cancelled permission read reached image');}});
 const request=new Request('https://coast-fixture.invalid/read',{signal:controller.signal});
 const context={user:{id:user},uid:user,path:['providers',connectionId,'music',...(kind==='browse'?[]:[item]),...(kind==='artwork'?['artwork']:[])],method:'GET',url:new URL(request.url),request,body:{}};
 let pending:Promise<unknown>;
 if(kind.startsWith('trailer')){
  const table=new Proxy({}, {get:()=>({})});
  const getDb=()=>({select:()=>({from:()=>({innerJoin:()=>({where:async()=>[{availability:{connectionId},providerItem:{externalId:item}},{availability:{connectionId},providerItem:{externalId:item}}]})})})});
  const getTrailer=load(trailerCode,'getTrailer',{...deps,getDb,availability:table,providerItems:table,eq:()=>{},and:()=>{}});
  const handle=load(mediaCode,'handleMedia',{getTrailer,uuid:(id:string)=>id,json:(value:unknown)=>value});
  pending=handle({...context,path:['media',mediaId,'trailer']});
 }else{
  const handle=load(providersCode,'handleProviders',{musicLibrary,musicDetails,streamMusicArtwork,uuid:(id:string)=>id,json:(value:unknown)=>value});
  pending=handle(context);
 }
 void pending.catch(()=>{});
 try{
  await requested.promise;expect(observed).toBe(request.signal);
  expect(providerRequestMetrics()).toMatchObject({providerOutstanding:2,providerWaiting:1});
  controller.abort();
  expect(providerRequestMetrics()).toMatchObject({providerOutstanding:1,providerWaiting:0});
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
 }finally{blocked.resolve();await blocker;await pending.catch(()=>{});}
 expect(providerRequestMetrics()).toMatchObject({providerOutstanding:0,providerWaiting:0});
}
console.log(JSON.stringify({cancelledRoutes:5,providerExecutions,observations,downloads}));
