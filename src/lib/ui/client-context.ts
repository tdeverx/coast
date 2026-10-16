import { getContext, setContext } from 'svelte';
import { api, change, createApiClient, type ApiTransport } from './client';

const key = Symbol('Coast client');
type Client = { api: typeof api; change: typeof change; fetch: ApiTransport; preview: boolean };
export function useClient(): Client { return getContext<Client>(key) ?? { api, change, fetch: (input, init) => fetch(input, init), preview: false }; }
export function providePreviewClient(transport: ApiTransport) {
  setContext<Client>(key, { ...createApiClient(transport, async () => {}), fetch: transport, preview: true });
}
