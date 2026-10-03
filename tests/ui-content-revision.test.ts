import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';

const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
function compile(source: string) {
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
  return compileModule(javascript, { filename: 'content-revision.svelte.js', generate: 'client' }).js.code
    .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'));
}
const source = await Bun.file(new URL('../src/lib/ui/content-revision.svelte.ts', import.meta.url)).text();
const revisionUrl = moduleUrl(compile(source));
const { contentRevisionKey, invalidateContentRevision, readContentRevision }: typeof import('../src/lib/ui/content-revision.svelte') = await import(revisionUrl);
test('session-only polls preserve refresh identity while provider, viewer and local social changes invalidate it', () => {
  const original = { user: { id: 'viewer' }, contentRevision: { tracking: 't1', social: 's1', planning: 'p1' }, expiresAt: 'initial' };
  const key = contentRevisionKey(original, ['tracking', 'social']);
  for (const expiresAt of ['poll1', 'poll2'])
    expect(contentRevisionKey({ ...original, user: { id: 'viewer' }, expiresAt }, ['tracking', 'social'])).toBe(key);
  expect(contentRevisionKey({ ...original, contentRevision: { ...original.contentRevision, planning: 'p2' } }, ['tracking', 'social'])).toBe(key);
  expect(contentRevisionKey({ ...original, contentRevision: { ...original.contentRevision, tracking: 'provider-change' } }, ['tracking', 'social'])).not.toBe(key);
  expect(contentRevisionKey({ ...original, user: { id: 'another-viewer' } }, ['tracking', 'social'])).not.toBe(key);
  invalidateContentRevision(['social']);
  expect(contentRevisionKey(original, ['tracking', 'social'])).not.toBe(key);
});

test('explicit domain refreshes leave unrelated keys stable and signed-out sessions have a distinct identity', () => {
  const data = { user: { id: 'viewer' }, contentRevision: { tracking: 't1', social: 's1', planning: 'p1' } };
  const tracking = contentRevisionKey(data, ['tracking']);
  const planning = contentRevisionKey(data, ['planning']);
  const previous = readContentRevision('social');
  invalidateContentRevision(['social', 'social']);
  expect(readContentRevision('social')).toBe(previous + 1);
  expect(contentRevisionKey(data, ['tracking'])).toBe(tracking);
  expect(contentRevisionKey(data, ['planning'])).toBe(planning);
  expect(contentRevisionKey({ ...data, user: null }, ['tracking'])).not.toBe(tracking);
});
