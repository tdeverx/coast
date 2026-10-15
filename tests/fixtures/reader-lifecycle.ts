// A separate process isolates DOM/decoder boundaries from other Bun test suites.
import {expect,mock} from 'bun:test';
import {ZipReader,ZipWriter,BlobWriter,TextReader} from '@zip.js/zip.js';
import {comicReader} from '../../src/lib/reading/reader/comic';
import type {ReaderOptions} from '../../src/lib/reading/reader/engine';
const deferred=<T=void>()=>{let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
let extraction=0;
const entries=ZipReader.prototype.getEntriesGenerator;
ZipReader.prototype.getEntriesGenerator=async function*(...args){
 for await(const entry of entries.apply(this,args)){
  if(!entry.directory&&entry.getData){const read=entry.getData.bind(entry);entry.getData=(...input)=>{extraction++;return read(...input);};}
  yield entry;
 }
 return true;
};
async function archive(pages:number){
 const writer=new ZipWriter(new BlobWriter(),{level:0,useWebWorkers:false});
 for(let i=0;i<pages;i++)await writer.add(`${i+1}.png`,new TextReader('Synthetic page; decoding is the controlled boundary.'));
 return new File([await writer.close()],'fixture.cbz');
}
class Image {
 alt='';src='';naturalWidth=1;naturalHeight=1;removed=false;
 decode(){return decode(this);}
 removeAttribute(name:string){if(name==='src')this.src='';}
 remove(){this.removed=true;}
}
let decode:(_image:Image)=>Promise<void>=()=>Promise.resolve();
let images:Image[]=[],allocated:string[]=[],revoked:string[]=[],changes:number[]=[];
URL.createObjectURL=()=>{const value=`blob:fixture-${allocated.length}`;allocated.push(value);return value;};
URL.revokeObjectURL=url=>{expect(revoked).not.toContain(url);revoked.push(url);};
globalThis.document={createElement:()=>{const image=new Image();images.push(image);return image;}} as unknown as Document;
function options(source:File,controller:AbortController):ReaderOptions{
 return {source,host:{replaceChildren(){}} as unknown as HTMLElement,signal:controller.signal,format:'cbz',location:null,changed:location=>{if(location.format==='cbz')changes.push(location.page);}};
}
function reset(){extraction=0;images=[];allocated=[];revoked=[];changes=[];decode=()=>Promise.resolve();}
const one=await archive(1),two=await archive(2);

// Initial decode never settles; abort must settle opening and retire the URL.
reset();{
 const controller=new AbortController(),started=deferred(),pending=deferred();
 decode=()=>{started.resolve();return pending.promise;};
 const opened=comicReader(options(one,controller));await started.promise;controller.abort();
 await expect(opened).rejects.toMatchObject({name:'AbortError'});
 expect(revoked).toEqual(allocated);expect(images.every(image=>image.removed&&image.src==='')).toBe(true);expect(changes).toEqual([]);
 pending.reject(Error('Late decoder failure'));await settle();
}
// Boundary turns and repeated remote locations do not extract/decode again.
reset();{
 const controller=new AbortController(),engine=await comicReader(options(one,controller));
 await engine.previous();await engine.previous();await engine.next();await engine.go({format:'cbz',page:1,total:1});
 expect(extraction).toBe(1);expect(images).toHaveLength(1);expect(changes).toEqual([1]);
 engine.destroy();engine.destroy();expect(revoked).toEqual(allocated);
}
// Later navigation owns pending and displayed resources, and equal pending targets coalesce.
reset();{
 const controller=new AbortController(),engine=await comicReader(options(two,controller)),started=deferred(),pending=deferred();
 decode=()=>{started.resolve();return pending.promise;};
 const next=engine.next();await started.promise;
 expect(engine.go({format:'cbz',page:2,total:2})).toBe(next);
 controller.abort();await next;engine.destroy();
 expect(revoked).toHaveLength(2);expect(images.every(image=>image.removed&&image.src==='')).toBe(true);expect(changes).toEqual([1]);
 pending.resolve();await settle();expect(changes).toEqual([1]);
}
// Returning to the displayed page cancels a pending replacement without decoding it again.
reset();{
 const controller=new AbortController(),engine=await comicReader(options(two,controller)),started=deferred(),pending=deferred();
 decode=()=>{started.resolve();return pending.promise;};
 const next=engine.next();await started.promise;await engine.go({format:'cbz',page:1,total:2});await next;
 pending.reject(Error('Superseded decoder'));await settle();expect(changes).toEqual([1]);expect(extraction).toBe(2);
 expect(images[0].removed).toBe(false);expect(images[1].removed).toBe(true);engine.destroy();expect(revoked).toEqual([...allocated].reverse());
}
// A failed later page can retry; failure does not mark it rendered.
reset();{
 const controller=new AbortController(),engine=await comicReader(options(two,controller));
 decode=()=>Promise.reject(Error('Bad decoder'));await expect(engine.next()).rejects.toThrow('could not be displayed');
 decode=()=>Promise.resolve();await engine.go({format:'cbz',page:2,total:2});expect(changes).toEqual([1,2]);expect(extraction).toBe(3);
 engine.destroy();expect(revoked).toHaveLength(allocated.length);
}
// Destroy (without a signal change) also drains an in-progress page decode.
reset();{
 const controller=new AbortController(),engine=await comicReader(options(two,controller)),started=deferred();
 decode=()=>{started.resolve();return new Promise<void>(()=>{});};
 const next=engine.next();await started.promise;engine.destroy();await next;
 expect(revoked).toHaveLength(2);expect(changes).toEqual([1]);
}

let pageReads=0,renders=0,fail=false;
const page={getViewport:({scale}:{scale:number})=>({width:100*scale,height:100*scale}),cleanup(){},render(){renders++;return {cancel(){},promise:fail?Promise.reject(Error('Raster failed')):Promise.resolve()};}};
const pdf={numPages:2,getPage:async()=>{pageReads++;return page;}};
mock.module('pdfjs-dist',()=>({GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(pdf),destroy:async()=>{}})}));
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url',()=>({default:'synthetic-worker'}));
globalThis.window={devicePixelRatio:1,document:{createElement:()=>({setAttribute(){},style:{},getContext:()=>({}),remove(){}})}} as unknown as Window & typeof globalThis;
const {pdfReader}=await import('../../src/lib/reading/reader/pdf');
const pdfOptions={...options(one,new AbortController()),host:{clientWidth:300,clientHeight:300,replaceChildren(){}} as unknown as HTMLElement,format:'pdf' as const,changed:()=>{}};
{
 const engine=await pdfReader(pdfOptions);await engine.previous();await engine.go({format:'pdf',page:1,total:2});
 expect({pageReads,renders}).toEqual({pageReads:1,renders:1});
 await engine.resize!();expect({pageReads,renders}).toEqual({pageReads:2,renders:2});
 await engine.next();await engine.next();expect({pageReads,renders}).toEqual({pageReads:3,renders:3});engine.destroy();
}
{
 pageReads=renders=0;const engine=await pdfReader(pdfOptions);fail=true;await expect(engine.next()).rejects.toThrow('Raster failed');
 fail=false;await engine.go({format:'pdf',page:2,total:2});expect({pageReads,renders}).toEqual({pageReads:3,renders:3});engine.destroy();
}
{
 pageReads=renders=0;const engine=await pdfReader(pdfOptions);fail=true;await expect(engine.next()).rejects.toThrow('Raster failed');
 fail=false;await engine.go({format:'pdf',page:1,total:2});expect({pageReads,renders}).toEqual({pageReads:3,renders:3});
 fail=true;await expect(engine.resize!()).rejects.toThrow('Raster failed');fail=false;
 await engine.go({format:'pdf',page:1,total:2});expect({pageReads,renders}).toEqual({pageReads:5,renders:5});engine.destroy();
}
console.log(JSON.stringify({comicCases:6,pdfCases:3}));
