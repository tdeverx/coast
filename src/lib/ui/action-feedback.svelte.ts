import { onDestroy, untrack, type Snippet } from 'svelte';
import { api, message, refreshAfterChange } from './client';
import { page } from '$app/state';
import { createFeedbackNotifications, type FeedbackRecord } from './controls/feedback-notifications';

export type FailureSource = string | null | undefined | {text:string|null|undefined;retry?:()=>unknown;actionLabel?:string};

type ActionNotice = {
  id:string; text: string; kind: 'info' | 'error'; undo?: () => Promise<void>; retry?: () => unknown; actionLabel?:string;
  busy: boolean; error: string; owner?: symbol;viewerId?:string;
};
export const temporaryFeedback = (notice: ActionNotice) => notice.kind === 'info' && !notice.owner && !notice.undo;
/** One delivery channel per client scope. Preview clients never publish into the application. */
export function createFeedback(record?:(notice:FeedbackRecord,viewerId?:string)=>void,viewer?:()=>string|undefined) {
  const state = $state<{ notices: ActionNotice[]; hosts: string[]; notifications?: Snippet }>({ notices: [], hosts: [] });
  const current = () => {
    const viewerId = viewer?.();
    return state.notices.findLast(notice => notice.viewerId === viewerId) ?? null;
  };
  function publish(input: Omit<ActionNotice,'id'>,persist=true) {
    const viewerId = viewer?.();
    const previous = input.owner ? state.notices.find(value => value.viewerId === viewerId && value.owner === input.owner) : undefined;
    const notice = {...input, id: previous?.id ?? crypto.randomUUID(), viewerId};
    state.notices = [...state.notices.filter(value => value.viewerId !== viewerId || value.owner !== notice.owner ||
      !notice.owner && (value.kind !== notice.kind || !!value.undo !== !!notice.undo)), notice];
    if(persist)record?.({id:notice.id,text:notice.text,kind:notice.kind,pending:notice.busy},notice.viewerId);
  }
  function notify(text: string, undo?: () => Promise<void>) { publish({ text, undo, kind: 'info', busy: false, error: '' }); }
  function pending(text: string, owner: symbol) { publish({ text, owner, kind: 'info', busy: true, error: '' }); }
  function failure(text: string, retry?: () => unknown, owner?: symbol, actionLabel?:string) { publish({ text, retry, owner, actionLabel, kind: 'error', busy: false, error: '' }); }
  function clear(owner?: symbol) {
    const viewerId = viewer?.();
    if (owner) state.notices = state.notices.filter(value => value.viewerId !== viewerId || value.owner !== owner);
    else {
      const notice = current();
      if (notice) state.notices = state.notices.filter(value => value !== notice);
    }
  }
  function clearAll({viewerId} = {viewerId: viewer?.()}) {
    state.notices = state.notices.filter(value => value.viewerId !== viewerId);
  }
  async function act() {
    const notice = current();
    if (!notice || notice.busy || !(notice.undo || notice.retry)) return;
    notice.busy = true;
    try {
      const result = await (notice.undo ?? notice.retry)!();
      if(viewer&&notice.viewerId!==viewer())return;
      if (result !== false) {
        const wasCurrent = current() === notice;
        // Watched operations own their error lifetime. A retry that returns the
        // same failure must not silently dismiss it (including SSR refreshes).
        if (notice.undo || !notice.owner) state.notices = state.notices.filter(value => value !== notice);
        if (notice.undo && wasCurrent) notify('Change undone.');
      }
    } catch (cause) {
      notice.error = message(cause);
      if(!viewer||notice.viewerId===viewer())record?.({id:notice.id,text:`${notice.text} ${notice.error}`,kind:'error',pending:false},notice.viewerId);
    }
    finally { notice.busy = false; }
  }
  function watch(read: () => FailureSource, retry?: () => unknown) {
    const owner = Symbol('operation feedback');
    let previous = '', previousViewer = untrack(() => viewer?.());
    $effect(() => {
      const viewerId = viewer?.();
      const source = read();
      const text = (source && typeof source === 'object' ? source.text : source)?.trim() ?? '';
      const attempt = source && typeof source === 'object' ? source.retry : retry;
      const actionLabel = source && typeof source === 'object' ? source.actionLabel : undefined;
      untrack(() => {
        if (text && text !== previous) failure(text, attempt, owner, actionLabel);
        else if (!text) clear(owner);
        else if (viewerId === previousViewer) {
          const notice = state.notices.find(value => value.viewerId === viewerId && value.owner === owner);
          if (notice) { notice.retry = attempt; notice.actionLabel = actionLabel; }
        }
        previous = text;
        previousViewer = viewerId;
      });
    });
    onDestroy(() => { state.notices = state.notices.filter(value => value.owner !== owner); });
  }
  function host(id: string) {
    untrack(() => { state.hosts = [...state.hosts.filter(value => value !== id), id]; });
    return () => { state.hosts = state.hosts.filter(value => value !== id); };
  }
  function showNotifications(render: Snippet) {
    state.notifications = render;
    return () => { if (state.notifications === render) state.notifications = undefined; };
  }
  return { get current() { return current(); },
    get activeHost() { return state.hosts.at(-1) ?? null; },
    get notifications() { return state.notifications; },
    notify, pending, failure, clear, clearAll, act, watch, host, showNotifications,
    recordingFailure(retry:()=>Promise<boolean>,owner:symbol,full=false){publish({text:full?'Notification backlog is full. Some feedback could not be retained. Retry pending notifications.':'Some notifications could not be saved. Retry to keep them in your inbox.',kind:'error',busy:false,error:'',retry,owner},false);},
    recording:undefined as ReturnType<typeof createFeedbackNotifications>|undefined };
}
export type Feedback = ReturnType<typeof createFeedback>;
const recordingOwner=Symbol('feedback inbox persistence');
const recording=createFeedbackNotifications({
  viewer:()=>page.data.user?.id,
  save:(viewerId,notices,signal)=>api('notifications/feedback',{viewerId,notices},'POST',{signal}),
  failure:(retry,full)=>actionFeedback.recordingFailure(retry,recordingOwner,full),
  recovered:()=>actionFeedback.clear(recordingOwner),
  changed:()=>refreshAfterChange('notifications'),
  online:retry=>{if(typeof window==='undefined')return()=>{};window.addEventListener('online',retry);return()=>window.removeEventListener('online',retry);},
});
export const actionFeedback = createFeedback((notice,viewerId)=>{if(viewerId&&viewerId===page.data.user?.id)recording.record(notice);},()=>page.data.user?.id);
actionFeedback.recording=recording;
/** Async component continuations keep their original viewer's feedback authority. */
export function feedbackForViewer(viewerId=page.data.user?.id):Feedback{
  const active=()=>page.data.user?.id===viewerId;
  const guarded=new Set(['notify','pending','failure','clear','act','recordingFailure']);
  return new Proxy(actionFeedback,{get(target,key){
    // A keyed host can retire after the current viewer has already changed.
    if(key==='clearAll')return()=>target.clearAll({viewerId});
    if(key==='watch')return(read:()=>FailureSource,retry?:()=>unknown)=>target.watch(()=>active()?read():undefined,retry);
    const value=Reflect.get(target,key,target);
    if(guarded.has(String(key))&&typeof value==='function')return(...args:unknown[])=>{if(active())return Reflect.apply(value,target,args);};
    if(!active()&&['current','activeHost','notifications','recording'].includes(String(key)))return key==='current'||key==='activeHost'?null:undefined;
    return value;
  }});
}
export const notifyAction = actionFeedback.notify;
