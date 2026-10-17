import {expect,test} from 'bun:test';
import * as v from 'valibot';
import {PAGE_SIZE,pagination,pageNumberSchema} from '../src/lib/server/queries/pagination';
const source=(await Bun.file(new URL('../src/lib/music/details.server.ts',import.meta.url)).text())
 .replace(/^import .*;\n/gm,'').replace('export async function musicChildren','async function musicChildren');
const compiled=new Bun.Transpiler({loader:'ts'}).transformSync(source);
const connection='11111111-1111-4111-8111-111111111111',signal=new AbortController().signal;
function fixture(totals=[125],kind='album',afterRead?:()=>void,expectedSignal=signal){
 const calls:{offset:number;limit:number;kind:string;albumId?:string;artistId?:string}[]=[];
 const read=new Function('v','PAGE_SIZE','pagination','pageNumberSchema','requireFeature','musicDetails','musicLibrary','musicCard',compiled+';return musicChildren;')(
  v,PAGE_SIZE,pagination,pageNumberSchema,async()=>{},async()=>({item:{id:'a'.repeat(32),kind}}),
  async(_user:unknown,id:string,options:typeof calls[number],requestSignal:AbortSignal)=>{
   expect(id).toBe(connection);expect(requestSignal).toBe(expectedSignal);calls.push(options);afterRead?.();
   const total=totals[Math.min(calls.length-1,totals.length-1)];
   return {total,items:Array.from({length:Math.max(0,Math.min(options.limit,total-options.offset))},(_,index)=>({id:String(options.offset+index)}))};
  },(item:unknown)=>item);
 return {calls,read:(page:number,requestSignal=expectedSignal)=>read('viewer','source',new URL(`http://coast/music?page=${page}&connectionId=${connection}&externalId=${'a'.repeat(32)}`),requestSignal)};
}
test('source children use one bounded shared-size page for normal album and artist browsing',async()=>{
 for(const kind of ['album','artist']){
  const f=fixture([125],kind),result=await f.read(2);
  expect(result).toMatchObject({page:2,pages:3,total:125});expect(result.items).toHaveLength(PAGE_SIZE);
  expect(f.calls).toEqual([{kind:kind==='album'?'track':'album',[kind==='album'?'albumId':'artistId']:'a'.repeat(32),limit:PAGE_SIZE,offset:PAGE_SIZE}]);
 }
});
test('stale music pages clamp and fetch the actual final page with at most one correction',async()=>{
 const f=fixture(),result=await f.read(999);
 expect(result).toMatchObject({page:3,pages:3,total:125});expect(result.items).toHaveLength(5);
 expect(result.items[0].id).toBe('120');expect(f.calls.map(call=>call.offset)).toEqual([998*PAGE_SIZE,120]);
});
test('empty or concurrently emptied libraries return valid page-one bounds without a retry loop',async()=>{
 for(const totals of [[0],[125,0]]){
  const f=fixture(totals),result=await f.read(999);
  expect(result).toEqual({items:[],page:1,pages:1,total:0});expect(f.calls).toHaveLength(totals.length);
 }
});
test('invalid pages fail before source reads and cancellation prevents a correction read',async()=>{
 const f=fixture();await expect(f.read(0)).rejects.toThrow();expect(f.calls).toHaveLength(0);
 const cancelled=new AbortController();cancelled.abort();
 await expect(f.read(999,cancelled.signal)).rejects.toMatchObject({name:'AbortError'});expect(f.calls).toHaveLength(0);
 const controller=new AbortController(),pending=fixture([125],'album',()=>controller.abort(),controller.signal);
 await expect(pending.read(999)).rejects.toMatchObject({name:'AbortError'});expect(pending.calls).toHaveLength(1);
});
