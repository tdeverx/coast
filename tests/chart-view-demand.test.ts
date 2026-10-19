import {expect,test} from 'bun:test';
import {compile} from 'svelte/compiler';
import {render} from 'svelte/server';
// @ts-expect-error The internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,eraseTypeScript,moduleUrl} from './fixtures/ui-script';

const path='src/lib/ui/charts/ChartView.svelte';
let script=await componentScript(path);
const start=script.indexOf('let {'),end=script.indexOf('= $props();',start)+'= $props();'.length;
script=script.slice(0,start)+`let model=$state.raw(initial.model),compact=$state(initial.compact),selected=$state(0),onselect;`+script.slice(end);
script=eraseTypeScript(script)
 .replace(/import\(['"]\.\/StandardChart\.svelte['"]\)/,"loadRenderer('standard')")
 .replace(/import\(['"]\.\/ExtendedChart\.svelte['"]\)/,"loadRenderer('extended')");
const {create}=await import(moduleUrl(compileRunes(`export function create(initial,loadRenderer){let failure=()=>'';const reportFailure=read=>failure=read,setContext=()=>{},chartLinks=Symbol();${script}
return {replace(value){model=value;},compact(value){compact=value;},get error(){return failure();},get pending(){return loaded;}};}`)));
const settle=async()=>{for(let i=0;i<5;i++){runtime.flush();await Promise.resolve();}};
const model=(styleId:string,rows:unknown[]=[])=>({styleId,rows,raw:{empty:'No existing data.'},subtitle:'',unit:''});
function fixture(compact=true){
 const calls:{kind:string;promise:Promise<unknown>;resolve:(value:unknown)=>void;reject:(cause:Error)=>void}[]=[];let owner:any;
 const dispose=runtime.effect_root(()=>owner=create({compact,model:model('2A')},(kind:string)=>{
  let resolve!:(value:unknown)=>void,reject!:(cause:Error)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});calls.push({kind,promise,resolve,reject});return promise;
 }));runtime.flush();return {owner,calls,dispose};
}
test('compact empty charts request no engine and release stale error delivery through demand changes',async()=>{
 const f=fixture();try{
  expect(f.calls).toHaveLength(0);expect(f.owner.error).toBe('');
  f.owner.replace(model('2A',[{label:'One',value:1}]));await settle();expect(f.calls.map(c=>c.kind)).toEqual(['standard']);expect(f.owner.pending).toBe(f.calls[0].promise);
  f.owner.replace(model('11A'));await settle();expect(f.calls).toHaveLength(1);
  f.calls[0].reject(Error('Late standard failure'));await settle();expect(f.owner.error).toBe('');
  f.owner.replace(model('11A',[{label:'Two',value:2}]));await settle();expect(f.calls.map(c=>c.kind)).toEqual(['standard','extended']);
  f.calls[1].reject(Error('Current extended failure'));await settle();expect(f.owner.error).toContain('The chart could not load.');
  f.owner.replace(model('11A'));await settle();expect(f.owner.error).toBe('');expect(f.calls).toHaveLength(2);
  f.owner.replace(model('2A',[{label:'Again',value:1}]));await settle();expect(f.calls).toHaveLength(2);expect(f.owner.pending).toBe(f.calls[0].promise);
 }finally{f.dispose();}
});
test('noncompact empty charts retain renderer demand and teardown fences pending failure',async()=>{
 const f=fixture(false);expect(f.calls.map(c=>c.kind)).toEqual(['standard']);
 f.owner.compact(true);await settle();f.calls[0].reject(Error('No longer visible'));await settle();expect(f.owner.error).toBe('');
 f.owner.replace(model('11A',[{label:'One',value:1}]));await settle();expect(f.calls.map(c=>c.kind)).toEqual(['standard','extended']);
 f.dispose();f.calls[1].reject(Error('Disposed'));await settle();expect(f.owner.error).toBe('');
});

const serverLoaderUrl=moduleUrl(`export const calls=[];export function load(kind){calls.push(kind);return new Promise(()=>{});}`);
const serverLoader=await import(serverLoaderUrl);
const serverCode=compile(await Bun.file(path).text(),{filename:path,generate:'server'}).js.code
 .replaceAll('svelte/internal/server',import.meta.resolve('svelte/internal/server'))
 .replace(/import \{ reportFailure \} from ['"].*?['"];?/,'const reportFailure=()=>{};')
 .replace(/import \{ formatValue \} from ['"].*?['"];?/,'const formatValue=String;')
 .replace(/import \{ chartLinks \} from ['"].*?['"];?/,'const chartLinks=Symbol();')
 .replace("import('./StandardChart.svelte')","loadRenderer('standard')")
 .replace("import('./ExtendedChart.svelte')","loadRenderer('extended')");
const {default:ChartView}=await import(moduleUrl(`import {load as loadRenderer} from ${JSON.stringify(serverLoaderUrl)};${serverCode}`));
test('installed server compiler and actual compact-empty template keep renderer evaluation lazy',()=>{
 serverLoader.calls.length=0;
 const empty=render(ChartView,{props:{compact:true,model:model('11A')}}).body;
 expect(empty).toContain('No existing data.');expect(empty).not.toContain('Loading chart');expect(serverLoader.calls).toEqual([]);
 const noncompact=render(ChartView,{props:{compact:false,model:model('2A')}}).body;
 expect(noncompact).toContain('Loading chart');expect(serverLoader.calls).toEqual(['standard']);
 expect(render(ChartView,{props:{compact:true,model:model('11A',[{label:'One',value:1}])}}).body).toContain('Loading chart');
 expect(serverLoader.calls).toEqual(['standard','extended']);
});
