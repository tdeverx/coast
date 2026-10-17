import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { load } from '../src/routes/ui-preview/+layout.server';
import { components, elements, composedComponents, referenceSection } from '../src/routes/ui-preview/catalog';
import manifest from '../src/lib/ui/component-manifest.json';
import { compositions, componentScenarios, dynamicOwners } from '../src/routes/ui-preview/reference';
import { renderedComponents, referenceDispatches, referenceRenderers, validateRecipeDispatches, validateReferenceCoverage } from '../scripts/ui-inventory';

function sourceFiles(directory:string):string[]{
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const path=`${directory}/${entry.name}`;
    return entry.isDirectory()?sourceFiles(path):[path];
  });
}
const files=sourceFiles(resolve('src')).map(path=>relative(process.cwd(),path));
const sourceViews=files.filter(path=>path.endsWith('.svelte')&&!path.startsWith('src/routes/ui-preview/'))
  .map(path=>({path,...renderedComponents(path,readFileSync(path,'utf8'))}));
const rendered=Object.fromEntries(sourceViews.map(view=>[view.path,view.rendered]));
const dynamicImports=Object.fromEntries(sourceViews.map(view=>[view.path,view.dynamicImports]));
const dispatches=Object.fromEntries(Object.values(referenceRenderers).map(path=>[path,referenceDispatches(readFileSync(path,'utf8'))]));
const reference=()=>({sources:files,components:manifest,recipes:compositions,componentScenarios,dynamicOwners,rendered,dynamicImports});

test('the reference catalog covers every component once across elements and components', () => {
  const files = readdirSync(new URL('../src/lib/ui/components/', import.meta.url))
    .filter(name => name.endsWith('.svelte')).map(name => name.slice(0, -7)).sort();
  expect(files).toEqual([...components].sort());
  const partition = [...elements, ...composedComponents];
  expect(files).toEqual(partition.sort());
  expect(new Set(partition).size).toBe(files.length);
  expect(referenceSection('materials')).toBe('materials');
  expect(referenceSection('charts')).toBe('charts');
  expect(referenceSection('invalid')).toBe('typography');
});

test('the permanent reference and its examples require an administrator', () => {
  const event = (user: { role: string } | null) => ({ locals: { user } }) as Parameters<NonNullable<typeof load>>[0];
  for (const user of [null, { role: 'user' }]) {
    let rejection: unknown;
    try { load(event(user)); } catch (error) { rejection = error; }
    expect(rejection).toMatchObject(user ? { status: 403 } : { status: 303, location: '/login?next=/ui-preview' });
  }
  expect(load(event({ role: 'admin' }))).toBeUndefined();
});

test('explicit reference recipes account for every production route and feature-owned Svelte file',()=>{
  const coverage=validateReferenceCoverage(reference());
  expect(coverage.compositions).toBe(compositions.length);
  expect(coverage.internal).toBe(10);
  expect(coverage.delegated).toBe(9);
  expect(coverage.owners).toBeGreaterThan(Object.keys(manifest).length);
});

test('reference validation rejects duplicate identities, scenario drift and missing source paths',()=>{
  expect(()=>validateReferenceCoverage({...reference(),recipes:[...compositions,compositions[0]]})).toThrow('duplicate reference ID');
  const duplicateScenario={...compositions[0],scenarios:['normal','normal']};
  expect(()=>validateReferenceCoverage({...reference(),recipes:[duplicateScenario,...compositions.slice(1)]})).toThrow('duplicate reference scenarios');
  expect(()=>validateReferenceCoverage({...reference(),componentScenarios:{...componentScenarios,Button:['default','default']}})).toThrow('duplicate reference scenarios');
  expect(()=>validateReferenceCoverage({...reference(),componentScenarios:{UnknownWidget:['default']}})).toThrow('Unknown component scenario owner');
  const absentSource={...compositions[0],sources:['src/lib/nonexistent-preview-owner.svelte']};
  expect(()=>validateReferenceCoverage({...reference(),recipes:[absentSource,...compositions.slice(1)]})).toThrow('Reference source does not exist');
});

test('dynamic declarations and thin routes cannot silently lose their concrete owners',()=>{
  expect(()=>validateReferenceCoverage({...reference(),dynamicOwners:{'src/routes/no-such-route/+page.svelte':['src/lib/reading/Reader.svelte']}})).toThrow('Reference source does not exist');
  expect(()=>validateReferenceCoverage({...reference(),dynamicOwners:{'src/routes/+layout.svelte':['src/lib/reading/AbsentReader.svelte']}})).toThrow('Reference source does not exist');
  expect(()=>validateReferenceCoverage({...reference(),rendered:{...rendered,'src/routes/media/[id]/+page.svelte':[]}})).toThrow('no longer delegates');
  expect(()=>validateReferenceCoverage({...reference(),dynamicImports:{...dynamicImports,'src/routes/+layout.svelte':[]}})).toThrow('Declared dynamic reference import is absent');
});

test('new feature or route UI must declare reference ownership instead of escaping the flat inventory',()=>{
  for(const path of ['src/lib/new-feature/Unrepresented.svelte','src/routes/unrepresented/+page.svelte']){
    expect(()=>validateReferenceCoverage({...reference(),sources:[...files,path]})).toThrow(path);
  }
});

test('every composition has a real name dispatch in its selected renderer',()=>{
  expect(()=>validateRecipeDispatches(compositions,dispatches)).not.toThrow();
  const wrongFamily={...compositions[0],family:'admin' as const};
  expect(()=>validateRecipeDispatches([wrongFamily],dispatches)).toThrow('Missing reference renderer dispatch');
  const admin=compositions.find(item=>item.family==='admin')!;
  expect(()=>validateRecipeDispatches([{...admin,example:'misspelled-example'}],dispatches)).toThrow('Missing reference renderer dispatch');
  expect(()=>validateRecipeDispatches([{...compositions[0],id:'catalogue.missing'}],dispatches)).toThrow('Missing reference renderer dispatch');
  expect(referenceDispatches("<script>let {name}=$props();</script>{#if name === 'first' || 'second' === name}<p>Example</p>{/if}")).toEqual(['first','second']);
});

test('dynamic import evidence excludes TypeScript-only imports',()=>{
  const source="<script lang='ts'>let Reader: typeof import('$lib/reading/Reader.svelte').default; const open=()=>import('$lib/media/DetailPanel.svelte');</script>";
  expect(renderedComponents('src/routes/+layout.svelte',source).dynamicImports).toEqual(['src/lib/media/DetailPanel.svelte']);
});
