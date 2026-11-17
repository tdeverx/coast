import {expect,test} from 'bun:test';
const deferred=<T=unknown>()=>{let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const source=await Bun.file(new URL('../src/routes/share/+page.svelte',import.meta.url)).text();
const script=source.slice(source.indexOf('<script lang="ts">')+18,source.indexOf('</script>')).replace(/^\s*import .*;$/gm,'');
const compiled=new Bun.Transpiler({loader:'ts'}).transformSync('const reportFailure=()=>{}; class ApiError extends Error {constructor(message,status){super(message);this.status=status;}}'+script);
function route(options:{shared?:unknown;stop?:()=>Promise<void>;fetch?:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;attach?:(session:unknown,signal:AbortSignal)=>Promise<void>}={}){
 let mount!:()=>()=>void,tick!:()=>Promise<void>,authority=false,revision=0;
 const calls:{stops:string[];alignments:string[];plays:string[];signals:AbortSignal[];cleared:number;readings:string[];readingStops:string[];readingRetires:string[]}={stops:[],alignments:[],plays:[],signals:[],cleared:0,readings:[],readingStops:[],readingRetires:[]};
 const player={session:{id:'shared'}};
 const reader={session:null as {id:string}|null,visible:false};
 const create=new Function('onMount','untrack','$props','$state','stopPlayback','setPlaybackApi','fetch','alignPlayback','playMedia','player','setInterval','clearInterval','location','history','page','message','attachReading','closeReading','reader',compiled+';return {open,current:()=>shared,failure:()=>error};');
 const control=create((callback:typeof mount)=>mount=callback,(read:()=>unknown)=>read(),()=>({data:{shared:'shared' in options?options.shared:{workId:'work',together:true,host:false}}}),(value:unknown)=>value,
  ()=>{calls.stops.push(player.session.id);return options.stop?.()??Promise.resolve();},
  (shared:boolean)=>{const own=++revision;authority=shared;return ()=>{if(own===revision)authority=false;};},
  (input:RequestInfo|URL,init?:RequestInit)=>{calls.signals.push(init!.signal as AbortSignal);return options.fetch?.(input,init)??Promise.resolve(Response.json({workId:'work',together:true,host:false,paused:true,positionSeconds:10,durationSeconds:100,updatedAt:new Date().toISOString()}));},
  ()=>calls.alignments.push(player.session.id),(id:string)=>{calls.plays.push(id);return Promise.resolve();},player,
  (callback:typeof tick)=>{tick=callback;return 1;},()=>calls.cleared++,{hash:'',pathname:'/share',search:''},{},{url:new URL('https://fixture.invalid/share')},(cause:Error)=>cause.message,
  async(session:{id:string},signal:AbortSignal)=>{calls.readings.push(session.id);if(!signal.aborted&&options.attach)await options.attach(session,signal);if(signal.aborted)calls.readingRetires.push(session.id);else reader.session=session;},
  async()=>{if(reader.session)calls.readingStops.push(reader.session.id);reader.session=null;},reader);
 const cleanup=mount();
 return {...control,cleanup,tick:()=>tick(),calls,player,reader,get authority(){return authority;}};
}
for(const failed of [false,true])test(`disposed share poll ${failed?'failure':'success'} cannot control successor playback`,async()=>{
 const response=deferred<Response>(),fixture=route({fetch:()=>response.promise});await settle();
 const pending=fixture.tick();expect(fixture.calls.signals).toHaveLength(1);fixture.cleanup();await settle();fixture.player.session={id:'successor'};
 expect(fixture.calls.signals[0].aborted).toBe(true);
 if(failed)response.reject(new Error('old request failed'));else response.resolve(Response.json({together:true,host:false,paused:true,positionSeconds:30,durationSeconds:100}));
 await pending;expect(fixture.calls.stops).toEqual(['shared','shared']);expect(fixture.calls.alignments).toEqual([]);expect(fixture.calls.cleared).toBe(1);expect(fixture.authority).toBe(false);
});
test('a mount preparation settling after disposal cannot reinstall share authority or open playback',async()=>{
 const stopped=deferred<void>();let count=0;
 const fixture=route({stop:()=>++count===1?stopped.promise:Promise.resolve()});
 const opening=fixture.open();fixture.cleanup();await settle();stopped.resolve();await opening;await settle();
 expect(fixture.authority).toBe(false);expect(fixture.calls.plays).toEqual([]);expect(fixture.calls.signals).toEqual([]);
});
test('active together polling stays single flight and aligns the existing player',async()=>{
 const response=deferred<Response>(),fixture=route({fetch:()=>response.promise});await settle();
 const pending=fixture.tick();await fixture.tick();expect(fixture.calls.signals).toHaveLength(1);
 response.resolve(Response.json({together:true,host:false,paused:true,positionSeconds:30,durationSeconds:100}));await pending;
 expect(fixture.calls.alignments).toEqual(['shared']);expect(fixture.authority).toBe(true);fixture.cleanup();await settle();expect(fixture.authority).toBe(false);
});
test('an invitation claim completing after disposal cannot fetch state or start playback',async()=>{
 const response=deferred<Response>(),fixture=route({shared:null,fetch:()=>response.promise});await settle();
 const opening=fixture.open();await settle();expect(fixture.calls.signals).toHaveLength(1);fixture.cleanup();
 response.resolve(Response.json({ok:true}));await opening;await settle();
 expect(fixture.calls.signals).toHaveLength(1);expect(fixture.calls.plays).toEqual([]);expect(fixture.authority).toBe(false);
});


test('an intermittent share status failure preserves playback and the next poll can recover',async()=>{
 const outcomes=[
  new Error('network unavailable'),
  new Response('<html>Gateway error</html>',{status:404}),
  Response.json({error:'Playback is currently unavailable.'},{status:503}),
  Response.json({workId:'work',together:true,host:false,paused:true,positionSeconds:30,durationSeconds:100}),
 ];
 const fixture=route({fetch:async()=>{
  const outcome=outcomes.shift();
  if(outcome instanceof Error)throw outcome;
  return outcome!;
 }});
 try{
  await settle();
  for(let index=0;index<4;index++)await fixture.tick();
  expect(fixture.calls.signals).toHaveLength(4);
  expect(fixture.calls.stops).toEqual(['shared']);
  expect(fixture.calls.alignments).toEqual(['shared']);
 }finally{fixture.cleanup();await settle();}
});

test('an explicitly revoked share stops playback and retires its status polling',async()=>{
 const fixture=route({fetch:async()=>Response.json({error:'This playback invitation has expired or was revoked.'},{status:410})});
 try{
  await settle();
  await fixture.tick();
  await fixture.tick();
  expect(fixture.calls.signals).toHaveLength(1);
  expect(fixture.calls.stops).toEqual(['shared','shared']);
  expect(fixture.calls.alignments).toEqual([]);
 }finally{fixture.cleanup();await settle();}
});

test('reading invitations use the scoped reader endpoint and revoke only their own session',async()=>{
 const paths:string[]=[],bodies:unknown[]=[];
 const fixture=route({shared:{workId:'book',mediaType:'reading'},fetch:async(input,init)=>{
  paths.push(String(input));bodies.push(init?.body);
  return String(input).endsWith('/reading')?Response.json({id:'shared-reader',shared:true,workId:'book',location:null,url:'/api/share/reading/shared-reader/file'}):Response.json({error:'Invitation revoked'},{status:410});
 }});
 try{
  await fixture.open();
  expect(paths).toEqual(['/api/share/reading']);expect(bodies).toEqual(['{}']);
  expect(fixture.calls.readings).toEqual(['shared-reader']);expect(fixture.calls.plays).toEqual([]);
  await fixture.open();expect(paths).toEqual(['/api/share/reading']);expect(fixture.reader.visible).toBe(true);
  await fixture.tick();await fixture.tick();
  expect(paths).toEqual(['/api/share/reading','/api/share/state']);
  expect(fixture.calls.readingStops).toEqual(['shared-reader']);
 }finally{fixture.cleanup();await settle();}
});

test('disposing a reading invitation aborts opening and cannot retire a successor reader',async()=>{
 const attached=deferred<void>();let signal:AbortSignal|undefined;
 const fixture=route({shared:{workId:'book',mediaType:'reading'},fetch:async()=>Response.json({id:'shared-reader',shared:true}),attach:async(_,value)=>{signal=value;await attached.promise;}});
 const opening=fixture.open();await settle();expect(signal).toBeDefined();
 fixture.cleanup();expect(signal!.aborted).toBe(true);
 fixture.reader.session={id:'successor'};attached.resolve();await opening;await settle();
 expect(fixture.reader.session?.id).toBe('successor');expect(fixture.calls.readingStops).toEqual([]);
});

test('reading invitation cleanup leaves a later reader untouched',async()=>{
 const fixture=route({shared:{workId:'book',mediaType:'reading'},fetch:async()=>Response.json({id:'shared-reader',shared:true})});
 await fixture.open();fixture.reader.session={id:'successor'};fixture.cleanup();await settle();
 expect(fixture.reader.session?.id).toBe('successor');expect(fixture.calls.readingStops).toEqual([]);
});

const shareActionSource=await Bun.file(new URL('../src/lib/sharing/ShareAction.svelte',import.meta.url)).text();
const shareActionScript=shareActionSource.slice(shareActionSource.indexOf('<script lang="ts">')+18,shareActionSource.indexOf('</script>')).replace(/^\s*import .*;$/gm,'');
const shareActionCompiled=new Bun.Transpiler({loader:'ts'}).transformSync(shareActionScript);
function sharingDialog(reading:boolean){
 const calls:{path:string;body:unknown}[]=[];let cleanup:(()=>void)|undefined;
 const api=async(path:string,body:unknown)=>{calls.push({path,body});return path.startsWith('sharing/sources')?[{id:'source',name:'Library'}]:{id:'link',token:'example',target:'website'};};
 const run=new Function('$props','$state','$derived','$effect','untrack','useClient','tick','reportFailure','publicSharePath','location','message',shareActionCompiled+';return {create};');
 const control=run(()=>({workId:'book',title:'Example',reading,target:'vrchat',open:true}),(value:unknown)=>value,(value:unknown)=>value,(effect:()=>()=>void)=>cleanup=effect(),(read:()=>unknown)=>read(),()=>({api,preview:true,change:async()=>{},feedback:{notify:()=>{}}}),async()=>{},()=>{},(token:string)=>`/share/${token}`,{origin:'https://fixture.invalid'},(cause:Error)=>cause.message);
 return {...control,calls,cleanup:()=>cleanup?.()};
}

test('a reading share captures website-only input and omits playback options',async()=>{
 const fixture=sharingDialog(true);await settle();await fixture.create({preventDefault(){}});fixture.cleanup();
 expect(fixture.calls[1]).toEqual({path:'sharing',body:{workId:'book',connectionId:'source',hours:6,target:'website'}});
});

test('a playback share retains the existing target, codec and progress options',async()=>{
 const fixture=sharingDialog(false);await settle();await fixture.create({preventDefault(){}});fixture.cleanup();
 expect(fixture.calls[1]).toEqual({path:'sharing',body:{workId:'book',connectionId:'source',hours:6,target:'vrchat',videoCodec:'h264',autoRevoke:false,trackProgress:false}});
});

test('revocation during reading preparation aborts and retires a late successful response',async()=>{
 const prepared=deferred<Response>();let signal:AbortSignal|undefined;
 const fixture=route({shared:{id:'grant',workId:'book',mediaType:'reading'},fetch:async(input,init)=>{
  if(String(input).endsWith('/reading')){signal=init?.signal as AbortSignal;return prepared.promise;}
  return Response.json({error:'Revoked'},{status:410});
 }});
 const opening=fixture.open();await settle();expect(signal).toBeDefined();
 await fixture.tick();expect(signal!.aborted).toBe(true);
 prepared.resolve(Response.json({id:'late-reader',shared:true}));await opening;
 expect(fixture.reader.session).toBeNull();expect(fixture.calls.readingRetires).toEqual(['late-reader']);
 expect(fixture.current()).toBeNull();fixture.cleanup();await settle();
});

test('revocation during reading attachment cannot reopen the retired invitation',async()=>{
 const attached=deferred<void>();let signal:AbortSignal|undefined;
 const fixture=route({shared:{id:'grant',workId:'book',mediaType:'reading'},fetch:async(input)=>String(input).endsWith('/reading')?Response.json({id:'late-reader',shared:true}):Response.json({error:'Revoked'},{status:401}),attach:async(_,value)=>{signal=value;await attached.promise;}});
 const opening=fixture.open();await settle();await fixture.tick();
 expect(signal!.aborted).toBe(true);attached.resolve();await opening;
 expect(fixture.reader.session).toBeNull();expect(fixture.calls.readingRetires).toEqual(['late-reader']);
 fixture.cleanup();await settle();
});

test('an old state response cannot restore a grant rejected by reading preparation',async()=>{
 const state=deferred<Response>();
 const fixture=route({shared:{id:'grant',workId:'book',mediaType:'reading'},fetch:async(input)=>String(input).endsWith('/state')?state.promise:Response.json({error:'Expired'},{status:410})});
 const polling=fixture.tick();await fixture.open();expect(fixture.current()).toBeNull();
 state.resolve(Response.json({id:'grant',workId:'book',mediaType:'reading'}));await polling;
 expect(fixture.current()).toBeNull();expect(fixture.calls.readings).toEqual([]);fixture.cleanup();await settle();
});

test('cancelled reading preparation keeps the actionable expiry message from its status poll',async()=>{
 const fixture=route({shared:{id:'grant',workId:'book',mediaType:'reading'},fetch:async(input,init)=>{
  if(String(input).endsWith('/reading'))return new Promise((_,reject)=>{const signal=init?.signal as AbortSignal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  return Response.json({error:'Invitation expired'},{status:410});
 }});
 const opening=fixture.open();await settle();await fixture.tick();await opening;
 expect(fixture.failure()).toBe('Invitation expired');expect(fixture.current()).toBeNull();fixture.cleanup();await settle();
});

test('reading status closes permanently withdrawn sources but keeps transient failures and playback behavior',async()=>{
 for(const mediaType of ['reading','video'])for(const status of [403,404,409,503]){
  const fixture=route({shared:{id:'grant',workId:'book',mediaType},fetch:async(input)=>String(input).endsWith('/reading')?Response.json({id:'reader',shared:true}):Response.json({error:'Source unavailable'},{status})});
  try{
   await fixture.open();await fixture.tick();
   const ended=mediaType==='reading'&&status!==503;
   expect(fixture.current()===null).toBe(ended);
   expect(fixture.calls.readingStops).toEqual(ended?['reader']:[]);
   if(ended)expect(fixture.failure()).toBe('Source unavailable');
  }finally{fixture.cleanup();await settle();}
 }
});
