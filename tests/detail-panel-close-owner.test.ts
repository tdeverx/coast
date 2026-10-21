import {expect,test} from 'bun:test';
import {parse} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,eraseTypeScript,moduleUrl} from './fixtures/ui-script';
import {mediaDetailTarget} from '../src/lib/media/detail-target';
import {sectionTarget} from '../src/lib/ui/section-target';

// Authored controller/prop-boundary controls only. These execute the actual
// controller and template callback expression, but no native DOM/history/Kit,
// provider, real viewer or actual media. CUA and actual acceptance stay separate.
const source=await Bun.file(new URL('../src/lib/media/DetailPanel.svelte',import.meta.url)).text();
const ast=parse(source,{modern:true});
const overlay=ast.fragment.nodes.find((node:any)=>node.type==='Component'&&node.name==='DetailOverlay') as any;
const attribute=overlay?.attributes.find((node:any)=>node.type==='Attribute'&&node.name==='onclose');
if(attribute?.value?.type!=='ExpressionTag')throw Error('Review the actual Panel close prop before updating its fixture.');
const onclose=source.slice(attribute.value.expression.start,attribute.value.expression.end);
const client=await Bun.file(new URL('../src/lib/ui/client.ts',import.meta.url)).text();
const errorStart=client.indexOf('export class ApiError extends Error {'),errorEnd=client.indexOf('export async function api<',errorStart);
if(errorStart<0||errorEnd<errorStart)throw Error('Review the actual API error class and feature classification before updating this fixture.');
const errorTypes=new Bun.Transpiler({loader:'ts'}).transformSync(client.slice(errorStart,errorEnd));
let script=eraseTypeScript(await componentScript('src/lib/media/DetailPanel.svelte'));
let presenterImports=0;
script=script.replace(/import\((['"])#lib\/[^'"]+\.svelte\1\)/g,()=>{presenterImports++;return 'Promise.resolve({default:()=>{}})';});
if(presenterImports!==8)throw Error('Review the actual presenter import seams before updating this fixture.');
const code=compileRunes(`${errorTypes}
export function create(boundary){
 const page=$state({state:{mediaDetailHref:undefined,mediaDetailDepth:1},url:new URL('http://fixture/library'),data:{user:{id:'viewer'},revision:0,capabilities:{screen:true,music:true,games:true,reading:true}}});
 const player=$state({visible:false,session:null,browsing:false}),reader=$state({visible:false}),playbackVisible=value=>value.visible;
 const {api,closeMediaDetails,backMediaDetails,mediaDetailTarget,sectionTarget}=boundary;
 const message=error=>error.message,editionChoices=()=>[],namedEdition=value=>({value}),contentRevisionKey=data=>data.revision,reportFailure=()=>{};
 ${script}
 return {navigate(href){page.state.mediaDetailHref=href;},refresh(){page.data.revision++;},viewer(id){page.data.user={id};},foreground(owner,visible){if(owner==='player')player.visible=visible;else reader.visible=visible;},get foregroundState(){return JSON.stringify({player:{visible:player.visible,session:player.session,browsing:player.browsing},reader:{visible:reader.visible}});},get hasNativeCloseOwner(){return typeof (${onclose})==='function';},emitNativeClose(){(${onclose})?.();},get open(){return open;},get resolved(){return resolved;},get error(){return error;}};
}`);
const {create,ApiError,isFeatureDisabled}=await import(moduleUrl(code));
function fixture(){
 const requests:{signal:AbortSignal;resolve:(value:unknown)=>void;reject:(error:unknown)=>void;answered?:boolean}[]=[],calls:string[]=[];
 let controller:any;
 const dispose=runtime.effect_root(()=>controller=create({mediaDetailTarget,sectionTarget,closeMediaDetails:()=>calls.push('close'),backMediaDetails:()=>calls.push('back'),api(_path:string,_body:unknown,_method:unknown,{signal}:{signal:AbortSignal}){return new Promise((resolve,reject)=>requests.push({signal,resolve,reject}));}}));
 runtime.flush();
 const drain=async()=>{for(let i=0;i<8;i++){await Promise.resolve();runtime.flush();}};
 const current=()=>{const request=requests.find(r=>!r.answered&&!r.signal.aborted);if(!request)throw Error('Controlled current base request missing');request.answered=true;return request;};
 return {controller,calls,requests,current,drain,navigate(href:string|undefined){controller.navigate(href);runtime.flush();},async answer(){current().resolve({kind:'music',data:{item:{id:'authored',title:'Authored'},availability:[]}});await drain();},async fail(status:number,details?:unknown){current().reject(new ApiError('Controlled request failure',status,details));await drain();},refresh(){controller.refresh();runtime.flush();},foreground(owner:'player'|'reader',visible:boolean){controller.foreground(owner,visible);runtime.flush();},destroy(){dispose();}};
}
const href='/media/00000000-0000-4000-8000-000000000001',other='/media/00000000-0000-4000-8000-000000000002';
test('initial failure retains one manual close and grants no native close authority without a presenter',async()=>{
 const f=fixture();try{f.navigate(href);expect(f.controller.hasNativeCloseOwner).toBe(false);await f.fail(403);expect(f.calls).toEqual(['close']);expect(f.controller.resolved).toBeNull();f.controller.emitNativeClose();expect(f.calls).toEqual(['close']);}finally{f.destroy();}
});
test('terminal refresh withdraws native close authority before a late callback can repeat its manual close',async()=>{
 const f=fixture();try{f.navigate(href);await f.answer();expect(f.controller.hasNativeCloseOwner).toBe(true);f.refresh();await f.fail(403);expect(f.controller.open).toBe(false);expect(f.controller.resolved).toBeNull();expect(f.controller.hasNativeCloseOwner).toBe(false);expect(f.calls).toEqual(['close']);f.controller.emitNativeClose();expect(f.calls).toEqual(['close']);}finally{f.destroy();}
});
test('a resolved presenter retains ordinary user close while generic refresh and viewer reset preserve their contracts',async()=>{
 const f=fixture();try{f.navigate(href);await f.answer();f.refresh();await f.fail(500);expect(f.controller.open).toBe(true);expect(f.controller.hasNativeCloseOwner).toBe(true);expect(f.calls).toEqual([]);f.controller.emitNativeClose();expect(f.calls).toEqual(['close']);f.calls.length=0;f.controller.viewer('replacement');runtime.flush();expect(f.controller.resolved).toBeNull();expect(f.controller.hasNativeCloseOwner).toBe(false);f.controller.emitNativeClose();expect(f.calls).toEqual([]);f.navigate(undefined);expect(f.controller.hasNativeCloseOwner).toBe(false);}finally{f.destroy();}
});
test('hidden initial player401 and reader500 request cleanup once without changing their foreground owner',async()=>{
 for(const [owner,status] of [['player',401],['reader',500]] as const){const f=fixture();try{f.foreground(owner,true);f.navigate(href);const state=f.controller.foregroundState;await f.fail(status);expect(f.calls).toEqual(['close']);expect(f.controller.resolved).toBeNull();expect(f.controller.hasNativeCloseOwner).toBe(false);expect(f.controller.foregroundState).toBe(state);f.controller.emitNativeClose();expect(f.calls).toEqual(['close']);}finally{f.destroy();}}
});
test('hidden terminal403 and real feature classifications withdraw the presenter and request cleanup exactly once',async()=>{
 for(const [owner,status,code] of [['player',403,undefined],['reader',403,undefined],['player',409,'feature_disabled'],['reader',409,'experimental_disabled']] as const){const f=fixture();try{f.navigate(href);await f.answer();f.foreground(owner,true);f.controller.emitNativeClose();expect(f.calls).toEqual([]);const state=f.controller.foregroundState;f.refresh();if(code)expect(isFeatureDisabled(new ApiError('Controlled withdrawal',status,{code}))).toBe(true);await f.fail(status,code?{code}:undefined);expect(f.controller.resolved).toBeNull();expect(f.controller.open).toBe(false);expect(f.controller.hasNativeCloseOwner).toBe(false);expect(f.calls).toEqual(['close']);expect(f.controller.foregroundState).toBe(state);f.controller.emitNativeClose();expect(f.calls).toEqual(['close']);}finally{f.destroy();}}
});
test('successful details retain ordinary hide suppression and resume close authority for player and reader',async()=>{
 for(const owner of ['player','reader'] as const){const f=fixture();try{f.navigate(href);await f.answer();const resolved=f.controller.resolved;f.foreground(owner,true);f.controller.emitNativeClose();expect(f.calls).toEqual([]);expect(f.controller.resolved).toBe(resolved);expect(f.controller.hasNativeCloseOwner).toBe(true);f.foreground(owner,false);f.controller.emitNativeClose();expect(f.calls).toEqual(['close']);}finally{f.destroy();}}
});
test('superseded target and viewer errors cannot publish cleanup after their effect has been aborted',async()=>{
 for(const replacement of ['target','viewer']){const f=fixture();try{f.navigate(href);await f.answer();f.refresh();const old=f.current();if(replacement==='target')f.navigate(other);else{f.controller.viewer('replacement');runtime.flush();}expect(old.signal.aborted).toBe(true);old.reject(new ApiError('Controlled superseded failure',403));await f.drain();expect(f.calls).toEqual([]);expect(f.controller.error).toBe('');await f.answer();expect(f.controller.open).toBe(true);expect(f.controller.hasNativeCloseOwner).toBe(true);expect(f.controller.resolved.href).toBe(replacement==='target'?other:href);expect(f.calls).toEqual([]);}finally{f.destroy();}}
});
test('generic different-target failure retains the existing Back path while a presenter is usable',async()=>{
 const f=fixture();try{f.navigate(href);await f.answer();const resolved=f.controller.resolved;f.navigate(other);await f.fail(500);expect(f.controller.resolved).toBe(resolved);expect(f.controller.hasNativeCloseOwner).toBe(true);expect(f.calls).toEqual(['back']);}finally{f.destroy();}
});
