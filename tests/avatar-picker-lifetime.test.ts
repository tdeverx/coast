import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';

const moduleUrl = (code:string) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const source = await Bun.file(new URL('../src/lib/ui/components/AvatarPicker.svelte',import.meta.url)).text();
const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)![1]
  .replace(/^\s*import .*?;\s*$/gm,'')
  .split('\n').filter(line => !line.includes('=$props();')).join('\n');
const compiled = compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(`
 export function createPicker(transport){
  let avatar=$state(null),reading=$state(false),name='Preview',disabled=false;
  let choices=$state([{id:'first',provider:'jellyfin',name:'First'},{id:'second',provider:'trakt',name:'Second'}]);
  const useClient=()=>({fetch:transport});const message=error=>error.message;
  ${script}
  return {selectProvider,get avatar(){return avatar;},get reading(){return reading;},get error(){return error;},replace(){choices=[{id:'replacement',provider:'jellyfin',name:'Replacement'}];},remove(){cancelRead();avatar=null;}};
 }
`),{filename:'avatar-picker-test.svelte.js',generate:'client'}).js.code
  .replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'));
const {createPicker} = await import(moduleUrl(compiled));
function pending(){
  let resolve!:(response:Response)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<Response>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

test('avatar provider read uses injected transport and stale failures cannot clear a replacement read',async()=>{
  const oldImage=globalThis.Image,oldDocument=globalThis.document;
  const requests:{url:string;signal:AbortSignal;response:ReturnType<typeof pending>}[]=[];
  globalThis.Image=class {naturalWidth=100;naturalHeight=100;src='';decode(){return Promise.resolve();}} as unknown as typeof Image;
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/webp;base64,preview'})} as unknown as Document;
  let picker:any;
  const dispose=runtime.effect_root(()=>picker=createPicker((url:string,options:{signal:AbortSignal})=>{
    const response=pending();requests.push({url,signal:options.signal,response});return response.promise;
  }));
  try{
    runtime.flush();const first=picker.selectProvider('first');expect(picker.reading).toBe(true);
    picker.remove();expect(requests[0].signal.aborted).toBe(true);
    const second=picker.selectProvider('second');expect(picker.reading).toBe(true);
    requests[0].response.reject(Error('Old account failure'));await first;
    expect(picker.error).toBe('');expect(picker.reading).toBe(true);
    requests[1].response.resolve(new Response(new Blob(['synthetic'],{type:'image/png'})));await second;
    expect(requests[1].url).toBe('/api/v1/profile/avatars/second');expect(picker.avatar).toBe('data:image/webp;base64,preview');expect(picker.reading).toBe(false);
  }finally{dispose();globalThis.Image=oldImage;globalThis.document=oldDocument;}
});

test('replacing avatar provider identity or disposing aborts delivery and prevents late publication',async()=>{
  const requests:{signal:AbortSignal;response:ReturnType<typeof pending>}[]=[];let picker:any;
  const dispose=runtime.effect_root(()=>picker=createPicker((_url:string,options:{signal:AbortSignal})=>{
    const response=pending();requests.push({signal:options.signal,response});return response.promise;
  }));
  try{
    runtime.flush();const old=picker.selectProvider('first');picker.replace();runtime.flush();
    expect(requests[0].signal.aborted).toBe(true);expect(picker.reading).toBe(false);
    requests[0].response.resolve(new Response(new Blob(['synthetic'],{type:'image/png'})));await old;expect(picker.avatar).toBeNull();
    const active=picker.selectProvider('replacement');dispose();expect(requests[1].signal.aborted).toBe(true);
    requests[1].response.reject(Error('Late failure'));await active;expect(picker.error).toBe('');expect(picker.avatar).toBeNull();
  }finally{dispose();}
});
