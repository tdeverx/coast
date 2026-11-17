import { getContext, setContext } from 'svelte';
import { actionFeedback, feedbackForViewer, createFeedback, type Feedback, type FailureSource } from './action-feedback.svelte';
import { api, change, changeMany, createApiClient, type ApiTransport } from './client';

const key = Symbol('Coast client');
type Client = { api: typeof api; change: typeof change; changeMany: typeof changeMany; fetch: ApiTransport; preview: boolean; feedback:Feedback };
type FeedbackScope = 'component' | 'current-viewer';
export function useClient(scope: FeedbackScope = 'component'): Client {
  return getContext<Client>(key) ?? { api, change, changeMany, fetch: (input, init) => fetch(input, init),
    preview: false, feedback: scope === 'current-viewer' ? actionFeedback : feedbackForViewer() };
}
export function providePreviewClient(transport: ApiTransport) {
  const client = { ...createApiClient(transport, async () => {}), fetch: transport, preview: true, feedback:createFeedback() };
  setContext<Client>(key, client);
  return client;
}

export function reportFailure(read:()=>FailureSource,retry?:()=>unknown,scope?:FeedbackScope) { useClient(scope).feedback.watch(read,retry); }

/** Failed module imports may remain rejected for this document's module map. */
export function reportImportFailure(read:()=>string|null|undefined,scope?:FeedbackScope) {
  const {feedback,preview}=useClient(scope);
  feedback.watch(()=>({text:read(),actionLabel:'Reload page',retry:()=>{
    if(!preview&&read()?.trim())window.location.reload();
  }}));
}
