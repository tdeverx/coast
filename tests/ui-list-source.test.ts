import { expect, test } from 'bun:test';
// @ts-expect-error The rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import { compileRunes, moduleUrl, resourceUrl } from './fixtures/ui-script';

const routeUrl = moduleUrl(compileRunes(`export const page = $state({
  data: { user: { id: 'owner' }, contentRevision: { tracking: 0 } }, state: {}
});`));
const lifecycleUrl = moduleUrl(`
  export {untrack} from '${import.meta.resolve('svelte/internal/client')}';
  const callbacks=[];
  export const onDestroy=callback=>callbacks.push(callback);
  export const destroy=()=>callbacks.splice(0).forEach(callback=>callback());
`);
const clientUrl = moduleUrl(`
  export const requests=[];
  export const destinations=[];
  export const goto=url=>destinations.push(url);
  export const useShelfLocation=()=>({embedded:true});
  export const useClient=()=>({preview:false,api:path=>new Promise(resolve=>requests.push({path,resolve}))});
  export const message=error=>error.message;
  export const contentRevisionKey=data=>data.contentRevision.tracking;
`);
const route = await import(routeUrl);
const lifecycle = await import(lifecycleUrl);
const client = await import(clientUrl);
const source = (await Bun.file(new URL('../src/lib/ui/shelves/list.svelte.ts', import.meta.url)).text())
  .replaceAll('#lib/ui/detail-section.svelte.js', clientUrl)
  .replaceAll('#lib/profile/url.js', import.meta.resolve('../src/lib/profile/url'))
  .replaceAll('$app/navigation', clientUrl).replaceAll('$app/state', routeUrl)
  .replaceAll('#lib/ui/client.js', clientUrl).replaceAll('#lib/ui/client-context.js', clientUrl)
  .replaceAll('#lib/ui/content-revision.svelte.js', clientUrl)
  .replaceAll('#lib/ui/resource.svelte.js', resourceUrl)
  .replaceAll("from 'svelte'", `from '${lifecycleUrl}'`);
const { createListSource }: typeof import('../src/lib/ui/shelves/list.svelte') =
  await import(moduleUrl(compileRunes(source)));
const settle = async () => {
  for (let turn = 0; turn < 8; turn++) {
    runtime.flush();
    await Promise.resolve();
  }
};
const result = (title: string) => ({ items: [{ id: title, kind: 'movie', title }], page: 1, pages: 1, total: 1, kind: 'all', filter: 'all' });

test('profile lists stay lazy, refresh membership and link to list management', async () => {
  let shelf!: ReturnType<typeof createListSource>;
  const dispose = runtime.effect_root(() => {
    shelf = createListSource(() => ({ view: 'custom-list', title: 'Custom', custom: true, layout: 'grid', profile: 'owner' }));
  });
  try {
    route.page.data.contentRevision.tracking++;
    await settle();
    expect(client.requests).toHaveLength(0);
    const first = shelf.load();
    client.requests[0].resolve(result('Before'));
    await first;
    expect(shelf.items.map(item => item.title)).toEqual(['Before']);
    route.page.data.contentRevision.tracking++;
    await settle();
    expect(client.requests).toHaveLength(2);
    client.requests[1].resolve(result('After'));
    await settle();
    expect(shelf.items.map(item => item.title)).toEqual(['After']);
    await shelf.actions?.find(action => action.label === 'Manage list')?.run();
    expect(client.destinations).toEqual(['/lists?view=custom-list']);
  } finally {
    lifecycle.destroy();
    dispose();
  }
});
