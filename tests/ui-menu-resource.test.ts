import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
const url = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function rune(path: string, replacements: Record<string, string> = {}) {
  let code = compileModule(new Bun.Transpiler({ loader: 'ts' }).transformSync(await Bun.file(new URL(path, import.meta.url)).text()), { filename: path.split('/').at(-1)!.replace('.ts', '.js'), generate: 'client' }).js.code
    .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'));
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(from, to);
  return url(code);
}
const resource = await rune('../src/lib/ui/resource.svelte.ts');
const { createMenuResource }: typeof import('../src/lib/ui/controls/menu-resource.svelte') = await import(await rune('../src/lib/ui/controls/menu-resource.svelte.ts', { '../resource.svelte': resource }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => resolve = done); return { promise, resolve }; }

test('menus single-flight cold reads and reuse an unchanged snapshot on reopen', async () => {
  let reads = 0;
  const held = deferred<string>();
  const menu = createMenuResource(() => '', () => 'viewer:work:revision', () => { reads++; return held.promise; });
  expect(reads).toBe(0);
  const first = menu.open(), second = menu.load();
  expect(reads).toBe(1); expect(first).toBe(second);
  held.resolve('loaded'); await first;
  menu.close(); await menu.open();
  expect(menu.data).toBe('loaded'); expect(reads).toBe(1);
});
test('closing aborts optional reads; late delivery cannot replace a reopened menu', async () => {
  const held = [deferred<string>(), deferred<string>()]; const signals: AbortSignal[] = [];
  const menu = createMenuResource(() => '', () => 'one', signal => { signals.push(signal); return held[signals.length - 1].promise; });
  const first = menu.open(); menu.close(); const second = menu.open();
  expect(signals[0].aborted).toBe(true);
  held[0].resolve('stale'); await first; expect(menu.data).toBe(''); expect(menu.busy).toBe(true);
  held[1].resolve('fresh'); await second; expect(menu.data).toBe('fresh');
});
test('changed viewer/occurrence/revision rejects a response before the next reactive effect', async () => {
  let scope = 'viewer:work:entry-a:revision-1'; const held = deferred<string>();
  const menu = createMenuResource(() => '', () => scope, () => held.promise);
  const read = menu.open(); scope = 'viewer:work:entry-b:revision-1'; held.resolve('wrong occurrence'); await read;
  expect(menu.data).toBe(''); expect(menu.busy).toBe(false);
});
test('a changed scope fences an old failure before reactive cancellation runs', async () => {
  let scope='old', reject!: (reason:Error)=>void;
  const failure=new Promise<string>((_,fail)=>reject=fail);
  const menu=createMenuResource(()=>'',()=>scope,()=>failure);
  const read=menu.open();scope='new';reject(new Error('Private old error'));await read;
  expect(menu.error).toBe('');
});
test('a stale request ignoring abort cannot cancel its replacement after a scope change', async () => {
  let scope = 'old'; const old = deferred<string>(), fresh = deferred<string>();
  const menu = createMenuResource(() => '', () => scope, () => scope === 'old' ? old.promise : fresh.promise);
  const first = menu.open(); scope = 'new'; const second = menu.load();
  old.resolve('late old'); await first; expect(menu.busy).toBe(true);
  fresh.resolve('new snapshot'); await second; expect(menu.data).toBe('new snapshot');
});
test('closed mutation refresh waits for demand; disposal is terminal', async () => {
  let reads = 0;
  const menu = createMenuResource(() => '', () => 'scope', async () => String(++reads));
  await menu.open(); menu.close(); await menu.refresh(); expect(reads).toBe(1);
  await menu.open(); expect(menu.data).toBe('2');
  menu.dispose(); await menu.refresh(); await menu.open(); expect(reads).toBe(2);
});
test('failed optional reads retain usable state and allow an explicit retry', async () => {
  let reads = 0;
  const menu = createMenuResource(() => '', () => 'scope', async () => { if (++reads === 2) throw new Error('Unavailable'); return String(reads); });
  await menu.open(); await menu.load(true); expect(menu.data).toBe('1'); expect(menu.error).toBe('Unavailable');
  await menu.load(true); expect(menu.error).toBe(''); expect(menu.data).toBe('3');
});
test('an acknowledged field patch does not turn a pending snapshot into complete empty state', async () => {
  const held = [deferred<{ rating: number | null; game: string | null }>(), deferred<{ rating: number | null; game: string | null }>()];
  const signals: AbortSignal[] = [];
  const menu = createMenuResource(() => ({ rating: null as number | null, game: null as string | null }), () => 'scope', signal => {
    signals.push(signal);
    return held[signals.length - 1].promise;
  });
  const first = menu.open();
  menu.patch(data => ({ ...data, rating: 5 }));
  expect(signals[0].aborted).toBe(true);
  expect(signals).toHaveLength(2);
  expect(menu.busy).toBe(true);
  const current = menu.load();
  held[0].resolve({ rating: null, game: 'stale' });
  await first;
  held[1].resolve({ rating: 5, game: 'selected playthrough' });
  await current;
  menu.close();
  await menu.open();
  expect(menu.data).toEqual({ rating: 5, game: 'selected playthrough' });
  expect(signals).toHaveLength(2);
});
test('replacing a pending snapshot releases its single-flight promise immediately', async () => {
  const held = deferred<string>();
  const menu = createMenuResource(() => '', () => 'scope', () => held.promise);
  const pending = menu.open();
  menu.replace('authoritative replacement');
  expect(await menu.load()).toBe('authoritative replacement');
  held.resolve('stale');
  await pending;
  expect(menu.data).toBe('authoritative replacement');
});

const notices = url('export const values=[]; export function notifyAction(text){values.push(text);}');
const operations = await rune('../src/lib/ui/operation.svelte.ts', { './client': url('export const message = e => e.message;') });
const { createMutation }: typeof import('../src/lib/ui/mutation.svelte') = await import(await rune('../src/lib/ui/mutation.svelte.ts', { './operation.svelte': operations, './action-feedback.svelte': notices }));
test('accepted mutations stay successful when local menu refresh fails', async () => {
  let writes = 0;
  const mutation = createMutation(async () => { throw new Error('Refresh failure'); });
  expect(await mutation.run(async () => { writes++; }, 'Saved once.')).toBe(true);
  expect(writes).toBe(1); expect(mutation.error).toContain('Saved.');
  expect((await import(notices)).values).toContain('Saved once.');
});
test('failed commands never trigger refresh or success feedback', async () => {
  let refreshes = 0;
  const mutation = createMutation(async () => { refreshes++; });
  expect(await mutation.run(async () => { throw new Error('Rejected'); })).toBe(false);
  expect(refreshes).toBe(0); expect(mutation.error).toBe('Rejected');
});
