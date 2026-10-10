import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import type { SearchOptions } from '../src/lib/ui/shelves/search.svelte';
import type { ShelfItem } from '../src/lib/ui/shelves/types';

const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(await Bun.file(new URL('../src/lib/ui/shelves/search.svelte.ts', import.meta.url)).text());
const code = compileModule(source, { filename: 'search.svelte.js', generate: 'client' }).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'))
  .replaceAll('from "svelte"', `from ${JSON.stringify(import.meta.resolve('svelte'))}`)
  .replaceAll('$app/state', moduleUrl('export const page={data:{}};'))
  .replaceAll('$lib/ui/client', moduleUrl('export const refreshRouteDependencies=async()=>{};'))
  .replaceAll('$lib/library', import.meta.resolve('../src/lib/library'))
  .replaceAll('$lib/ui/filter-options', import.meta.resolve('../src/lib/ui/filter-options'));
const { createSearchSource }: typeof import('../src/lib/ui/shelves/search.svelte') = await import(moduleUrl(code));

const items = (['movie', 'show', 'album', 'game', 'book', 'comic'] as const).flatMap(kind =>
  [true, false].map(available => ({ id: `${kind}-${available}`, kind, title: kind, available }) as ShelfItem));
test('search partitions every medium by verified availability and streams new items into the same rows', () => {
  let available!: ReturnType<typeof createSearchSource>, unavailable!: typeof available;
  const state = runtime.state({ query: 'fixture', items: items.slice(0, 4) });
  const dispose = runtime.effect_root(() => {
    available = createSearchSource(() => ({ ...runtime.get(state), bucket: 'available' }));
    unavailable = createSearchSource(() => ({ ...runtime.get(state), bucket: 'unavailable' }));
  });
  try {
    runtime.flush();
    expect(available.items).toHaveLength(2);
    runtime.set(state, { query: 'fixture', items }); runtime.flush();
    expect(available.items.map(item => item.id)).toEqual(items.filter(item => item.available).map(item => item.id));
    expect(unavailable.items.map(item => item.id)).toEqual(items.filter(item => !item.available).map(item => item.id));
    unavailable.filters[0].change('comic'); runtime.flush();
    expect(unavailable.items.map(item => item.id)).toEqual(['comic-false']);
    expect(unavailable.href).toBeUndefined();
  } finally { dispose(); }
});
test('shared type selection preserves the row layout and disabled medium gates', () => {
  let result!: ReturnType<typeof createSearchSource>;
  const state = runtime.state<SearchOptions>({ query: 'fixture', bucket: 'available', items, kind: 'book',
    mediums: { experimentalBooks: true, experimentalComics: false, experimentalMusic: false, experimentalGaming: false } });
  const dispose = runtime.effect_root(() => { result = createSearchSource(() => runtime.get(state)); });
  try {
    runtime.flush(); expect(result.items.map(item => item.id)).toEqual(['book-true']);
    expect(result.filters[0].options?.map(option => option.value)).toEqual(['all', 'movie', 'show', 'book']);
    result.filters[0].change('show'); runtime.flush();
    expect(result.items.map(item => item.id)).toEqual(['show-true']);
    expect(result.rows).toBe(1); expect(result.pagination.kind).toBe('local');
  } finally { dispose(); }
});
