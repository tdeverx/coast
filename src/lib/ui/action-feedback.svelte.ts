import { onDestroy, untrack } from 'svelte';
import { message } from './client';

export type FailureSource = string | null | undefined | {text:string|null|undefined;retry?:()=>unknown};

type ActionNotice = {
  text: string; kind: 'info' | 'error'; undo?: () => Promise<void>; retry?: () => unknown;
  busy: boolean; error: string; owner?: symbol;
};
/** One delivery channel per client scope. Preview clients never publish into the application. */
export function createFeedback() {
  const state = $state<{ current: ActionNotice | null; hosts: string[] }>({ current: null, hosts: [] });
  function notify(text: string, undo?: () => Promise<void>) { state.current = { text, undo, kind: 'info', busy: false, error: '' }; }
  function failure(text: string, retry?: () => unknown, owner?: symbol) { state.current = { text, retry, owner, kind: 'error', busy: false, error: '' }; }
  function clear(owner?: symbol) { if (!owner || state.current?.owner === owner) state.current = null; }
  async function act() {
    const notice = state.current;
    if (!notice || notice.busy || !(notice.undo || notice.retry)) return;
    notice.busy = true;
    try {
      const result = await (notice.undo ?? notice.retry)!();
      if (state.current === notice && result !== false) {
        if (notice.undo) notify('Change undone.');
        // Watched operations own their error lifetime. A retry that returns the
        // same failure must not silently dismiss it (including SSR refreshes).
        else if (!notice.owner) clear();
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
      untrack(() => {
        if (text && text !== previous) failure(text, attempt, owner);
        else if (!text) clear(owner);
        else if (state.current?.owner === owner) state.current.retry = attempt;
        previous = text;
      });
    });
    onDestroy(() => clear(owner));
  }
  function host(id: string) {
    untrack(() => { state.hosts = [...state.hosts.filter(value => value !== id), id]; });
    return () => { state.hosts = state.hosts.filter(value => value !== id); };
  }
  return { get current() { return state.current; },
    get activeHost() { return state.hosts.at(-1) ?? null; }, notify, failure, clear, act, watch, host };
}
export type Feedback = ReturnType<typeof createFeedback>;
export const actionFeedback = createFeedback();
export const notifyAction = actionFeedback.notify;
