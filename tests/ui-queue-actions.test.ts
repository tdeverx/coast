import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const client = moduleUrl('let deliver, feedback; export const configure = (fn, notify = () => {}) => { deliver = fn; feedback = {notify}; }; export const useClient = () => ({change: (...args) => deliver(...args), feedback});');
const messages = moduleUrl('export const message = cause => cause.message;');
const { configure } = await import(client);
const source = await Bun.file(new URL('../src/lib/ui/controls/queue.svelte.ts', import.meta.url)).text();
const compiled = compileModule(new Bun.Transpiler({ loader: 'ts' }).transformSync(source), { filename: 'queue.svelte.js', generate: 'client' }).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'))
  .replaceAll('../client-context', client).replaceAll('../client', messages);
const { createQueueActions }: typeof import('../src/lib/ui/controls/queue.svelte') = await import(moduleUrl(compiled));
test('queue retries guard the same entry without blocking another entry', async () => {
  let complete!: () => void;
  const deliveries: string[] = [];
  configure(async (path: string) => { deliveries.push(path); if(path==='queue/first/retry') await new Promise<void>(resolve=>complete=resolve); });
  const queue = createQueueActions();
  const pending = queue.run('first','retry');
  expect(queue.busy('first')).toBe(true);
  expect(await queue.run('first','retry')).toBe(false);
  expect(await queue.run('second','cancel')).toBe(true);
  expect(queue.busy('first')).toBe(true);
  complete(); await pending;
  expect(queue.busy('first')).toBe(false);
  expect(deliveries).toEqual(['queue/first/retry','queue/second/cancel']);
});
test('a failed queue action releases its entry for targeted retry', async () => {
  let calls=0;
  configure(async () => { if(!calls++) throw Error('Service unavailable'); });
  const queue=createQueueActions();
  expect(await queue.run('entry','retry')).toBe(false);
  expect(queue.error).toBe('Service unavailable');
  expect(queue.busy('entry')).toBe(false);
  expect(await queue.run('entry','retry')).toBe(true);
  expect(queue.error).toBe('');
});
test('queue completion uses its captured client feedback scope, including after another client opens', async () => {
  const application: string[] = [], preview: string[] = [];
  let complete!: () => void;
  configure(() => new Promise<void>(resolve => complete = resolve), (text: string) => application.push(text));
  const realQueue = createQueueActions(), pending = realQueue.run('actual', 'retry');
  configure(async () => {}, (text: string) => preview.push(text));
  const previewQueue = createQueueActions();
  expect(await previewQueue.run('preview', 'promote')).toBe(true);
  expect(application).toEqual([]);
  expect(preview).toEqual(['Job prioritized. Service cooldowns still apply.']);
  complete();
  expect(await pending).toBe(true);
  expect(application).toEqual(['Job queued for retry.']);
  expect(preview).toHaveLength(1);
  configure(async () => { throw Error('Unavailable'); }, (text: string) => preview.push(text));
  expect(await createQueueActions().run('failed', 'cancel')).toBe(false);
  expect(preview).toHaveLength(1);
});
