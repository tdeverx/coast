import ts from 'typescript';
import { readdir } from 'node:fs/promises';
import { resolve,dirname,relative } from 'node:path';
const root=process.cwd();
async function walk(folder:string):Promise<string[]> {return (await Promise.all((await readdir(folder,{withFileTypes:true})).map(entry=>entry.isDirectory()?walk(`${folder}/${entry.name}`):[`${folder}/${entry.name}`]))).flat();}
const files=(await walk('src')).filter(file=>/\.(ts|svelte)$/.test(file));
const known=new Set(files.map(file=>resolve(file))), graph=new Map<string,string[]>();
function modulePath(source:string,owner:string) {
 if(!source.startsWith('.')&&!source.startsWith('$lib/'))return;
 const base=source.startsWith('$lib/')?resolve('src/lib',source.slice(5)):resolve(dirname(owner),source);
 return [base,`${base}.ts`,`${base}.svelte`,`${base}/index.ts`,`${base}/index.server.ts`].find(path=>known.has(path));
}
for(const file of files) {
 const raw=await Bun.file(file).text();
 const text=file.endsWith('.svelte')?[...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n'):raw;
 const imports=ts.preProcessFile(text,true,true).importedFiles.map(imported=>modulePath(imported.fileName,resolve(file))).filter((path):path is string=>!!path);
 // A literal glob is a runtime registration edge, not a conventional import.
 for(const match of text.matchAll(/import\.meta\.glob(?:<[\s\S]*?>)?\(['"]([^'"]+)['"]/g)) {
  const prefix=match[1].split('*')[0];
  const base=prefix.startsWith('/src/')?resolve(root,prefix.slice(1)):resolve(dirname(file),prefix);
  imports.push(...[...known].filter(path=>path.startsWith(base)));
 }
 graph.set(resolve(file),imports);
}
function reachable(roots:string[]) {const seen=new Set<string>();function visit(path:string){if(seen.has(path))return;seen.add(path);for(const imported of graph.get(path)??[])visit(imported);}roots.forEach(visit);return seen;}
const roots=files.filter(file=>file.startsWith('src/routes/')&&!file.startsWith('src/routes/ui-preview/')||/^src\/(hooks|service-worker|app\.d)/.test(file)).map(file=>resolve(file));
const production=reachable(roots), toolingRoots:string[]=[];
for(const file of [...await walk('scripts'),...await walk('tests')].filter(file=>file.endsWith('.ts'))) {
 const text=await Bun.file(file).text();for(const imported of ts.preProcessFile(text,true,true).importedFiles){const path=modulePath(imported.fileName,resolve(file));if(path)toolingRoots.push(path);}
}
const tooling=reachable(toolingRoots);
const preview=reachable(files.filter(file=>file.startsWith('src/routes/ui-preview/')).map(file=>resolve(file)));
const previewOnly=files.filter(file=>!production.has(resolve(file))&&!tooling.has(resolve(file))&&preview.has(resolve(file))&&!file.startsWith('src/routes/ui-preview/'));
const unused=files.filter(file=>!production.has(resolve(file))&&!tooling.has(resolve(file))&&!file.endsWith('.d.ts')&&!preview.has(resolve(file)));
const testOnly=files.filter(file=>!production.has(resolve(file))&&tooling.has(resolve(file)));
console.log(JSON.stringify({unusedModules:unused.sort(),previewOnlyModules:previewOnly.sort(),toolingOnlyModules:testOnly.sort(),productionModules:production.size,roots:roots.map(path=>relative(root,path)).length},null,2));
if(process.argv.includes('--check')&&unused.length)process.exitCode=1;
