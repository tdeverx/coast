import { getContext, setContext } from 'svelte';
import { api, change, createApiClient, type ApiTransport } from './client';

const key = Symbol('Coast client');
type Client = { api: typeof api; change: typeof change; preview: boolean };
export function useClient(): Client { return getContext<Client>(key) ?? { api, change, preview: false }; }
export function providePreviewClient(transport: ApiTransport) {
  setContext<Client>(key, { ...createApiClient(transport, async () => {}), preview: true });
}
