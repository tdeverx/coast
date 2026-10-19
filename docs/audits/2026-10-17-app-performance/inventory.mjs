// Run from repository root. Source inventory is coverage evidence, not proof of runtime correctness.
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(path.resolve('package.json'));
const ts=require('typescript');
const baseline='docs/audits/2026-10-17-app-performance/evidence/source-inventory.json';
const usage='Usage: node inventory.mjs [--output PATH] | --check [--reference PATH]';
let destination=baseline,reference=baseline,check=false,outputSelected=false,referenceSelected=false;
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
 const argument=args[i];
 if(argument==='--help'){console.log(usage);process.exit(0);}
 if(argument==='--check'){check=true;continue;}
 if(argument==='--output'||argument==='--reference'){
  const value=args[++i];
  if(!value||value.startsWith('--')){console.error(`${argument} requires a path. ${usage}`);process.exit(2);}
  if(argument==='--output'){destination=value;outputSelected=true;}else{reference=value;referenceSelected=true;}
  continue;
 }
 console.error(`Unknown argument: ${argument}. ${usage}`);process.exit(2);
}
if(check&&outputSelected||!check&&referenceSelected){console.error(`--output generates a manifest; --reference selects a check input. ${usage}`);process.exit(2);}
async function walk(folder){return(await Promise.all((await readdir(folder,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path.join(folder,e.name)):[path.join(folder,e.name)]))).flat();}
const files=(await walk('src')).filter(f=>/\.(ts|svelte|css|html)$/.test(f)).sort();
const records=[];
for(const file of files){
 const raw=await readFile(file,'utf8');
 const code=file.endsWith('.svelte')?raw.replace(/[\s\S]/g,' ').split(''):null;
 if(code)for(const m of raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){const start=m.index+m[0].indexOf('>')+1;for(let i=0;i<m[1].length;i++)code[start+i]=m[1][i];}
 const ast=ts.createSourceFile(file,code?code.join(''):raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const lineAt=pos=>raw.slice(0,pos).split('\n').length;
 const sites=[];
 const add=(kind,node,extra={})=>sites.push({kind,line:lineAt(node.getStart(ast)),...extra});
 function visit(n){
  if(ts.isCallExpression(n)){
   const expression=n.expression.getText(ast),name=expression.split('.').at(-1);
   if(/^(fetch|api|change|changeMany|requestApi|providerFetch|providerRequest|request|requestJson|requestPage|requestPages|requestExternal)$/.test(name))add('http-or-command-candidate',n,{callee:expression,argument:n.arguments[0]?.getText(ast).slice(0,200)??''});
   if(/^(select|selectDistinct|insert|update|delete|execute|unsafe|query|queryObjects|transaction|begin)$/.test(name)&&(/\b(db|tx|sql|database|getDb|getSql|client)\b/.test(expression)))add('database-candidate',n,{callee:expression});
   if(/^(setInterval|setTimeout|clearInterval|clearTimeout|requestAnimationFrame|cancelAnimationFrame)$/.test(name)||/\.(addEventListener|removeEventListener|observe|unobserve|disconnect|createObjectURL|revokeObjectURL|terminate|abort|destroy|dispose)$/.test(expression))add('lifecycle',n,{callee:expression});
  }
  if(ts.isNewExpression(n)&&/Observer|Worker|AbortController|Map|Set/.test(n.expression.getText(ast)))add('allocation',n,{callee:n.expression.getText(ast)});
  if(ts.isTaggedTemplateExpression(n)&&/(sql|db|tx|getSql|query)/i.test(n.tag.getText(ast))){
   const statement=n.template.getText(ast);
   add('sql-template',n,{tag:n.tag.getText(ast),tables:[...new Set([...statement.matchAll(/\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]))]});
  }
  ts.forEachChild(n,visit);
 }
 if(!file.endsWith('.css')&&!file.endsWith('.html'))visit(ast);
 const components=[...raw.matchAll(/<(Shelf|MediaCard|DetailCard|MediaHero|Dialog|ChartView|Reader|PersistentPlayer)\b/g)].map(m=>({component:m[1],line:lineAt(m.index)}));
 const exports=[...raw.matchAll(/export\s+(?:(?:async|default)\s+)?(?:function|const|class)\s+([\w$]+)/g)].map(m=>({name:m[1],line:lineAt(m.index)}));
 records.push({file,sha256:createHash('sha256').update(raw).digest('hex'),lines:raw.split('\n').length,sites,components,exports});
}
const summary={files:records.length,lines:records.reduce((n,r)=>n+r.lines,0),sites:records.reduce((n,r)=>n+r.sites.length,0),byKind:{},componentInstances:records.reduce((n,r)=>n+r.components.length,0)};
for(const r of records)for(const s of r.sites)summary.byKind[s.kind]=(summary.byKind[s.kind]??0)+1;
const inventory={formatVersion:1,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),boundary:'Static source candidates, not runtime call counts. Dynamic routes/queries need owner review. Counts overlap where one call has multiple roles. No private data.',summary,files:records};
if(check){
 const previous=JSON.parse(await readFile(reference,'utf8'));
 if(!Array.isArray(previous.files)||previous.files.some(f=>!f||typeof f.file!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))||new Set(previous.files.map(f=>f.file)).size!==previous.files.length)throw Error('Reference requires unique source file paths and SHA-256 hashes.');
 const before=new Map(previous.files.map(f=>[f.file,f.sha256]));
 const after=new Map(records.map(f=>[f.file,f.sha256]));
 const changed=[...new Set([...before.keys(),...after.keys()])].filter(f=>before.get(f)!==after.get(f));
 console.log(JSON.stringify({reference,changedFiles:changed,unchanged:changed.length===0}));
 if(changed.length)process.exitCode=1;
}else{await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(inventory,null,2)+'\n');console.log(JSON.stringify({...summary,output:destination}));}
