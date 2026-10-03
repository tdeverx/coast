import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
const source = await Bun.file(new URL('../src/lib/ui/operation.svelte.ts', import.meta.url)).text();
const messages = `data:text/javascript;base64,${Buffer.from('export const message = cause => cause.message;').toString('base64')}`;
const compiled = compileModule(new Bun.Transpiler({ loader: 'ts' }).transformSync(source), { filename: 'operation.svelte.js', generate: 'client' }).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client')).replaceAll('./client', messages);
const { createOperation }: typeof import('../src/lib/ui/operation.svelte') = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('duplicate submission is suppressed until delivery finishes', async () => {
  const operation = createOperation();
  let complete!: () => void, deliveries = 0;
  const pending = operation.run(async () => { deliveries++; await new Promise<void>(resolve => complete = resolve); });
  expect(operation.busy).toBe(true);
  expect(await operation.run(async () => { deliveries++; })).toBe(false);
  complete();
  expect(await pending).toBe(true);
  expect(deliveries).toBe(1);
  expect(operation.busy).toBe(false);
});
test('failure releases the operation and a successful retry clears its error', async () => {
  const operation = createOperation();
  expect(await operation.run(async () => { throw new Error('Unavailable'); })).toBe(false);
  expect(operation.error).toBe('Unavailable');
  expect(operation.busy).toBe(false);
  expect(await operation.run(async () => {})).toBe(true);
  expect(operation.error).toBe('');
});
