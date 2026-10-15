import { ZipReader, HttpReader, BlobReader, BlobWriter, type FileEntry } from '@zip.js/zip.js';
import type { ReaderEngine,ReaderOptions } from './engine';
export async function comicReader({host,source,location,signal,changed}:ReaderOptions):Promise<ReaderEngine>{
 signal.throwIfAborted();
 const zip=new ZipReader(typeof source==='string'?new HttpReader(source,{useRangeHeader:true,fetch:(url,options)=>fetch(url,{...options,signal})}):new BlobReader(source));
 const entries:FileEntry[]=[];let expanded=0,count=0,image:HTMLImageElement|undefined,url:string|undefined;
 try {
 for await(const entry of zip.getEntriesGenerator()){
  expanded+=entry.uncompressedSize;if(expanded>512*1024**2||++count>10000){await zip.close();throw new Error('This comic archive is too large.');}
  signal.throwIfAborted();
  if(!entry.directory&&!entry.filename.startsWith('__MACOSX/')&&/\.(png|jpe?g|webp|gif)$/i.test(entry.filename))entries.push(entry);
 }
 entries.sort((a,b)=>a.filename.localeCompare(b.filename,undefined,{numeric:true}));
 if(!entries.length){await zip.close();throw new Error('No readable images were found in this comic.');}
 signal.throwIfAborted();
 const pageImage=image=document.createElement('img');pageImage.alt='Comic page';host.replaceChildren(pageImage);
 let page=location?.format==='cbz'?Math.min(location.page,entries.length):1,epoch=0;
 async function render(next:number){
  const revision=++epoch;page=Math.max(1,Math.min(entries.length,next));const entry=entries[page-1];
  if(entry.uncompressedSize>32*1024**2)throw new Error('This comic page is too large.');
  const blob=await entry.getData!(new BlobWriter(),{signal,useWebWorkers:false});if(signal.aborted||revision!==epoch)return;
  const nextUrl=URL.createObjectURL(blob);pageImage.src=nextUrl;
  try{await pageImage.decode();}catch{URL.revokeObjectURL(nextUrl);throw new Error('This comic page could not be displayed.');}
  if(signal.aborted||revision!==epoch){URL.revokeObjectURL(nextUrl);return;}
  if(pageImage.naturalWidth*pageImage.naturalHeight>32*1024**2){URL.revokeObjectURL(nextUrl);throw new Error('This comic page is too large.');}
  if(url)URL.revokeObjectURL(url);url=nextUrl;changed({format:'cbz',page,total:entries.length});
 }
 await render(page);
 return {previous:()=>render(page-1),next:()=>render(page+1),go:target=>render(target.format==='cbz'?target.page:page),destroy(){epoch++;if(url)URL.revokeObjectURL(url);pageImage.remove();void zip.close();}};
 }catch(cause){image?.remove();if(url)URL.revokeObjectURL(url);await zip.close();throw cause;}
}
