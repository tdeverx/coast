import { parse } from 'svelte/compiler';
import { readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
const root=process.cwd(), folder='src/lib/ui/components';
const paths=(await readdir(folder)).filter(name=>name.endsWith('.svelte')).map(name=>`${folder}/${name}`).sort();
const manifest:Record<string,{path:string;elements:string[];usedBy:string[];dynamicComposition:boolean}>={};
for(const path of paths)manifest[path.split('/').at(-1)!.replace('.svelte','')]={path,elements:[],usedBy:[],dynamicComposition:false};
async function walk(dir:string):Promise<string[]>{return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(item=>item.isDirectory()?walk(`${dir}/${item.name}`):[`${dir}/${item.name}`]))).flat();}
for(const path of (await walk('src')).filter(path=>path.endsWith('.svelte')&&!path.includes('/ui-preview/'))){
 const ast=parse(await Bun.file(path).text(),{modern:true});
 const imports=new Map<string,string>();
 for(const node of ast.instance?.content.body??[]){
  if(node.type!=='ImportDeclaration'||!String(node.source.value).endsWith('.svelte'))continue;
  const source=String(node.source.value);
  const resolved=relative(root,resolve(source.startsWith('$lib/')?'src/lib':dirname(path),source.startsWith('$lib/')?source.slice(5):source));
  const name=Object.keys(manifest).find(name=>manifest[name].path===resolved);
  if(name)for(const specifier of node.specifiers)imports.set(specifier.local.name,name);
 }
 const used=new Set<string>();let dynamic=false;
 function visit(value:unknown){
  if(!value||typeof value!=='object')return;
  const node=value as Record<string,unknown>;
  if(node.type==='Component'&&typeof node.name==='string'&&imports.has(node.name))used.add(imports.get(node.name)!);
  if(node.type==='RenderTag'||node.type==='SvelteComponent')dynamic=true;
  for(const child of Object.values(node))if(Array.isArray(child))child.forEach(visit);else if(child&&typeof child==='object')visit(child);
 }
 visit(ast.fragment);
 const owner=Object.keys(manifest).find(name=>manifest[name].path===path);
 if(owner){manifest[owner].elements=[...used].filter(name=>name!==owner).sort();manifest[owner].dynamicComposition=dynamic;}
 for(const name of used)if(manifest[name].path!==path)manifest[name].usedBy.push(path);
}
for(const item of Object.values(manifest))item.usedBy=[...new Set(item.usedBy)].sort();
const demo=await Bun.file('src/routes/ui-preview/Demo.svelte').text();
const recipeSource=demo.match(/const recipes: Record<string,string\[\]> = (\{[^\n]*\});/);
if(!recipeSource)throw new Error('Preview recipe inventory is missing.');
const recipes=JSON.parse(recipeSource[1]) as Record<string,string[]>;
for(const name of Object.keys(manifest)){
 if(!recipes[name])throw new Error(`Missing preview recipe: ${name}`);
 for(const dependency of recipes[name])if(!manifest[dependency])throw new Error(`Unknown preview dependency: ${name} → ${dependency}`);
}
const content=JSON.stringify(manifest,null,2)+'\n',file='src/lib/ui/component-manifest.json';
if(process.argv.includes('--check')){
 if(await Bun.file(file).text()!==content)throw new Error('UI composition inventory is stale. Run bun run ui:inventory.');
}else await Bun.write(file,content);
console.log(`UI inventory: ${paths.length} components, rendered composition and application consumers verified.`);
