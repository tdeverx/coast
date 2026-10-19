import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
import type { MediaActionData } from '../src/lib/media/actions';
import type { MediaView } from '../src/lib/ui/types';
import type { RequestDestination } from '../src/lib/media/requests';
import type { api } from '../src/lib/ui/client';
import { requestOptionsUrl } from './fixtures/request-options';

const source = await Bun.file(new URL('../src/lib/ui/controls/requests.svelte.ts', import.meta.url)).text();
const messageModule = `data:text/javascript;base64,${Buffer.from('export const message = error => error.message;').toString('base64')}`;
const compiled = compileModule(new Bun.Transpiler({loader: 'ts'}).transformSync(source), {filename: 'requests.svelte.js', generate: 'client'}).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'))
  .replaceAll('$lib/ui/client', messageModule)
  .replaceAll('$lib/media/requests', import.meta.resolve('../src/lib/media/requests'))
  .replaceAll('./request-options.svelte', requestOptionsUrl);
const controlsUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
const { createRequestControls }: typeof import('../src/lib/ui/controls/requests.svelte') = await import(controlsUrl);
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

test('request scope formatter follows a replaced snapshot and stays stable within it', async () => {
  const fixture = compileModule(`
    import {createRequestControls} from ${JSON.stringify(controlsUrl)};
    export function snapshot(initial) {
      let data = $state.raw(initial);
      const controls = createRequestControls({item: () => null, data: () => data,
        api: async () => {throw Error('unexpected request');}, onrequest: () => () => {}});
      return {controls, replace(value) {data = value;}};
    }
  `, {filename: 'request-snapshot.svelte.js', generate: 'client'}).js.code
    .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'));
  const {snapshot} = await import(`data:text/javascript;base64,${Buffer.from(fixture).toString('base64')}`);
  const first = {id: 'first', destination: 'A', seasons: [], is4k: false};
  const owner = snapshot({requests: [first], requestsEnabled: true});
  const original = owner.controls.scopeLabel;
  expect(owner.controls.scopeLabel).toBe(original);
  expect(original(first)).toBe('Standard version');
  owner.replace({requests: [first, {...first, id: 'second', destination: 'B'}], requestsEnabled: true});
  expect(owner.controls.scopeLabel).not.toBe(original);
  expect(owner.controls.scopeLabel(first)).toBe('Standard version · A');
  expect(original(first)).toBe('Standard version');
  owner.replace({requests: [], requestsEnabled: true});
  expect(owner.controls.scopeLabel(first)).toBe('Standard version');
});
