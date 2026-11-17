import { expect, test } from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import { compileRunes, componentScript, moduleUrl, resourceUrl, svelteUrl } from './fixtures/ui-script';

const streamScript = (await componentScript('src/lib/ui/components/StreamsPanel.svelte'))
  .replace(/let \{open=\$bindable\(false\)[\s\S]+?\}=\$props\(\);/, "let open=$state(true),onclose,isAdmin=true,initialView='now';");
const streamCode = compileRunes(`import {untrack} from ${JSON.stringify(svelteUrl)};
 import {createResource} from ${JSON.stringify(resourceUrl)};
 export function create(transport){
 const callbacks=[],clocks=[],reportFailure=()=>{},useClient=()=>({api:transport,feedback:{notify:()=>{},failure:()=>{}}}),onDestroy=fn=>callbacks.push(fn),setContext=()=>{};
 const useClock=(precision,enabled)=>{clocks.push({precision,enabled});return {};};
 ${streamScript}
 return {refresh,clocks,close(){open=false;},history(){view='history';},get busy(){return resource.busy;},cleanup(){callbacks.forEach(fn=>fn());}};
 }`);
const { create: createStreams } = await import(moduleUrl(streamCode));
const operationUrl = moduleUrl(compileRunes((await Bun.file(new URL('../src/lib/ui/operation.svelte.ts', import.meta.url)).text())
  .replace("import { message } from './client';", 'const message=error=>error.message;')));
const noticeScript = (await componentScript('src/lib/ui/components/NotificationInbox.svelte'))
  .replace("let {open=$bindable(false),initialKind='all',initialFilters,onclose}:{open:boolean;initialKind?:string;initialFilters?:NotificationFilters;onclose?:()=>void}=$props();", "let open=$state(true),initialKind='all',initialFilters,onclose;");
const noticeCode = compileRunes(`import {untrack} from ${JSON.stringify(svelteUrl)};
 import {createResource,uniqueItems} from ${JSON.stringify(resourceUrl)};
 import {createOperation} from ${JSON.stringify(operationUrl)};
 import {notificationKinds,defaultNotificationFilters} from ${JSON.stringify(import.meta.resolve('../src/lib/notifications/model'))};
 export function create(transport){
 const callbacks=[],reportFailure=()=>{},useClock=()=>({now:0}),useClient=()=>({api:transport,change:transport,preview:false}),onDestroy=fn=>callbacks.push(fn);
 ${noticeScript}
 return {act,markAll,detail,close(){open=false;},get busy(){return resource.busy;},cleanup(){callbacks.forEach(fn=>fn());}};
 }`);
const { create: createInbox } = await import(moduleUrl(noticeCode));
const friendsScript=(await componentScript('src/lib/ui/components/FriendsPanel.svelte'))
  .replace(/let \{open=\$bindable\(false\)[\s\S]+?\}=\$props\(\);/, "let open=$state(true),onclose,initialView='accepted';");
const friendsCode=compileRunes(`import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 import {createResource} from ${JSON.stringify(resourceUrl)};
 export function create(transport){
  const callbacks=[],reportFailure=()=>{},useClient=()=>({api:transport}),onDestroy=fn=>callbacks.push(fn);
  const page={data:{user:{id:'viewer'}}},useClock=()=>({now:0}),syncedPlayer={},message=error=>error.message;
  ${friendsScript}
  return {choose(next){segment=next;},close(){open=false;},get roster(){return roster.data;},cleanup(){callbacks.forEach(fn=>fn());}};
 }`);
const {create:createFriends}=await import(moduleUrl(friendsCode));

const connectionScript=(await componentScript('src/lib/ui/components/ConnectionCard.svelte'))
  .replace(/let \{[\s\S]+?\} = \$props\(\);/, 'let provider=$state(initial);');
const connectionCode=compileRunes(`import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 import {createResource} from ${JSON.stringify(resourceUrl)};
 export function create(initial,transport){
  const reportFailure=()=>{},useClient=()=>({api:transport,feedback:{notify:()=>{}}});
  ${connectionScript}
  return {setProvider(next){provider=next;},get scan(){return scan;},get error(){return scanStatus.error;}};
 }`);
const {create:createConnection}=await import(moduleUrl(connectionCode));
const settle = async () => { for (let i=0;i<6;i++) { runtime.flush(); await Promise.resolve(); } };

test('closed Streams and Notification owners cannot start refresh reads after an accepted mutation completes', async () => {
  const oldDocument=globalThis.document;
  globalThis.document={hidden:false,visibilityState:'visible'} as Document;
  try {
    for (const kind of ['streams','notification','mark-all']) {
      for (let cycle=0;cycle<3;cycle++) {
        const requests: {path:string;method:string;signal?:AbortSignal}[]=[];
        let finish!:(result:unknown)=>void,controller:any;
        const transport=(path:string,_body:unknown,method='POST',options?:{signal:AbortSignal})=>{
          requests.push({path,method,signal:options?.signal});
          if (method==='POST') return new Promise(resolve=>finish=resolve);
          return Promise.resolve(kind==='streams'
            ? {streams:[],issues:[],checkedAt:null,nextCursor:null,view:'now'}
            : {items:[],hasMore:false,next:null,unread:0,snapshot:''});
        };
        const dispose=runtime.effect_root(()=>controller=kind==='streams'?createStreams(transport):createInbox(transport));
        try {
          await settle();
          const action=kind==='streams'?controller.refresh():kind==='mark-all'?controller.markAll():controller.act({id:'synthetic'},'read');
          expect(requests.map(request=>request.method)).toEqual(['GET','POST']);
          controller.close();runtime.flush();controller.cleanup();dispose();
          finish({queued:1,needsAttention:0,unavailable:0});await action;await settle();
          expect(requests.map(request=>request.method)).toEqual(['GET','POST']);
          expect(controller.busy).toBe(false);
        } finally {controller.cleanup();dispose();}
      }
    }
  } finally {globalThis.document=oldDocument;}
});

test('Streams subscribes only to the minute clock while History is shown', () => {
  let controller:any;
  const dispose=runtime.effect_root(()=>controller=createStreams(()=>Promise.resolve({streams:[],issues:[],checkedAt:null,nextCursor:null,view:'now'})));
  try {
    const [clock]=controller.clocks;
    expect(clock.precision).toBe('minute');expect(clock.enabled()).toBe(false);
    controller.history();expect(clock.enabled()).toBe(true);
    controller.close();expect(clock.enabled()).toBe(false);
  } finally {controller.cleanup();dispose();}
});

test('Friends cancels obsolete tab reads and requests live activity only for accepted friends',async()=>{
 const priorDocument=globalThis.document;
 globalThis.document={hidden:false} as Document;
 const requests:{path:string;signal:AbortSignal;resolve:(value:unknown)=>void}[]=[];
 let controller:any;
 const dispose=runtime.effect_root(()=>controller=createFriends((path:string,_body:unknown,_method:string,{signal}:{signal:AbortSignal})=>
  new Promise(resolve=>requests.push({path,signal,resolve}))));
 try{
  await settle();
  expect(requests.map(request=>request.path)).toEqual(['social/friends?state=accepted&page=1','social/checkins']);
  controller.choose('pending');
  await settle();
  expect(requests.slice(0,2).every(request=>request.signal.aborted)).toBe(true);
  expect(requests.map(request=>request.path)).toEqual(['social/friends?state=accepted&page=1','social/checkins','social/friends?state=pending&page=1']);
  controller.choose('invites');
  await settle();
  expect(requests[2].signal.aborted).toBe(true);
  requests.forEach(request=>request.resolve([{userId:'obsolete'}]));
  await settle();
  expect(controller.roster).toEqual([]);
  expect(requests).toHaveLength(3);
 }finally{controller.cleanup();dispose();globalThis.document=priorDocument;}
});

test('Jellyfin scan polling belongs to the current connected account generation',async()=>{
 const oldDocument=globalThis.document;
 const listeners=new Set<()=>void>();
 globalThis.document={hidden:false,addEventListener:(_type:string,fn:()=>void)=>listeners.add(fn),
  removeEventListener:(_type:string,fn:()=>void)=>listeners.delete(fn)} as unknown as Document;
 const requests:{path:string;signal:AbortSignal;resolve:(value:unknown)=>void}[]=[];
 const provider=(id:string,generation:string)=>({provider:'jellyfin',connection:{id,status:'connected',
  settings:{},accountGeneration:generation}});
 let controller:any;
 const dispose=runtime.effect_root(()=>controller=createConnection({provider:'jellyfin',connection:null},
  (path:string,_body:unknown,_method:string,{signal}:{signal:AbortSignal})=>new Promise(resolve=>requests.push({path,signal,resolve}))));
 try{
  await settle();
  expect(requests).toHaveLength(0);
  expect(listeners.size).toBe(0);
  controller.setProvider(provider('source','first'));
  await settle();
  expect(requests[0].path).toBe('providers/source/scan');
  expect(listeners.size).toBe(1);
  controller.setProvider(provider('source','first'));
  await settle();
  expect(requests).toHaveLength(1);
  controller.setProvider(provider('source','second'));
  await settle();
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests).toHaveLength(2);
  requests[0].resolve({state:'running',processed:50,total:60});
  await settle();
  expect(controller.scan).toBeNull();
  requests[1].resolve({state:'succeeded'});
  await settle();
  expect(controller.scan.state).toBe('succeeded');
  controller.setProvider({provider:'jellyfin',connection:null});
  await settle();
  expect(controller.scan).toBeNull();
  expect(controller.error).toBe('');
  expect(listeners.size).toBe(0);
 }finally{dispose();globalThis.document=oldDocument;}
});

test('friendship notifications retain the description from their originating action',()=>{
 let controller:any;
 const dispose=runtime.effect_root(()=>controller=createInbox(async()=>({items:[],hasMore:false,next:null,unread:0,snapshot:''})));
 try{
  expect(controller.detail({kind:'friend-accepted',title:'Your invitee joined Coast'})).toBe('Your invitee joined Coast');
  expect(controller.detail({kind:'friend-accepted',title:'Friend request accepted'})).toBe('Friend request accepted');
 }finally{controller.cleanup();dispose();}
});
