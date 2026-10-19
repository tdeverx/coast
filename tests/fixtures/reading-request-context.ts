// Isolated supplementary correctness probe: real session/Jellyfin context owners;
// only database, policy, crypto and provider boundaries use controlled values.
import {expect,mock} from 'bun:test';
import {users,readingWorks,readingSessions,providerConnections,providerInstances} from '../../src/lib/server/db/schema';
import * as providerFetch from '../../src/lib/server/security/provider-fetch';
import * as configModule from '../../src/lib/server/config';
import * as featuresModule from '../../src/lib/server/features';
import * as experimentalModule from '../../src/lib/server/experimental';
import {AppError} from '../../src/lib/server/security/errors';

const expectedContexts=Number(process.env.COAST_EXPECT_READING_CONTEXTS??1);
const userId=crypto.randomUUID(),workId=crypto.randomUUID(),sessionId=crypto.randomUUID(),connectionId=crypto.randomUUID(),instanceId=crypto.randomUUID();
const generation=crypto.randomUUID(),externalId='123456781234123412341234567890ab';
const source={id:connectionId,userId,instanceId,status:'connected',externalUserId:'controlled-user',accountGeneration:generation,credentials:'controlled-encrypted'};
const instance={id:instanceId,provider:'jellyfin',enabled:true,baseUrl:'https://reading-context.invalid',serverIdentity:'controlled-server',settings:{approved:true}};
const book={Id:externalId,Type:'Book' as const,Name:'Controlled file',Path:'/controlled/file.cbr',Etag:'v1',DateModified:'2026-01-01',Size:4,ProviderIds:{}};
const session:{id:string;userId:string;workId:string;connectionId:string|null;externalId:string|null;accountGeneration:string;format:'cbr';edition:string}={id:sessionId,userId,workId,connectionId,externalId,accountGeneration:generation,format:'cbr',edition:''};
const state={hasSession:true,enabledUser:true,hasWork:true,connected:true,enabledInstance:true,featureEnabled:true,metadataAllowed:true,wrongItem:false,version:'v1',downloadStatus:206};
let selects:Record<string,number>={},decryptions=0,metadata=0,downloads=0,cancelledBodies=0,featureChecks=0;
const tables=new Map<unknown,string>([[users,'users'],[readingWorks,'reading_works'],[readingSessions,'reading_sessions'],[providerConnections,'provider_connections'],[providerInstances,'provider_instances']]);
const db={select(){return {from(table:unknown){return {async where(){
 const name=tables.get(table);if(!name)throw Error('Unexpected context table');selects[name]=(selects[name]??0)+1;
 if(table===users)return state.enabledUser?[{id:userId}]:[];
 if(table===readingWorks)return state.hasWork?[{id:workId,kind:'comic',title:'Controlled title'}]:[];
 if(table===readingSessions)return state.hasSession?[session]:[];
 if(table===providerConnections)return state.connected?[source]:[];
 if(table===providerInstances)return state.enabledInstance?[instance]:[];
 throw Error('Unexpected context read');
 }};}};},transaction(){throw Error('File read attempted a transaction mutation');}};
mock.module('../../src/lib/server/db',()=>({getDb:()=>db,getSql:()=>{throw Error('Unexpected raw database access');}}));
mock.module('../../src/lib/server/config',()=>({...configModule,getConfig:async()=>({serverAllowlist:[],allowedProviderPorts:[443]})}));
mock.module('../../src/lib/server/features',()=>({...featuresModule,lockFeaturePolicyInTransaction:async()=>{},requireFeature:async()=>{featureChecks++;if(!state.featureEnabled)throw new AppError(403,'This feature is disabled.');return {};},requireFeatureInTransaction:async()=>{throw Error('File read attempted a transaction feature check');}}));
mock.module('../../src/lib/server/experimental',()=>({...experimentalModule,requireEnabledCategory(){}}));
mock.module('../../src/lib/server/security/credentials',()=>({decryptCredential:async(value:string)=>{expect(value).toBe(source.credentials);decryptions++;return JSON.stringify({accessToken:'controlled-token'});},encryptCredential:async()=>{throw Error('Unexpected credential write');}}));
mock.module('../../src/lib/catalogue/reading-files.server',()=>({observeReadingFile:async()=>{throw Error('File read attempted file observation');}}));
mock.module('../../src/lib/core/reading/service.server',()=>({updateReading:async()=>{throw Error('File read attempted progress mutation');}}));
mock.module('../../src/lib/server/security/provider-fetch',()=>({...providerFetch,
 createProviderTransport:()=>async(path:string,init?:RequestInit)=>{
  metadata++;expect(path).toContain(`/Users/${source.externalUserId}/Items/${externalId}?`);
  expect(new Headers(init?.headers).get('authorization')).toContain('controlled-token');
  if(!state.metadataAllowed)throw new AppError(403,'File access denied.');
  init?.signal?.throwIfAborted();return {...book,Id:state.wrongItem?'223456781234123412341234567890ab':externalId,Etag:state.version};
 },
 secureProviderFetch:async(_config:unknown,path:string,init?:RequestInit)=>{
  downloads++;expect(path).toBe(`/Items/${externalId}/Download`);
  expect(new Headers(init?.headers).get('authorization')).toContain('controlled-token');
  expect(new Headers(init?.headers).get('range')).toBe('bytes=0-3');
  init?.signal?.throwIfAborted();
  return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('DATA'));},cancel(){cancelledBodies++;}}),{status:state.downloadStatus,headers:{'content-range':'bytes 0-3/10','content-length':'4','accept-ranges':'bytes',etag:'controlled-etag','last-modified':'controlled-date'}});
 }
}));
const modulePath=process.env.COAST_READING_CONTEXT_MODULE??'../../src/lib/reading/sessions.server';
const {ownedReadingSession,sourceEdition,streamReading}=await import(modulePath);
session.edition=sourceEdition(instance.serverIdentity,book);
const reset=()=>{selects={};decryptions=metadata=downloads=cancelledBodies=featureChecks=0;};
const request=(method='GET')=>new Request('https://coast-reading-context.invalid/file',{method,headers:{Range:'bytes=0-3'}});
const metrics=()=>({selects:{...selects},decryptions,metadata,downloads,featureChecks});
const cases:Record<string,unknown>[]=[];
for(const method of ['GET','HEAD']){
 reset();const response=await streamReading(userId,sessionId,request(method));
 expect(response.status).toBe(206);expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect(response.headers.get('content-range')).toBe('bytes 0-3/10');expect(response.headers.get('content-length')).toBe('4');
 expect(response.headers.get('accept-ranges')).toBe('bytes');expect(response.headers.get('etag')).toBe('controlled-etag');
 expect(response.headers.get('last-modified')).toBe('controlled-date');expect(response.headers.get('content-type')).toBe('application/octet-stream');
 expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");expect(response.headers.get('x-content-type-options')).toBe('nosniff');
 if(method==='HEAD'){expect(response.body).toBeNull();expect(cancelledBodies).toBe(1);}else{const reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toBe('DATA');await reader.cancel();}
 expect(selects).toEqual({reading_sessions:1,users:1,reading_works:1,provider_connections:expectedContexts,provider_instances:expectedContexts});
 expect(decryptions).toBe(expectedContexts+1);expect(metadata).toBe(1);expect(downloads).toBe(1);expect(featureChecks).toBe(1);
 cases.push({name:method,...metrics()});
}
reset();const owned=await ownedReadingSession(userId,sessionId);expect(owned).toBe(session);expect(Object.keys(owned)).not.toContain('jellyfin');expect(selects.provider_connections).toBe(1);expect(selects.provider_instances).toBe(1);expect(decryptions).toBe(1);expect(metadata).toBe(0);expect(downloads).toBe(0);cases.push({name:'owned_row_contract',...metrics()});
reset();session.connectionId=null;session.externalId=null;
try{
 expect(await ownedReadingSession(userId,sessionId)).toBe(session);expect(selects.provider_connections).toBeUndefined();expect(decryptions).toBe(0);cases.push({name:'local_owned_row_contract',...metrics()});
 reset();await expect(streamReading(userId,sessionId,request())).rejects.toMatchObject({status:404});expect(selects.provider_connections).toBeUndefined();expect(selects.provider_instances).toBeUndefined();expect(decryptions).toBe(0);expect(metadata).toBe(0);expect(downloads).toBe(0);cases.push({name:'local_file_stays_in_browser',...metrics()});
}finally{session.connectionId=connectionId;session.externalId=externalId;}

const reject=async(name:string,configure:()=>void,restore:()=>void,status:number)=>{
 reset();configure();try{await expect(streamReading(userId,sessionId,request())).rejects.toMatchObject({status});expect(downloads).toBe(0);cases.push({name,...metrics()});}finally{restore();}
};
await reject('closed_or_unowned_session',()=>state.hasSession=false,()=>state.hasSession=true,410);
await reject('disabled_user',()=>state.enabledUser=false,()=>state.enabledUser=true,401);
await reject('missing_work',()=>state.hasWork=false,()=>state.hasWork=true,404);
await reject('reader_withdrawn',()=>state.featureEnabled=false,()=>state.featureEnabled=true,403);
await reject('fresh_generation_next_request',()=>source.accountGeneration=crypto.randomUUID(),()=>source.accountGeneration=generation,410);
await reject('metadata_permission_withdrawn',()=>state.metadataAllowed=false,()=>state.metadataAllowed=true,403);
await reject('metadata_file_changed',()=>state.version='v2',()=>state.version='v1',409);
for(const [name,flag] of [['disconnected_source','connected'],['disabled_instance','enabledInstance']] as const){
 reset();state[flag]=false;try{await expect(streamReading(userId,sessionId,request())).rejects.toThrow();expect(metadata).toBe(0);expect(downloads).toBe(0);cases.push({name,...metrics()});}finally{state[flag]=true;}
}
reset();state.wrongItem=true;try{await expect(streamReading(userId,sessionId,request())).rejects.toThrow('different reading file');expect(downloads).toBe(0);cases.push({name:'wrong_metadata_identity',...metrics()});}finally{state.wrongItem=false;}
reset();try{await expect(streamReading(userId,sessionId,new Request('https://coast-reading-context.invalid/file',{headers:{Range:'bytes=0-1,3-4'}}))).rejects.toMatchObject({status:400});expect(downloads).toBe(0);cases.push({name:'invalid_multi_range',...metrics()});}finally{}
for(const status of [416,500]){
 reset();state.downloadStatus=status;try{const response=await streamReading(userId,sessionId,request());expect(response.status).toBe(status===416?416:502);expect(cancelledBodies).toBe(1);expect(await response.text()).toBe('Reading file unavailable.');cases.push({name:`download_${status}`,...metrics()});}finally{state.downloadStatus=206;}
}
reset();const abort=new AbortController();abort.abort();await expect(streamReading(userId,sessionId,new Request('https://coast-reading-context.invalid/file',{signal:abort.signal}))).rejects.toMatchObject({name:'AbortError'});expect(selects).toEqual({});expect(metadata).toBe(0);expect(downloads).toBe(0);cases.push({name:'already_aborted',...metrics()});
console.log(JSON.stringify({boundary:'Controlled supplementary correctness and local owner call-count probe; no actual database, credential, file or provider was used.',expectedContexts,cases}));
