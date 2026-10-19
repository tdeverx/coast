import { compileModule } from 'svelte/compiler';
import ts from 'typescript';

export const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
export const svelteUrl = import.meta.resolve('svelte');
export function eraseTypeScript(source: string) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText;
}
export function compileRunes(source: string, filename = 'fixture.svelte.js') {
  // Bare reads inside effects declare dependencies. Erase types without the
  // syntax folding that can remove those reads before Svelte sees them.
  const javascript = eraseTypeScript(source);
  return compileModule(javascript, { filename, generate: 'client' }).js.code
    .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'));
}
export async function componentScript(path: string) {
  const component = await Bun.file(new URL(`../../${path}`, import.meta.url)).text();
  // Standalone script controls have no enclosing Shelf retention owner.
  const retention=component.includes("import { useRetention }")||component.includes("import {useRetention}")?'const useRetention=()=>()=>()=>{};\n':'';
  return retention+component.match(/<script lang="ts">([\s\S]*?)<\/script>/)![1]
    .replace(/^\s*import[\s\S]*?from ['"][^'"]+['"];?/gm, '');
}
export const resourceUrl = moduleUrl(compileRunes(await Bun.file(new URL('../../src/lib/ui/resource.svelte.ts', import.meta.url)).text()));
