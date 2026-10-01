import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';

const clientUrl = `data:text/javascript;base64,${Buffer.from(`
  export const calls = [];
  export let delivery = async () => {};
  export const setDelivery = (next, reset = true) => { if (reset) calls.length = 0; delivery = next; };
  export const change = async (path, payload) => { calls.push({ path, payload }); await delivery(); };
  export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  export const message = error => error.message;
`).toString('base64')}`;
const client = await import(clientUrl);
const source = await Bun.file(new URL('../src/lib/ui/shelves/episodes.svelte.ts', import.meta.url)).text();
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
const compiled = compileModule(javascript, { filename: 'episodes.svelte.js', generate: 'client' }).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'))
  .replaceAll('$lib/ui/client', clientUrl);
const { createEpisodeTracking }: typeof import('../src/lib/ui/shelves/episodes.svelte') =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('episode conflicts require an explicit acknowledgement of the original change', async () => {
  client.setDelivery(async () => { throw new client.ApiError('Review imported history first.', 409); });
  const controls = createEpisodeTracking();
  await controls.watch('episode-id', true);
  expect(controls.confirm).toBe(true);
  expect(controls.warning).toBe('Review imported history first.');
  expect(controls.error).toBe('');
  expect(client.calls[0].payload).toEqual({ mediaId: 'episode-id', action: 'unwatch', acknowledged: false });
  client.setDelivery(async () => {}, false);
  await controls.approve();
  expect(client.calls[1].payload).toEqual({ mediaId: 'episode-id', action: 'unwatch', acknowledged: true });
  expect(controls.confirm).toBe(false);
  await controls.approve();
  expect(client.calls).toHaveLength(2);
});

test('busy episode controls suppress duplicate writes and recover from delivery failure', async () => {
  let reject!: (error: Error) => void;
  client.setDelivery(() => new Promise((_resolve, fail) => { reject = fail; }));
  const controls = createEpisodeTracking();
  const delivery = controls.watch('episode-id', false);
  expect(controls.busy).toBe(true);
  await controls.watch('episode-id', false);
  expect(client.calls).toHaveLength(1);
  reject(new Error('Provider unavailable'));
  await delivery;
  expect(controls.busy).toBe(false);
  expect(controls.error).toBe('Provider unavailable');
  expect(controls.confirm).toBe(false);
  client.setDelivery(async () => {}, false);
  await controls.watch('episode-id', false);
  expect(controls.error).toBe('');
  expect(client.calls[1].payload.action).toBe('watch');
});
