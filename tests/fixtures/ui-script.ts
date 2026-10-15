import { compileModule } from 'svelte/compiler';

export const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
export const svelteUrl = import.meta.resolve('svelte');
export function compileRunes(source: string, filename = 'fixture.svelte.js') {
  return compileModule(new Bun.Transpiler({ loader: 'ts' }).transformSync(source), { filename, generate: 'client' }).js.code
    .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'));
}
export async function componentScript(path: string) {
  const component = await Bun.file(new URL(`../../${path}`, import.meta.url)).text();
  return component.match(/<script lang="ts">([\s\S]*?)<\/script>/)![1]
    .replace(/^\s*import[\s\S]*?from ['"][^'"]+['"];?/gm, '');
}
export const resourceUrl = moduleUrl(compileRunes(await Bun.file(new URL('../../src/lib/ui/resource.svelte.ts', import.meta.url)).text()));
