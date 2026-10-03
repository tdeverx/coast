import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
import type { MediaActionData } from '../src/lib/media/actions';
import type { MediaView } from '../src/lib/ui/types';
import type { RequestDestination } from '../src/lib/media/requests';
import type { api } from '../src/lib/ui/client';

const source = await Bun.file(new URL('../src/lib/ui/controls/requests.svelte.ts', import.meta.url)).text();
const messageModule = `data:text/javascript;base64,${Buffer.from('export const message = error => error.message;').toString('base64')}`;
const compiled = compileModule(new Bun.Transpiler({loader: 'ts'}).transformSync(source), {filename: 'requests.svelte.js', generate: 'client'}).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'))
  .replaceAll('$lib/ui/client', messageModule);
const { createRequestControls }: typeof import('../src/lib/ui/controls/requests.svelte') = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const item: MediaView = {id:'movie', kind:'movie', title:'Movie', tmdbId:'1', available:false, progress:0, duration:0, watched:false, playCount:0, watchlist:false, favourite:false, collected:false, dropped:false, rating:null};
const data = {requests: [], requestsEnabled: true} as unknown as MediaActionData;

test('request menus load lazily, deduplicate reads and reject superseded delivery', async () => {
  const deliveries: ((value: {destinations: RequestDestination[]}) => void)[] = [];
  const request = createRequestControls({ item: () => item, data: () => data,
    api: (() => new Promise<{destinations: RequestDestination[]}>(resolve => deliveries.push(resolve))) as typeof api, onrequest: () => () => {} });
  expect(deliveries).toHaveLength(0);
  const stale = request.loadRequestOptions();
  await request.loadRequestOptions();
  expect(deliveries).toHaveLength(1);
  request.resetOptions();
  const fresh = request.loadRequestOptions();
  deliveries[0]({destinations: [{id: 'stale'} as unknown as RequestDestination]});
  await stale;
  expect(request.requestOptions).toBeUndefined();
  deliveries[1]({destinations: []});
  await fresh;
  expect(request.requestOptions).toEqual([]);
  await request.loadRequestOptions();
  expect(deliveries).toHaveLength(2);
});

test('request failures allow targeted retry without losing the request intent', async () => {
  let calls = 0;
  let selected: {fourK?: boolean; destinations?: RequestDestination[]} | undefined;
  const request = createRequestControls({item: () => item, data: () => data,
    api: (async () => { if (++calls === 1) throw new Error('Source unavailable'); return {destinations: []}; }) as typeof api,
    onrequest: () => (fourK, destinations) => {selected = {fourK, destinations};} });
  await request.loadRequestOptions();
  expect(request.requestOptionsError).toBe('Source unavailable');
  await request.loadRequestOptions();
  expect(request.requestOptionsError).toBe('');
  request.openRequest(true);
  expect(selected).toEqual({fourK: true, destinations: []});
});
