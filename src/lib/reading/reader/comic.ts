import type { ReaderEngine, ReaderOptions } from './engine';
import { readerLoad } from './load';
import {openComicArchive,COMIC_PAGE_LIMIT} from './comic-archive';

type PageImage = { image: HTMLImageElement; url: string; released: boolean };

export async function comicReader({host,source,format,location,signal,changed}:ReaderOptions):Promise<ReaderEngine>{
 signal.throwIfAborted();
 if(format==='pdf'||format==='epub')throw new Error('Choose a comic archive.');
 const comicFormat=format,archive=await openComicArchive(source,comicFormat,signal),entries=archive.entries;
 let epoch=0,closed=false,page=1,renderedPage:number|undefined;
 let displayed:PageImage|undefined,pending:PageImage|undefined,closing:Promise<void>|undefined;
 let active:{page:number;controller:AbortController;promise:Promise<void>}|undefined;
 const closeArchive=()=>closing??=archive.close();
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
  signal.throwIfAborted();
  if(!entries.length)throw new Error('No readable images were found in this comic.');
  page=location?.format===comicFormat?Math.max(1,Math.min(location.page,entries.length)):1;
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
     if(entry.size>COMIC_PAGE_LIMIT)throw new Error('This comic page is too large.');
     const blob=await readerLoad(archive.read(entry.index,operation.controller.signal),operation.controller.signal);
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
     changed({format:comicFormat,page:target,total:entries.length});
    }catch(cause){if(current())throw cause;}
    finally{if(resource!==displayed)release(resource);if(pending===resource)pending=undefined;}
   })().finally(()=>{if(active===operation)active=undefined;});
   return operation.promise;
  }
  await render(page);signal.throwIfAborted();
  return {previous:()=>render(page-1),next:()=>render(page+1),go:target=>render(target.format===comicFormat?target.page:page),destroy};
 }catch(cause){destroy();await closeArchive().catch(()=>{});throw cause;}
}
