import { onDestroy, untrack, type Snippet } from 'svelte';
import { message } from './client';

export type FailureSource = string | null | undefined | {text:string|null|undefined;retry?:()=>unknown;actionLabel?:string};

type ActionNotice = {
  text: string; kind: 'info' | 'error'; undo?: () => Promise<void>; retry?: () => unknown; actionLabel?:string;
  busy: boolean; error: string; owner?: symbol;
};
export const temporaryFeedback = (notice: ActionNotice) => notice.kind === 'info' && !notice.owner && !notice.undo;
/** One delivery channel per client scope. Preview clients never publish into the application. */
export function createFeedback() {
  const state = $state<{ notices: ActionNotice[]; hosts: string[]; notifications?: Snippet }>({ notices: [], hosts: [] });
  const current = () => state.notices.at(-1) ?? null;
  function publish(notice: ActionNotice) {
    state.notices = [...state.notices.filter(value => value.owner !== notice.owner ||
      !notice.owner && (value.kind !== notice.kind || !!value.undo !== !!notice.undo)), notice];
  }
  function notify(text: string, undo?: () => Promise<void>) { publish({ text, undo, kind: 'info', busy: false, error: '' }); }
  function pending(text: string, owner: symbol) { publish({ text, owner, kind: 'info', busy: true, error: '' }); }
  function failure(text: string, retry?: () => unknown, owner?: symbol, actionLabel?:string) { publish({ text, retry, owner, actionLabel, kind: 'error', busy: false, error: '' }); }
  function clear(owner?: symbol) {
    if (owner) state.notices = state.notices.filter(value => value.owner !== owner);
    else state.notices = state.notices.slice(0, -1);
  }
  function clearAll() { state.notices = []; }
  async function act() {
    const notice = current();
    if (!notice || notice.busy || !(notice.undo || notice.retry)) return;
    notice.busy = true;
    try {
      const result = await (notice.undo ?? notice.retry)!();
      if (result !== false) {
        const wasCurrent = current() === notice;
        // Watched operations own their error lifetime. A retry that returns the
        // same failure must not silently dismiss it (including SSR refreshes).
        if (notice.undo || !notice.owner) state.notices = state.notices.filter(value => value !== notice);
        if (notice.undo && wasCurrent) notify('Change undone.');
      }
    } catch (cause) { notice.error = message(cause); }
    finally { notice.busy = false; }
  }
  function watch(read: () => FailureSource, retry?: () => unknown) {
    const owner = Symbol('operation feedback');
    let previous = '';
    $effect(() => {
      const source = read();
      const text = (source && typeof source === 'object' ? source.text : source)?.trim() ?? '';
      const attempt = source && typeof source === 'object' ? source.retry : retry;
      const actionLabel = source && typeof source === 'object' ? source.actionLabel : undefined;
      untrack(() => {
        if (text && text !== previous) failure(text, attempt, owner, actionLabel);
        else if (!text) clear(owner);
        else {
          const notice = state.notices.find(value => value.owner === owner);
          if (notice) { notice.retry = attempt; notice.actionLabel = actionLabel; }
        }
        previous = text;
      });
    });
    onDestroy(() => clear(owner));
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
    notify, pending, failure, clear, clearAll, act, watch, host, showNotifications };
}
export type Feedback = ReturnType<typeof createFeedback>;
export const actionFeedback = createFeedback();
export const notifyAction = actionFeedback.notify;
