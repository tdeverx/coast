import {expect,test} from 'bun:test';
import {compileRunes,moduleUrl} from './fixtures/ui-script';
const source=(await Bun.file('src/lib/reading/client.svelte.ts').text()).replace(/^import .*$/gm,'').replace(/^export /gm,'');
const {create}=await import(moduleUrl(compileRunes(`export function create(api,fetch,refreshAfterChange){
 const message=error=>error.message,isFeatureDisabled=()=>false;class ApiError extends Error{};
 ${source}
 return {reader,recordReading,touchReadingSession,closeReading,attachReading,publishReading};
}`)));
function fixture(){
 const privateCalls:string[]=[],sharedCalls:{url:string;body:string}[]=[],refreshes:string[]=[];
 const owner=create(async(path:string)=>{privateCalls.push(path);},async(url:string,options:{body:string})=>{sharedCalls.push({url,body:options.body});return Response.json({ok:true});},async(key:string)=>{refreshes.push(key);});
 return {owner,privateCalls,sharedCalls,refreshes};
}
const session={id:'guest',shared:true,workId:'book',kind:'book',title:'Shared book',format:'pdf',edition:'a'.repeat(64),source:'jellyfin',location:null,url:'/api/share/reading/guest/file'};
test('shared page turns stay local and heartbeat/close use only the scoped public capability routes',async()=>{
 const {owner,privateCalls,sharedCalls,refreshes}=fixture();owner.reader.session={...session};owner.reader.visible=true;
 expect(await owner.recordReading({format:'pdf',page:2,total:4})).toBe(true);
 expect(owner.reader.location).toEqual({format:'pdf',page:2,total:4});expect(owner.reader.unsaved).toBe(false);
 owner.publishReading('existing-owner-party',{format:'pdf',page:2,total:4});
 await owner.touchReadingSession(owner.reader.session);
 await owner.closeReading();
 expect(privateCalls).toEqual([]);expect(refreshes).toEqual([]);
 expect(sharedCalls).toEqual([{url:'/api/share/reading/guest/heartbeat',body:'{}'},{url:'/api/share/reading/guest/close',body:'{}'}]);
});
test('an already withdrawn shared attach retires only the new guest session and preserves an existing owner reader',async()=>{
 const {owner,privateCalls,sharedCalls,refreshes}=fixture();owner.reader.session={id:'existing-owner'};owner.reader.visible=true;
 const abort=new AbortController();abort.abort();await owner.attachReading({...session},abort.signal);
 expect(owner.reader.session.id).toBe('existing-owner');expect(owner.reader.visible).toBe(true);
 expect(sharedCalls).toEqual([{url:'/api/share/reading/guest/close',body:'{}'}]);
 expect(privateCalls).toEqual([]);expect(refreshes).toEqual([]);
});
