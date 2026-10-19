import ePub, { type Location } from 'epubjs';
import { prepareEpubArchive } from './epub-archive';
import { sanitizeReadingDocument } from './epub-document';
import type { ReaderEngine,ReaderOptions } from './engine';
import { readerLoad } from './load';
import { ownEpubResources } from './epub-resources';
export async function epubReader({host,source,location,signal,changed}:ReaderOptions):Promise<ReaderEngine>{
 signal.throwIfAborted();
 let blob:Blob;
 if(typeof source==='string'){
  const response=await fetch(source,{signal});if(!response.ok)throw new Error('This EPUB could not be opened.');
  const chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;const stream=response.body!.getReader();
  try{while(true){const part=await stream.read();if(part.done)break;size+=part.value.byteLength;if(size>128*1024**2){await stream.cancel();throw new Error('EPUB files must be smaller than 128 MB.');}chunks.push(part.value);}}finally{stream.releaseLock();}
  blob=new Blob(chunks);
 }else blob=source;
 const data=await prepareEpubArchive(blob,signal,async readDocument=>{
  async function documentAt(path:string){
   const xml=await readDocument(path);
   const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw new Error('This EPUB has invalid metadata.');return doc;
  }
  const container=await documentAt('META-INF/container.xml');
  const path=container.querySelector('rootfile')?.getAttribute('full-path');
  if(!path||path.startsWith('/')||path.includes('..')||path.includes('\\')||path.includes(':'))throw new Error('This EPUB has an invalid package location.');
  const packageDoc=await documentAt(path);
  for(const item of packageDoc.querySelectorAll('manifest > item')) {
   const href=item.getAttribute('href')??'';let decoded:string;try{decoded=decodeURIComponent(href);}catch{throw new Error('This EPUB has an invalid resource.');}
   if(!href||/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(decoded)||decoded.includes('\\'))throw new Error('EPUB files with external resources are not supported.');
  }
 });
 signal.throwIfAborted();
 let rejectDisplay!:(cause:unknown)=>void;
 const displayFailure=new Promise<never>((_,reject)=>{rejectDisplay=reject;});
 void displayFailure.catch(()=>{});
 const book=ePub();
 const resources=ownEpubResources(book);
 book.spine.hooks.content.register((doc:Document,section:{unload():void})=>sanitizeReadingDocument(doc,section).catch(cause=>{rejectDisplay(cause);throw cause;}));
 let rendition:ReturnType<typeof book.renderTo>|undefined,closed=false;
 const abort=()=>{if(closed)return;closed=true;resources.destroy();try{rendition?.destroy();}finally{book.destroy();}};
 signal.addEventListener('abort',abort,{once:true});
 try {
 await display(book.open(data,'binary'));await display(book.ready);signal.throwIfAborted();
 const view=rendition=book.renderTo(host,{width:'100%',height:'100%',flow:'paginated',spread:'none',allowScriptedContent:false});
 // EPUB.js emits displayError without rejecting display(). Close the reader and settle our caller.
 view.on('displayError',(cause:unknown)=>{rejectDisplay(cause instanceof Error?cause:new Error('This EPUB chapter could not be displayed.'));abort();});
 async function display<T>(pending:Promise<T>){try{return await readerLoad(Promise.race([pending,displayFailure]),signal);}catch(cause){abort();throw cause;}}
 // Remove navigation to arbitrary origins; internal EPUB links remain reading locations.
 view.hooks.content.register((contents:{document:Document})=>{
  for(const link of contents.document.querySelectorAll('a[href]'))if(/^(?:[a-z]+:|\/\/)/i.test(link.getAttribute('href')??''))link.removeAttribute('href');
 });
 let requestedCfi=location?.format==='epub'?location.cfi:undefined;
 view.on('relocated',(position:Location)=>{
  if(signal.aborted)return;
  const section=book.spine.get(position.start.cfi);const fraction=position.atEnd?1:Math.max(0,Math.min(1,(section.index+(position.start.displayed.page-1)/Math.max(1,position.start.displayed.total))/Math.max(1,(book.spine as unknown as {length:number}).length)));
  const cfi=requestedCfi??position.start.cfi;requestedCfi=undefined;
  changed({format:'epub',cfi,fraction});
 });
 await display(view.display(location?.format==='epub'?location.cfi:undefined));
 return {previous:async()=>{if(closed)throw new Error('This reader is closed.');await display(view.prev());},next:async()=>{if(closed)throw new Error('This reader is closed.');await display(view.next());},go:async target=>{if(closed)throw new Error('This reader is closed.');if(target.format==='epub'){requestedCfi=target.cfi;try{await display(view.display(target.cfi));}catch(cause){requestedCfi=undefined;throw cause;}}},destroy(){signal.removeEventListener('abort',abort);abort();}};
 }catch(cause){signal.removeEventListener('abort',abort);abort();throw cause;}
}
