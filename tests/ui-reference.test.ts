import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { load } from '../src/routes/ui-preview/+layout.server';
import { referenceEntries, referenceHref, referenceSection, resolveReference } from '../src/routes/ui-preview/catalog';
import { standard, variantGroups, variantProps, visibleProps } from '../src/routes/ui-preview/item-controls';
import { contracts } from '../src/routes/ui-preview/props';
import manifest from '../src/lib/ui/component-manifest.json';
import { referenceRecipes, componentScenarios, dynamicOwners, scenarios } from '../src/routes/ui-preview/reference';
import { renderedComponents, referenceDispatches, referenceRenderers, internalReferenceOwners, validateRecipeDispatches, validateReferenceCoverage } from '../scripts/ui-inventory';

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
const reference=()=>({sources:files,components:manifest,recipes:referenceRecipes,componentScenarios,dynamicOwners,rendered,dynamicImports});

test('each named variant is selectable exactly once and quick controls reference real props', () => {
  for (const entry of referenceEntries) {
    const contract=contracts[entry.id];
    const options=variantGroups(entry,!!contract).flatMap(group=>group.options);
    expect(options.filter(option=>option.id!==standard).map(option=>option.id).sort())
      .toEqual(entry.states.map(state=>state.id).sort());
    expect(new Set(options.map(option=>option.id)).size).toBe(options.length);
    if (!contract) continue;
    const keys=contract.props.map(prop=>prop.name);
    for (const option of options) for (const key of Object.keys(variantProps(entry.id,option.id)??{})) expect(keys).toContain(key);
    for (const prop of visibleProps(entry.id,contract.props)) expect(keys).toContain(prop.name);
  }
  expect(variantProps('Button','pressed')).toEqual({pressed:true});
  expect(variantProps('MediaCard','catalogue.cards:rating')).toBeUndefined();
});

test('the browser lists each owner once and all specimen states resolve from owner and direct links', () => {
  const publicNames = readdirSync(new URL('../src/lib/ui/components/', import.meta.url))
    .filter(name => name.endsWith('.svelte') && !internalReferenceOwners[`src/lib/ui/components/${name}`]).map(name => name.slice(0, -7));
  const listed = referenceEntries.map(entry => entry.id);
  expect(new Set(listed).size).toBe(listed.length);
  for (const name of publicNames) expect(listed).toContain(resolveReference(name)!.entry.id);
  for (const id of [...publicNames, ...referenceRecipes.map(recipe => recipe.id)]) {
    for (const scenario of scenarios(id)) {
      const result = resolveReference(id, scenario)!;
      expect(listed).toContain(result.entry.id);
      const skeleton = id === 'ui.native' && scenario === 'skeletons';
      expect(result.state.reference).toBe(skeleton ? 'catalogue.rows' : id === 'SyncedControls' ? 'FriendsPanel' : id);
      expect(result.state.scenario).toBe(skeleton ? 'loading' : id === 'SyncedControls' ? 'active-party' : scenario);
      expect(resolveReference(result.entry.id, result.state.id)?.state).toBe(result.state);
    }
  }
  expect(listed).not.toContain('catalogue.cards');
  expect(resolveReference('catalogue.cards', 'episode')?.entry.id).toBe('MediaCard');
  expect(resolveReference('settings.rows', 'normal')?.entry.id).toBe('SettingsRow');
  expect(resolveReference('app.shell', 'error')?.entry.id).toBe('EmptyState');
  expect(resolveReference('ui.native', 'skeletons')?.state).toBe(resolveReference('catalogue.rows', 'loading')?.state);
  for (const entry of referenceEntries) {
    expect(new Set(entry.states.map(state => state.id)).size).toBe(entry.states.length);
    const url = new URL(referenceHref(entry.id), 'http://localhost');
    expect(url.searchParams.get('section')).toBe(entry.category);
    expect(url.searchParams.get('component')).toBe(entry.id);
    for (const section of ['elements', 'components', 'compositions']) expect(referenceSection(section, entry.id)).toBe(entry.category);
    for (const child of entry.elements) expect(() => referenceHref(child)).not.toThrow();
  }
  expect(referenceSection('components', 'Toggle')).toBe('elements');
  expect(referenceSection('elements', 'PlaybackTimeline')).toBe('components');
  expect(referenceSection('components', 'Shelf')).toBe('compositions');
  expect(referenceSection('compositions', 'catalogue.cards')).toBe('components');
  expect(referenceSection('charts', 'Shelf')).toBe('charts');
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
  expect(coverage.recipes).toBe(referenceRecipes.length);
  expect(coverage.internal).toBe(Object.keys(internalReferenceOwners).length);
  expect(coverage.delegated).toBe(10);
  expect(coverage.owners).toBeGreaterThan(Object.keys(manifest).length);
});

test('reference validation rejects duplicate identities, scenario drift and missing source paths',()=>{
  expect(()=>validateReferenceCoverage({...reference(),recipes:[...referenceRecipes,referenceRecipes[0]]})).toThrow('duplicate reference ID');
  const duplicateScenario={...referenceRecipes[0],scenarios:['normal','normal']};
  expect(()=>validateReferenceCoverage({...reference(),recipes:[duplicateScenario,...referenceRecipes.slice(1)]})).toThrow('duplicate reference scenarios');
  expect(()=>validateReferenceCoverage({...reference(),componentScenarios:{...componentScenarios,Button:['default','default']}})).toThrow('duplicate reference scenarios');
  expect(()=>validateReferenceCoverage({...reference(),componentScenarios:{UnknownWidget:['default']}})).toThrow('Unknown component scenario owner');
  const absentSource={...referenceRecipes[0],sources:['src/lib/nonexistent-preview-owner.svelte']};
  expect(()=>validateReferenceCoverage({...reference(),recipes:[absentSource,...referenceRecipes.slice(1)]})).toThrow('Reference source does not exist');
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

test('every recipe has a real name dispatch in its selected renderer',()=>{
  expect(()=>validateRecipeDispatches(referenceRecipes,dispatches)).not.toThrow();
  const wrongFamily={...referenceRecipes[0],family:'admin' as const};
  expect(()=>validateRecipeDispatches([wrongFamily],dispatches)).toThrow('Missing reference renderer dispatch');
  const admin=referenceRecipes.find(item=>item.family==='admin')!;
  expect(()=>validateRecipeDispatches([{...admin,example:'misspelled-example'}],dispatches)).toThrow('Missing reference renderer dispatch');
  expect(()=>validateRecipeDispatches([{...referenceRecipes[0],id:'catalogue.missing'}],dispatches)).toThrow('Missing reference renderer dispatch');
  expect(referenceDispatches("<script>let {name}=$props();</script>{#if name === 'first' || 'second' === name}<p>Example</p>{/if}")).toEqual(['first','second']);
});

test('dynamic import evidence excludes TypeScript-only imports',()=>{
  const source="<script lang='ts'>let Reader: typeof import('#lib/reading/Reader.svelte').default; const open=()=>import('#lib/media/DetailPanel.svelte');</script>";
  expect(renderedComponents('src/routes/+layout.svelte',source).dynamicImports).toEqual(['src/lib/media/DetailPanel.svelte']);
});

test('production usage counts count render sites and ignore specimen mounts', () => {
  const source = `<script>import Button from '#lib/ui/components/Button.svelte';</script>
    <Button />{#each [1,2,3] as item}<Button>{item}</Button>{/each}
    {#await import('#lib/ui/components/Dialog.svelte') then module}<module.default />{/await}`;
  const result = renderedComponents('src/routes/example/+page.svelte', source);
  expect(result.renderSites).toEqual(Array(2).fill(manifest.Button.path));
  expect(result.dynamicSites).toEqual([manifest.Dialog.path]);
  const sites = sourceViews.filter(view => !view.path.endsWith('/MaterialTweaker.svelte'))
    .flatMap(view => [...view.renderSites, ...view.dynamicSites]);
  expect(resolveReference('Button')!.entry.uses).toBe(sites.filter(path => path === manifest.Button.path).length);
  expect(resolveReference('IntegrationSettings')!.entry.uses).toBe(sites.filter(path => path.endsWith('/IntegrationSettings.svelte')).length);
});

test('editor controls and settings examples mount the production components they advertise', () => {
  for (const family of ['production','settings'] as const) {
    const path = referenceRenderers[family];
    const mounted = renderedComponents(path, readFileSync(path,'utf8'));
    const targets = [...mounted.rendered, ...mounted.dynamicImports];
    for (const item of referenceRecipes.filter(item => item.family === family))
      for (const source of item.sources) expect(targets).toContain(source);
  }
});
