import { AsyncLocalStorage } from 'node:async_hooks';

/** Import bootstrap, interactive delivery, live observations, background maintenance. */
export type RequestPriority = 0 | 1 | 2 | 3;
type Entry = { priority: RequestPriority; enqueued: number; run: () => Promise<void>; signal?: AbortSignal; cancel: () => void };
type Lane = { busy: boolean; entries: Entry[]; next: number; urgent: number };
const key = Symbol.for('coast.provider-request-lanes');
const shared = globalThis as typeof globalThis & { [key]?: { context: AsyncLocalStorage<RequestPriority>; lanes: Map<string,Lane> } };
const state: { context: AsyncLocalStorage<RequestPriority>; lanes: Map<string,Lane> } = shared[key] ??= { context: new AsyncLocalStorage<RequestPriority>(), lanes: new Map() };
export const requestPriority = state.context;

/** One request at a time per service origin; priority is reconsidered between requests. */
export function queueProviderRequest<T>(origin: string, interval: number, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const lane = state.lanes.get(origin) ?? {busy:false,entries:[],next:0,urgent:0};
  state.lanes.set(origin,lane);
  const resume=AsyncLocalStorage.snapshot();
  return new Promise<T>((resolve,reject) => {
    const cancel = () => { const index=lane.entries.indexOf(entry); if(index>=0){lane.entries.splice(index,1);reject(signal?.reason ?? new Error('Request cancelled.'));} };
    const entry:Entry = {priority:state.context.getStore()??1,enqueued:Date.now(),signal,cancel,run:async()=>{
      signal?.removeEventListener('abort',cancel);
      if(signal?.aborted){reject(signal.reason);return;}
      try {resolve(await resume(operation));}catch(error){reject(error);}
    }};
    lane.entries.push(entry);
    signal?.addEventListener('abort',cancel,{once:true});
    const drain=async()=>{
      if(lane.busy)return;
      lane.busy=true;
      try {
        while(lane.entries.length){
          const wait=lane.next-Date.now();
          if(wait>0)await new Promise(r=>setTimeout(r,wait));
          if(!lane.entries.length)break;
          // After eight urgent calls, let the oldest waiting call make progress.
          const oldest=lane.entries.reduce((a,b)=>a.enqueued<=b.enqueued?a:b);
          const selected=lane.urgent>=8 || Date.now()-oldest.enqueued>=30_000 ? oldest : lane.entries.reduce((a,b)=>a.priority<=b.priority?a:b);
          lane.entries.splice(lane.entries.indexOf(selected),1);
          lane.urgent=selected===oldest?0:lane.urgent+1;
          await selected.run();
          lane.next=Math.max(lane.next,Date.now()+interval);
        }
      } finally {lane.busy=false; if(!lane.entries.length && lane.next<=Date.now())state.lanes.delete(origin);}
    };
    void drain();
  });
}

export function deferProviderRequests(origin:string,delay:number){
 const lane=state.lanes.get(origin);
 if(lane)lane.next=Math.max(lane.next,Date.now()+Math.max(0,delay));
}
export function retryAfterSeconds(value:string|null):number|null{
 if(!value)return null;
 const seconds=/^\d+$/.test(value)?Number(value):(Date.parse(value)-Date.now())/1000;
 return Number.isFinite(seconds)?Math.max(0,Math.ceil(seconds)):null;
}
