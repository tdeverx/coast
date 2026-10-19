import { expect, test } from 'bun:test';
import { compile,compileModule } from 'svelte/compiler';
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
  const reportFailure=()=>{};const useClient=()=>({fetch:transport});const message=error=>error.message;
  ${script}
  return {selectProvider,selectAvatar,get avatar(){return avatar;},get reading(){return reading;},get error(){return error;},replace(){choices=[{id:'replacement',provider:'jellyfin',name:'Replacement'}];},remove(){cancelRead();avatar=null;}};
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
  globalThis.Image=class {naturalWidth=100;naturalHeight=100;src='';removeAttribute(name:string){if(name==='src')this.src='';}decode(){return Promise.resolve();}} as unknown as typeof Image;
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

test('complete avatar templates retain client and server compilation',()=>{
  for(const generate of ['client','server']as const)expect(()=>compile(source,{filename:'AvatarPicker.svelte',generate})).not.toThrow();
});

/** Controlled pending decoders/URLs protect lifetime races; actual format/output
 * acceptance uses separate existing-image browser evidence. */
function decodeRuntime(){
  const previous={Image:globalThis.Image,document:globalThis.document,FileReader:globalThis.FileReader,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  const images:{src:string;removed:number;resolve:()=>void;reject:(error:Error)=>void}[]=[],created:string[]=[],revoked:string[]=[],readers:{onload:(()=>void)|null;onerror:(()=>void)|null;onabort:(()=>void)|null;result:string;aborted:boolean}[]=[];
  globalThis.Image=class{
    naturalWidth=100;naturalHeight=60;src='';removed=0;resolve!:()=>void;reject!:(error:Error)=>void;
    private completion=new Promise<void>((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
    constructor(){images.push(this);}decode(){return this.completion;}removeAttribute(name:string){if(name==='src'){this.src='';this.removed++;}}
  }as unknown as typeof Image;
  globalThis.FileReader=class{
    onload:(()=>void)|null=null;onerror:(()=>void)|null=null;onabort:(()=>void)|null=null;result='data:image/gif;base64,controlled-original';aborted=false;
    constructor(){readers.push(this);}readAsDataURL(){}abort(){this.aborted=true;this.onabort?.();}
  }as unknown as typeof FileReader;
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/webp;base64,controlled-output'})}as unknown as Document;
  URL.createObjectURL=()=>{const url='blob:controlled-avatar-'+created.length;created.push(url);return url;};URL.revokeObjectURL=url=>{revoked.push(url);};
  return {images,created,revoked,readers,restore(){globalThis.Image=previous.Image;globalThis.document=previous.document;globalThis.FileReader=previous.FileReader;URL.createObjectURL=previous.create;URL.revokeObjectURL=previous.revoke;}};
}
const select=(picker:any,type='image/png')=>picker.selectAvatar({currentTarget:{files:[new Blob(['controlled transport bytes'],{type})]}});
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

test('pending avatar removal releases source and URL immediately and cannot double-release or replace newer output',async()=>{
  const env=decodeRuntime();let picker:any;const dispose=runtime.effect_root(()=>picker=createPicker(()=>{throw Error('Local file must not fetch a provider');}));
  try{
    runtime.flush();const first=select(picker);expect(picker.reading).toBe(true);expect(env.images[0].src).toBe(env.created[0]);
    picker.remove();expect(env.images[0].src).toBe('');expect(env.images[0].removed).toBe(1);expect(env.revoked).toEqual([env.created[0]]);expect(picker.reading).toBe(false);
    const second=select(picker,'image/jpeg');env.images[0].resolve();await first;expect(picker.avatar).toBeNull();expect(picker.error).toBe('');expect(picker.reading).toBe(true);expect(env.revoked).toEqual([env.created[0]]);
    env.images[1].resolve();await second;expect(picker.avatar).toBe('data:image/webp;base64,controlled-output');expect(picker.reading).toBe(false);expect(env.revoked).toEqual(env.created);expect(env.images[1].removed).toBe(1);
    const rejected=select(picker);env.images[2].reject(Error('Current decode failure'));await rejected;expect(picker.error).toBe('Current decode failure');expect(picker.reading).toBe(false);expect(env.revoked).toEqual(env.created);expect(env.images[2].removed).toBe(1);
  }finally{dispose();env.restore();}
});

test('provider identity replacement and teardown release pending decoded ownership before settlement',async()=>{
  const env=decodeRuntime();let picker:any;const dispose=runtime.effect_root(()=>picker=createPicker(async()=>new Response(new Blob(['controlled provider bytes'],{type:'image/webp'}))));
  try{
    runtime.flush();const old=picker.selectProvider('first');await settle();expect(env.images).toHaveLength(1);
    picker.replace();runtime.flush();expect(env.images[0].src).toBe('');expect(env.revoked).toEqual([env.created[0]]);env.images[0].reject(Error('Late obsolete failure'));await old;expect(picker.error).toBe('');
    const current=picker.selectProvider('replacement');await settle();expect(env.images).toHaveLength(2);dispose();expect(env.images[1].src).toBe('');expect(env.revoked).toEqual(env.created);env.images[1].resolve();await current;expect(picker.avatar).toBeNull();expect(picker.error).toBe('');expect(env.images.every(image=>image.removed===1)).toBe(true);
  }finally{dispose();env.restore();}
});

test('GIF decode ownership releases before FileReader and preserves original-byte read/cancel behavior',async()=>{
  const env=decodeRuntime();let picker:any;const dispose=runtime.effect_root(()=>picker=createPicker(()=>{throw Error('Local GIF must not fetch a provider');}));
  try{
    runtime.flush();const cancelled=select(picker,'image/gif');env.images[0].resolve();await settle();expect(env.readers).toHaveLength(1);expect(env.images[0].src).toBe('');expect(env.revoked).toEqual([env.created[0]]);expect(picker.reading).toBe(true);
    picker.remove();expect(env.readers[0].aborted).toBe(true);await cancelled;expect(picker.avatar).toBeNull();expect(picker.error).toBe('');expect(env.revoked).toEqual([env.created[0]]);
    const current=select(picker,'image/gif');env.images[1].resolve();await settle();env.readers[1].onload?.();await current;expect(picker.avatar).toBe(env.readers[1].result);expect(picker.reading).toBe(false);expect(env.revoked).toEqual(env.created);expect(env.images.every(image=>image.removed===1)).toBe(true);
  }finally{dispose();env.restore();}
});
