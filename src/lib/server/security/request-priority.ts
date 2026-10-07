import { AsyncLocalStorage } from 'node:async_hooks';

/** Import bootstrap, interactive delivery, live observations, background maintenance. */
export type RequestPriority = 0 | 1 | 2 | 3;
type Entry = { priority: RequestPriority; jobId?: string; resource?: string; enqueued: number; run: () => Promise<void>; signal?: AbortSignal; cancel: () => void };
type Lane = { busy: boolean; entries: Entry[]; next: number; urgent: number };
const key = Symbol.for('coast.provider-request-lanes');
const shared = globalThis as typeof globalThis & { [key]?: { context: AsyncLocalStorage<RequestPriority>; lanes: Map<string,Lane> } };
const state: { context: AsyncLocalStorage<RequestPriority>; lanes: Map<string,Lane> } = shared[key] ??= { context: new AsyncLocalStorage<RequestPriority>(), lanes: new Map() };
export const requestPriority = state.context;
export const providerJob = new AsyncLocalStorage<string>();
export const providerResource = new AsyncLocalStorage<string>();
const resourcePriorities = new Map<string, RequestPriority>();
const jobPriorities = new Map<string, RequestPriority>();
const jobWait = new Map<string, number>();
export function registerJobRequestPriority(id: string, priority: RequestPriority) { jobPriorities.set(id, priority); }
export function updateJobRequestPriority(id: string, priority: RequestPriority) {
  const current=jobPriorities.get(id);
  if(current!==undefined)jobPriorities.set(id,Math.min(current,priority) as RequestPriority);
}
export function releaseJobRequestPriority(id: string) {
  const wait = jobWait.get(id) ?? 0;
  jobPriorities.delete(id); jobWait.delete(id);
  return wait;
}
export function currentRequestPriority(): RequestPriority {
  const job=providerJob.getStore(), resource=providerResource.getStore();
  return Math.min(requestPriority.getStore()??1,job?jobPriorities.get(job)??3:3,resource?resourcePriorities.get(resource)??3:3) as RequestPriority;
}
export function registerResourcePriority(key: string) { resourcePriorities.set(key,currentRequestPriority()); }
export function promoteResourcePriority(key: string) {
  if(resourcePriorities.has(key))resourcePriorities.set(key,Math.min(resourcePriorities.get(key)!,currentRequestPriority()) as RequestPriority);
}
export function releaseResourcePriority(key: string) { resourcePriorities.delete(key); }

/** One request at a time per service origin; priority is reconsidered between requests. */
export function queueProviderRequest<T>(origin: string, interval: number, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const lane = state.lanes.get(origin) ?? {busy:false,entries:[],next:0,urgent:0};
  state.lanes.set(origin,lane);
  const resume=AsyncLocalStorage.snapshot();
  return new Promise<T>((resolve,reject) => {
    const cancel = () => { const index=lane.entries.indexOf(entry); if(index>=0){lane.entries.splice(index,1);reject(signal?.reason ?? new Error('Request cancelled.'));} };
    const entry:Entry = {priority:state.context.getStore()??1,jobId:providerJob.getStore(),resource:providerResource.getStore(),enqueued:Date.now(),signal,cancel,run:async()=>{
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
          const priority = (entry: Entry) => Math.min(entry.priority, entry.jobId ? jobPriorities.get(entry.jobId) ?? 3 : 3, entry.resource ? resourcePriorities.get(entry.resource) ?? 3 : 3);
          const selected=lane.urgent>=8 || Date.now()-oldest.enqueued>=30_000 ? oldest : lane.entries.reduce((a,b)=>priority(a)<=priority(b)?a:b);
          lane.entries.splice(lane.entries.indexOf(selected),1);
          lane.urgent=selected===oldest?0:lane.urgent+1;
          if(selected.jobId)jobWait.set(selected.jobId,(jobWait.get(selected.jobId)??0)+Math.max(0,Date.now()-selected.enqueued));
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
