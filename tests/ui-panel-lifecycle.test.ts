import { expect, test } from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import { compileRunes, componentScript, moduleUrl, resourceUrl, svelteUrl } from './fixtures/ui-script';

const streamScript = (await componentScript('src/lib/ui/components/StreamsPanel.svelte'))
  .replace('let {open=$bindable(false),onclose}:{open:boolean;onclose?:()=>void}=$props();', 'let open=$state(true),onclose;');
const streamCode = compileRunes(`import {untrack} from ${JSON.stringify(svelteUrl)};
 import {createResource} from ${JSON.stringify(resourceUrl)};
 export function create(transport){
 const callbacks=[],clocks=[],useClient=()=>({api:transport}),onDestroy=fn=>callbacks.push(fn),setContext=()=>{};
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
 const callbacks=[],useClient=()=>({api:transport,change:transport,preview:false}),onDestroy=fn=>callbacks.push(fn);
 ${noticeScript}
 return {act,markAll,close(){open=false;},get busy(){return resource.busy;},cleanup(){callbacks.forEach(fn=>fn());}};
 }`);
const { create: createInbox } = await import(moduleUrl(noticeCode));
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
