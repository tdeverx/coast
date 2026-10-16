import { parse } from 'svelte/compiler';
import { readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { compositions, componentScenarios, dynamicOwners, type ReferenceRecipe, type ReferenceFamily } from '../src/routes/ui-preview/reference';

const root = process.cwd(), folder = 'src/lib/ui/components';
type ManifestEntry = { path: string; elements: string[]; usedBy: string[]; dynamicComposition: boolean };
type InternalOwner = { owner: string; reason: string };
export const referenceRenderers: Record<ReferenceFamily, string> = {
  catalogue: 'src/routes/ui-preview/CatalogueExamples.svelte',
  social: 'src/routes/ui-preview/SocialExamples.svelte',
  admin: 'src/routes/ui-preview/AdminExamples.svelte',
  feature: 'src/routes/ui-preview/FeatureExamples.svelte',
};

function visitAst(value: unknown, callback: (node: Record<string, unknown>) => void) {
  if (!value || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  callback(node);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach(value => visitAst(value, callback));
    else if (child && typeof child === 'object') visitAst(child, callback);
  }
}

/** A registered composition must reach a concrete branch in its family renderer. */
export function referenceDispatches(source: string) {
  const names = new Set<string>();
  const ast = parse(source, { modern: true });
  visitAst(ast.fragment, node => {
    if (node.type !== 'BinaryExpression' || node.operator !== '===') return;
    const left = node.left as Record<string, unknown>, right = node.right as Record<string, unknown>;
    if (left?.type === 'Identifier' && left.name === 'name' && right?.type === 'Literal' && typeof right.value === 'string') names.add(right.value);
    if (right?.type === 'Identifier' && right.name === 'name' && left?.type === 'Literal' && typeof left.value === 'string') names.add(left.value);
  });
  return [...names].sort();
}

export function validateRecipeDispatches(recipes: readonly ReferenceRecipe[], dispatches: Readonly<Record<string, readonly string[]>>) {
  for (const item of recipes) {
    const renderer = referenceRenderers[item.family];
    const name = item.family === 'admin' ? item.example : item.id;
    if (!renderer || !dispatches[renderer]?.includes(name)) throw new Error(`Missing reference renderer dispatch: ${item.id} → ${renderer ?? item.family} (${name})`);
  }
}

/** Internal renderers are demonstrated through their owner, not separate public widgets. */
export const internalReferenceOwners: Record<string, InternalOwner> = {
  'src/lib/ui/charts/ChartView.svelte': { owner: 'src/routes/ui-preview/charts/ChartGallery.svelte', reason: 'The Charts section owns the selected chart renderer.' },
  'src/lib/ui/charts/StandardChart.svelte': { owner: 'src/lib/ui/charts/ChartView.svelte', reason: 'Demand-loaded standard chart implementation.' },
  'src/lib/ui/charts/ExtendedChart.svelte': { owner: 'src/lib/ui/charts/ChartView.svelte', reason: 'Demand-loaded extended chart implementation.' },
  'src/lib/ui/charts/ChartMark.svelte': { owner: 'src/lib/ui/charts/StandardChart.svelte', reason: 'Interactive marks are part of the chart renderer contract.' },
  'src/lib/ui/materials/MaterialTweaker.svelte': { owner: 'src/routes/ui-preview/+page.svelte', reason: 'The Materials section already represents this isolated non-approved editor.' },
  'src/lib/ui/work-menu/ScreenActions.svelte': { owner: 'src/lib/ui/components/WorkMenu.svelte', reason: 'Screen-specific action composition behind the shared work menu.' },
  'src/lib/ui/work-menu/CatalogueActions.svelte': { owner: 'src/lib/ui/components/WorkMenu.svelte', reason: 'Other media action composition behind the shared work menu.' },
  'src/lib/ui/work-menu/GameCommands.svelte': { owner: 'src/lib/ui/work-menu/CatalogueActions.svelte', reason: 'Game command dialogs owned by the catalogue action composition.' },
  'src/lib/ui/work-menu/MusicCommands.svelte': { owner: 'src/lib/ui/work-menu/CatalogueActions.svelte', reason: 'Music command dialogs owned by the catalogue action composition.' },
  'src/lib/ui/work-menu/ReadingCommands.svelte': { owner: 'src/lib/ui/work-menu/CatalogueActions.svelte', reason: 'Reading command dialogs owned by the catalogue action composition.' },
};

/** These thin routes delegate presentation to registered detail compositions. */
export const delegatedReferenceRoutes: Record<string, readonly string[]> = {
  'src/routes/media/[id]/+page.svelte': ['src/lib/media/Details.svelte', 'src/lib/reading/Details.svelte'],
  'src/routes/media/openlibrary/[externalId]/+page.svelte': ['src/lib/reading/Details.svelte'],
  'src/routes/media/comic-vine/[externalId]/+page.svelte': ['src/lib/reading/Details.svelte'],
  'src/routes/music/[connection]/[id]/+page.svelte': ['src/lib/ui/components/MediaPage.svelte'],
  'src/routes/music/work/[id]/+page.svelte': ['src/lib/ui/components/MediaPage.svelte'],
};

async function walk(dir: string): Promise<string[]> {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(item => item.isDirectory() ? walk(`${dir}/${item.name}`) : [`${dir}/${item.name}`]))).flat();
}

export function renderedComponents(path: string, source: string) {
  const ast = parse(source, { modern: true });
  const imports = new Map<string, string>();
  for (const node of ast.instance?.content.body ?? []) {
    if (node.type !== 'ImportDeclaration' || !String(node.source.value).endsWith('.svelte')) continue;
    const imported = String(node.source.value);
    const target = relative(root, resolve(imported.startsWith('$lib/') ? 'src/lib' : dirname(path), imported.startsWith('$lib/') ? imported.slice(5) : imported));
    for (const specifier of node.specifiers) imports.set(specifier.local.name, target);
  }
  const rendered = new Set<string>();
  let dynamic = false;
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.type === 'Component' && typeof node.name === 'string' && imports.has(node.name)) rendered.add(imports.get(node.name)!);
    if (node.type === 'RenderTag' || node.type === 'SvelteComponent') dynamic = true;
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  visit(ast.fragment);
  const dynamicImports = new Set<string>();
  visitAst(ast.instance?.content, node => {
    if (node.type !== 'ImportExpression') return;
    const imported = node.source as Record<string, unknown>;
    if (imported?.type !== 'Literal' || typeof imported.value !== 'string' || !imported.value.endsWith('.svelte')) return;
    const value = imported.value;
    dynamicImports.add(relative(root, resolve(value.startsWith('$lib/') ? 'src/lib' : dirname(path), value.startsWith('$lib/') ? value.slice(5) : value)));
  });
  return { rendered: [...rendered].sort(), dynamic, dynamicImports: [...dynamicImports].sort() };
}

export function validateReferenceCoverage(options: {
  sources: readonly string[];
  components: Readonly<Record<string, { path: string }>>;
  recipes: readonly ReferenceRecipe[];
  componentScenarios: Readonly<Record<string, readonly string[]>>;
  dynamicOwners: Readonly<Record<string, readonly string[]>>;
  rendered: Readonly<Record<string, readonly string[]>>;
  dynamicImports: Readonly<Record<string, readonly string[]>>;
}) {
  const files = new Set(options.sources), ids = new Set(Object.keys(options.components));
  const represented = new Set(Object.values(options.components).map(component => component.path));
  function exists(path: string) {
    if (!path.startsWith('src/') || !files.has(path)) throw new Error(`Reference source does not exist: ${path}`);
  }
  function scenarios(owner: string, values: readonly string[]) {
    if (!values.length || new Set(values).size !== values.length || values.some(value => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) throw new Error(`Invalid or duplicate reference scenarios: ${owner}`);
  }
  for (const item of options.recipes) {
    if (!/^[A-Za-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate reference ID: ${item.id}`);
    ids.add(item.id);
    if (!item.title.trim() || !item.example.trim() || !item.sources.length || new Set(item.sources).size !== item.sources.length) throw new Error(`Incomplete reference recipe: ${item.id}`);
    scenarios(item.id, item.scenarios);
    for (const path of item.sources) { exists(path); represented.add(path); }
  }
  for (const [component, values] of Object.entries(options.componentScenarios)) {
    if (!options.components[component]) throw new Error(`Unknown component scenario owner: ${component}`);
    scenarios(component, values);
  }
  for (const [owner, targets] of Object.entries(options.dynamicOwners)) {
    exists(owner);
    if (!targets.length || new Set(targets).size !== targets.length) throw new Error(`Invalid dynamic reference owner: ${owner}`);
    for (const target of targets) {
      exists(target);
      if (!options.dynamicImports[owner]?.includes(target)) throw new Error(`Declared dynamic reference import is absent: ${owner} → ${target}`);
    }
  }
  for (const [path, declaration] of Object.entries(internalReferenceOwners)) {
    exists(path); exists(declaration.owner);
    if (!declaration.reason.trim()) throw new Error(`Missing internal owner reason: ${path}`);
    represented.add(path);
  }
  for (const [path, targets] of Object.entries(delegatedReferenceRoutes)) {
    exists(path);
    for (const target of targets) {
      exists(target);
      if (!represented.has(target) || !options.rendered[path]?.includes(target)) throw new Error(`Reference route no longer delegates to its represented owner: ${path} → ${target}`);
    }
    represented.add(path);
  }
  for (const [owner, targets] of Object.entries(options.dynamicOwners)) {
    if (!represented.has(owner)) throw new Error(`Dynamic reference owner is not represented: ${owner}`);
    for (const target of targets) if (!represented.has(target)) throw new Error(`Dynamic reference target is not represented: ${target}`);
  }
  const unaccounted = options.sources.filter(path => path.endsWith('.svelte') && !path.startsWith('src/routes/ui-preview/') && !represented.has(path));
  if (unaccounted.length) throw new Error(`User-facing Svelte owners missing reference coverage:\n${unaccounted.sort().join('\n')}`);
  return { compositions: options.recipes.length, owners: represented.size, internal: Object.keys(internalReferenceOwners).length, delegated: Object.keys(delegatedReferenceRoutes).length };
}

async function main() {
  const paths = (await readdir(folder)).filter(name => name.endsWith('.svelte')).map(name => `${folder}/${name}`).sort();
  const manifest: Record<string, ManifestEntry> = {};
  for (const path of paths) manifest[path.split('/').at(-1)!.replace('.svelte', '')] = { path, elements: [], usedBy: [], dynamicComposition: false };
  const files = await walk('src');
  const rendered: Record<string, string[]> = {};
  const dynamicImports: Record<string, string[]> = {};
  const names = new Map(Object.entries(manifest).map(([name, component]) => [component.path, name]));
  for (const path of files.filter(path => path.endsWith('.svelte') && !path.includes('/ui-preview/'))) {
    const result = renderedComponents(path, await Bun.file(path).text());
    rendered[path] = result.rendered;
    dynamicImports[path] = result.dynamicImports;
    const used = result.rendered.map(target => names.get(target)).filter((name): name is string => !!name);
    const owner = names.get(path);
    if (owner) {
      manifest[owner].elements = used.filter(name => name !== owner).sort();
      manifest[owner].dynamicComposition = result.dynamic;
    }
    for (const name of used) if (manifest[name].path !== path) manifest[name].usedBy.push(path);
  }
  for (const item of Object.values(manifest)) item.usedBy = [...new Set(item.usedBy)].sort();
  const demo = await Bun.file('src/routes/ui-preview/Demo.svelte').text();
  const recipeSource = demo.match(/const recipes: Record<string,string\[\]> = (\{[^\n]*\});/);
  if (!recipeSource) throw new Error('Preview recipe inventory is missing.');
  const recipes = JSON.parse(recipeSource[1]) as Record<string, string[]>;
  for (const name of Object.keys(manifest)) {
    if (!recipes[name]) throw new Error(`Missing preview recipe: ${name}`);
    for (const dependency of recipes[name]) if (!manifest[dependency]) throw new Error(`Unknown preview dependency: ${name} → ${dependency}`);
  }
  const dispatches = Object.fromEntries(await Promise.all(Object.values(referenceRenderers).map(async path => [path, referenceDispatches(await Bun.file(path).text())])));
  validateRecipeDispatches(compositions, dispatches);
  const coverage = validateReferenceCoverage({ sources: files, components: manifest, recipes: compositions, componentScenarios, dynamicOwners, rendered, dynamicImports });
  const content = JSON.stringify(manifest, null, 2) + '\n', file = 'src/lib/ui/component-manifest.json';
  if (process.argv.includes('--check')) {
    if (await Bun.file(file).text() !== content) throw new Error('UI composition inventory is stale. Run bun run ui:inventory.');
  } else await Bun.write(file, content);
  console.log(`UI inventory: ${paths.length} components, ${coverage.compositions} explicit compositions, ${coverage.internal} internal renderers and ${coverage.delegated} delegated routes verified.`);
}
if (import.meta.main) await main();
