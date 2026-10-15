import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from './errors';

/** Import bootstrap, interactive delivery, live observations, background maintenance. */
export type RequestPriority = 0 | 1 | 2 | 3;
type Entry = { interval: number; priority: RequestPriority; jobId?: string; resource?: string; enqueued: number; run: () => Promise<void>; signal?: AbortSignal; cancel: () => void };
type Lane = { busy: boolean; active?: boolean; entries: Entry[]; next: number; urgent: number; wake?: () => void };
type State = { context: AsyncLocalStorage<RequestPriority>; lanes: Map<string,Lane>; cleanup?: ReturnType<typeof setTimeout> };
export const providerRequestLimits = { perOrigin: 128, overall: 512, urgentPerOrigin: 8, urgentOverall: 32 } as const;
export class ProviderQueueBusyError extends AppError {
  constructor() { super(503, 'Coast is busy contacting connected services. Try again shortly.', 'provider_queue_busy'); this.name = 'ProviderQueueBusyError'; }
}
const key = Symbol.for('coast.provider-request-lanes');
const shared = globalThis as typeof globalThis & { [key]?: State };
const state: State = shared[key] ??= { context: new AsyncLocalStorage<RequestPriority>(), lanes: new Map() };
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

/** Active operations and waiting entries both own one global admission slot.
 * Background/live work leaves eight waiting slots per origin and 32 global
 * slots for bootstrap/interactive callers. Promotion never creates a new slot. */
export function providerRequestMetrics() {
  let outstanding = 0, waiting = 0;
  for (const lane of state.lanes.values()) {
    waiting += lane.entries.length;
    outstanding += lane.entries.length + (lane.active ? 1 : 0);
  }
  return { providerOutstanding: outstanding, providerWaiting: waiting, providerOrigins: state.lanes.size };
}
function cleanupLanes() {
  if (state.cleanup) clearTimeout(state.cleanup);
  state.cleanup = undefined;
  let next = Infinity;
  const now = Date.now();
  for (const [origin,lane] of state.lanes) {
    if (lane.busy || lane.entries.length) continue;
    if (lane.next <= now) state.lanes.delete(origin);
    else next = Math.min(next,lane.next);
  }
  if (next !== Infinity) {
    state.cleanup = setTimeout(cleanupLanes, Math.min(2_147_483_647, Math.max(1,next-now)));
    state.cleanup.unref();
  }
}
const entryPriority = (entry: Entry) => Math.min(entry.priority,
  entry.jobId ? jobPriorities.get(entry.jobId) ?? 3 : 3,
  entry.resource ? resourcePriorities.get(entry.resource) ?? 3 : 3);

/** One request at a time per service origin; priority is reconsidered between requests. */
export function queueProviderRequest<T>(origin: string, interval: number, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const lane = state.lanes.get(origin) ?? {busy:false,active:false,entries:[],next:0,urgent:0};
  const urgent = currentRequestPriority() <= 1;
  if (lane.entries.length >= providerRequestLimits.perOrigin - (urgent ? 0 : providerRequestLimits.urgentPerOrigin)
    || providerRequestMetrics().providerOutstanding >= providerRequestLimits.overall - (urgent ? 0 : providerRequestLimits.urgentOverall))
    return Promise.reject(new ProviderQueueBusyError());
  state.lanes.set(origin,lane);
  const resume=AsyncLocalStorage.snapshot();
  return new Promise<T>((resolve,reject) => {
    const cancel = () => {
      const index=lane.entries.indexOf(entry);
      if(index<0)return;
      lane.entries.splice(index,1);
      signal?.removeEventListener('abort',cancel);
      reject(signal?.reason ?? new Error('Request cancelled.'));
      if(!lane.entries.length)lane.wake?.();
    };
    const entry:Entry = {interval,priority:state.context.getStore()??1,jobId:providerJob.getStore(),resource:providerResource.getStore(),enqueued:Date.now(),signal,cancel,run:async()=>{
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
          while(lane.entries.length && lane.next>Date.now())await new Promise<void>(resolve=>{
            const finish=()=>{clearTimeout(timer);lane.wake=undefined;resolve();};
            const timer=setTimeout(finish,Math.min(2_147_483_647,lane.next-Date.now()));
            lane.wake=finish;
          });
          if(!lane.entries.length)break;
          // After eight urgent calls, let the oldest waiting call make progress.
          const oldest=lane.entries.reduce((a,b)=>a.enqueued<=b.enqueued?a:b);
          const selected=lane.urgent>=8 || Date.now()-oldest.enqueued>=30_000 ? oldest : lane.entries.reduce((a,b)=>entryPriority(a)<=entryPriority(b)?a:b);
          lane.entries.splice(lane.entries.indexOf(selected),1);
          lane.urgent=selected===oldest?0:lane.urgent+1;
          if(selected.jobId)jobWait.set(selected.jobId,(jobWait.get(selected.jobId)??0)+Math.max(0,Date.now()-selected.enqueued));
          lane.active=true;
          try { await selected.run(); }
          finally { lane.active=false; }
          lane.next=Math.max(lane.next,Date.now()+selected.interval);
        }
      } finally {lane.busy=false; cleanupLanes();}
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
