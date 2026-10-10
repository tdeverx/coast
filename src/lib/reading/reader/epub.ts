import ePub, { type Location } from 'epubjs';
import { ZipReader, BlobReader, TextWriter, type FileEntry } from '@zip.js/zip.js';
import type { ReaderEngine,ReaderOptions } from './engine';
import { readerLoad } from './engine';
/** Sanitize before serialization; the no-script iframe is a second, independent boundary. */
export function sanitizeReadingDocument(doc:Document){
 for(const node of doc.querySelectorAll('script,iframe,object,embed,form,base,meta[http-equiv]'))node.remove();
 for(const node of doc.querySelectorAll('*'))for(const attribute of Array.from(node.attributes)){
  if(/^on/i.test(attribute.name)||attribute.name==='srcdoc'||/^(?:javascript|vbscript):/i.test(attribute.value.trim()))node.removeAttribute(attribute.name);
 }
 const policy=doc.createElement('meta');policy.setAttribute('http-equiv','Content-Security-Policy');policy.setAttribute('content',"default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; base-uri 'none'; form-action 'none'");(doc.head??doc.querySelector('head'))?.prepend(policy);
}
export async function epubReader({host,source,location,signal,changed}:ReaderOptions):Promise<ReaderEngine>{
 signal.throwIfAborted();
 let blob:Blob;
 if(typeof source==='string'){
  const response=await fetch(source,{signal});if(!response.ok)throw new Error('This EPUB could not be opened.');
  const chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;const stream=response.body!.getReader();
  try{while(true){const part=await stream.read();if(part.done)break;size+=part.value.byteLength;if(size>128*1024**2){await stream.cancel();throw new Error('EPUB files must be smaller than 128 MB.');}chunks.push(part.value);}}finally{stream.releaseLock();}
  blob=new Blob(chunks);
 }else blob=source;
 const archive=new ZipReader(new BlobReader(blob));let count=0,size=0;const entries=new Map<string,FileEntry>();
 try {
  for await(const entry of archive.getEntriesGenerator()) {
   signal.throwIfAborted();size+=entry.uncompressedSize;
   if(++count>10000||size>256*1024**2||entry.uncompressedSize>32*1024**2)throw new Error('This EPUB archive is too large.');
   if(!entry.directory){if(entries.has(entry.filename))throw new Error('This EPUB has duplicate archive entries.');entries.set(entry.filename,entry);}
  }
  async function documentAt(path:string){
   const entry=entries.get(path);if(!entry||entry.uncompressedSize>2*1024**2)throw new Error('This EPUB has an invalid package.');
   const xml=await entry.getData!(new TextWriter(),{signal,useWebWorkers:false});
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
 } finally {await archive.close();}
 const data=await readerLoad(blob.arrayBuffer(),signal);signal.throwIfAborted();
 const book=ePub();book.spine.hooks.content.register(sanitizeReadingDocument);
 let rendition:ReturnType<typeof book.renderTo>|undefined,closed=false;
 const abort=()=>{if(closed)return;closed=true;rendition?.destroy();book.destroy();};
 signal.addEventListener('abort',abort,{once:true});
 try {
 await readerLoad(book.open(data,'binary'),signal);await readerLoad(book.ready,signal);signal.throwIfAborted();
 const view=rendition=book.renderTo(host,{width:'100%',height:'100%',flow:'paginated',spread:'none',allowScriptedContent:false});
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
 await readerLoad(view.display(location?.format==='epub'?location.cfi:undefined),signal);
 return {previous:async()=>{await view.prev();},next:async()=>{await view.next();},go:async target=>{if(target.format==='epub'){requestedCfi=target.cfi;try{await view.display(target.cfi);}catch(cause){requestedCfi=undefined;throw cause;}}},destroy(){signal.removeEventListener('abort',abort);abort();}};
 }catch(cause){signal.removeEventListener('abort',abort);abort();throw cause;}
}
