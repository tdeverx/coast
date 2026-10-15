import { ZipReader, HttpReader, BlobReader, BlobWriter, type FileEntry } from '@zip.js/zip.js';
import type { ReaderEngine, ReaderOptions } from './engine';
import { readerLoad } from './load';

type PageImage = { image: HTMLImageElement; url: string; released: boolean };

export async function comicReader({host,source,location,signal,changed}:ReaderOptions):Promise<ReaderEngine>{
 signal.throwIfAborted();
 const zip=new ZipReader(typeof source==='string'?new HttpReader(source,{useRangeHeader:true,fetch:(url,options)=>fetch(url,{...options,signal:options?.signal?AbortSignal.any([signal,options.signal]):signal})}):new BlobReader(source));
 const entries:FileEntry[]=[];
 let expanded=0,count=0,epoch=0,closed=false,page=1,renderedPage:number|undefined;
 let displayed:PageImage|undefined,pending:PageImage|undefined,closing:Promise<void>|undefined;
 let active:{page:number;controller:AbortController;promise:Promise<void>}|undefined;
 const closeArchive=()=>closing??=zip.close();
 function release(value:PageImage|undefined){
  if(!value||value.released)return;
  value.released=true;value.image.removeAttribute('src');value.image.remove();URL.revokeObjectURL(value.url);
 }
 function destroy(){
  if(closed)return;
  closed=true;epoch++;active?.controller.abort();release(pending);release(displayed);
  pending=displayed=undefined;signal.removeEventListener('abort',destroy);void closeArchive().catch(()=>{});
 }
 signal.addEventListener('abort',destroy,{once:true});
 try {
  for await(const entry of zip.getEntriesGenerator()){
   expanded+=entry.uncompressedSize;
   if(expanded>512*1024**2||++count>10000)throw new Error('This comic archive is too large.');
   signal.throwIfAborted();
   if(!entry.directory&&!entry.filename.startsWith('__MACOSX/')&&/\.(png|jpe?g|webp|gif)$/i.test(entry.filename))entries.push(entry);
  }
  entries.sort((a,b)=>a.filename.localeCompare(b.filename,undefined,{numeric:true}));
  if(!entries.length)throw new Error('No readable images were found in this comic.');
  page=location?.format==='cbz'?Math.max(1,Math.min(location.page,entries.length)):1;
  function render(next:number):Promise<void>{
   signal.throwIfAborted();
   if(closed)return Promise.resolve();
   const target=Math.max(1,Math.min(entries.length,next));
   if(active?.page===target)return active.promise;
   if(renderedPage===target){
    epoch++;active?.controller.abort();release(pending);pending=undefined;active=undefined;page=target;
    return Promise.resolve();
   }
   const revision=++epoch;active?.controller.abort();release(pending);pending=undefined;page=target;
   const operation={page:target,controller:new AbortController(),promise:Promise.resolve()};active=operation;
   const current=()=>!closed&&!signal.aborted&&revision===epoch;
   operation.promise=(async()=>{
    let resource:PageImage|undefined;
    try{
     const entry=entries[target-1];
     if(entry.uncompressedSize>32*1024**2)throw new Error('This comic page is too large.');
     const blob=await readerLoad(entry.getData!(new BlobWriter(),{signal:operation.controller.signal,useWebWorkers:false}),operation.controller.signal);
     if(!current())return;
     const image=document.createElement('img');image.alt='Comic page';
     resource={image,url:URL.createObjectURL(blob),released:false};pending=resource;image.src=resource.url;
     try{await readerLoad(image.decode(),operation.controller.signal);}catch(cause){
      if(!current())return;
      if(operation.controller.signal.aborted)throw cause;
      throw new Error('This comic page could not be displayed.');
     }
     if(!current())return;
     if(image.naturalWidth*image.naturalHeight>32*1024**2)throw new Error('This comic page is too large.');
     host.replaceChildren(image);release(displayed);displayed=resource;pending=undefined;renderedPage=target;
     changed({format:'cbz',page:target,total:entries.length});
    }catch(cause){if(current())throw cause;}
    finally{if(resource!==displayed)release(resource);if(pending===resource)pending=undefined;}
   })().finally(()=>{if(active===operation)active=undefined;});
   return operation.promise;
  }
  await render(page);signal.throwIfAborted();
  return {previous:()=>render(page-1),next:()=>render(page+1),go:target=>render(target.format==='cbz'?target.page:page),destroy};
 }catch(cause){destroy();await closeArchive().catch(()=>{});throw cause;}
}
