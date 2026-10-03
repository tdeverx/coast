import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const client = moduleUrl('let deliver; export const configure = fn => deliver = fn; export const useClient = () => ({change: (...args) => deliver(...args)});');
const feedback = moduleUrl('export const notifyAction = () => {};');
const messages = moduleUrl('export const message = cause => cause.message;');
const { configure } = await import(client);
const source = await Bun.file(new URL('../src/lib/ui/controls/queue.svelte.ts', import.meta.url)).text();
const compiled = compileModule(new Bun.Transpiler({ loader: 'ts' }).transformSync(source), { filename: 'queue.svelte.js', generate: 'client' }).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'))
  .replaceAll('../client-context', client).replaceAll('../action-feedback.svelte', feedback).replaceAll('../client', messages);
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
