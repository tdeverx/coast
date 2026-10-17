import type {ComicFormat} from '../model';
import {COMIC_INPUT_LIMIT,type ComicArchive,type ComicEntry} from './comic-pages';
import type {ArchiveCommand} from './archive.worker';
import {readerLoad} from './load';
type Reply={id:number;error?:string;entries?:ComicEntry[];page?:ArrayBuffer};
type Command=ArchiveCommand extends infer C?C extends ArchiveCommand?Omit<C,'id'>:never:never;
/** One worker per open archive. Cancellation terminates native decoding, not just its await. */
export async function openArchiveComic(source:File|string,format:Exclude<ComicFormat,'cbz'>,signal:AbortSignal):Promise<ComicArchive>{
 const file=typeof source==='string'?await download(source,signal):source;
 signal.throwIfAborted();if(file.size>COMIC_INPUT_LIMIT)throw new Error('Comic archives must be smaller than 128 MB.');
 let worker:Worker|undefined,ready=false,closed=false,serial=0;
 const waiting=new Map<number,{resolve:(reply:Reply)=>void;reject:(reason:unknown)=>void}>();
 function stop(reason:unknown){const current=worker;worker=undefined;ready=false;current?.terminate();for(const request of waiting.values())request.reject(reason);waiting.clear();}
 const abort=()=>{closed=true;stop(signal.reason);};signal.addEventListener('abort',abort,{once:true});
 function request(command:Command,owner:AbortSignal):Promise<Reply>{
  owner.throwIfAborted();signal.throwIfAborted();if(closed)throw new DOMException('Reader closed.','AbortError');
  const current=worker??=new Worker(new URL('./archive.worker.ts',import.meta.url),{type:'module'});
  current.onmessage=({data}:MessageEvent<Reply>)=>{const pending=waiting.get(data.id);if(!pending)return;waiting.delete(data.id);data.error?pending.reject(new Error(data.error)):pending.resolve(data);};
  current.onerror=event=>{event.preventDefault();if(worker===current)stop(new Error('This comic archive could not be decoded.'));};
  const id=++serial;
  const cancel=()=>{if(worker===current)stop(owner.reason);};
  // Bound synchronous native decoder work; terminating the worker also releases its heap.
  const timeout=setTimeout(()=>{if(worker===current)stop(new Error('This comic archive took too long to decode.'));},30000);
  owner.addEventListener('abort',cancel,{once:true});
  return new Promise<Reply>((resolve,reject)=>{waiting.set(id,{resolve,reject});try{current.postMessage({...command,id});}catch(cause){stop(cause);}})
   .finally(()=>{clearTimeout(timeout);owner.removeEventListener('abort',cancel);});
 }
 async function initialize(owner:AbortSignal){const result=await request({type:'open',file,format},owner);owner.throwIfAborted();signal.throwIfAborted();ready=true;return result.entries!;}
 try{
  const entries=await initialize(signal);
  return {entries,async read(index,owner){if(!ready)await initialize(owner);const reply=await request({type:'page',index},owner);return new Blob([reply.page!]);},async close(){closed=true;signal.removeEventListener('abort',abort);stop(new DOMException('Reader closed.','AbortError'));}};
 }catch(cause){signal.removeEventListener('abort',abort);stop(cause);throw cause;}
}
async function download(url:string,signal:AbortSignal){
 const response=await fetch(url,{signal});if(!response.ok){await response.body?.cancel();throw new Error('This reading file is unavailable.');}
 if(Number(response.headers.get('content-length'))>COMIC_INPUT_LIMIT){await response.body?.cancel();throw new Error('Comic archives must be smaller than 128 MB.');}
 if(!response.body)throw new Error('This comic archive is empty.');
 const stream=response.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
 try{while(true){const chunk=await readerLoad(stream.read(),signal);if(chunk.done)break;size+=chunk.value.byteLength;if(size>COMIC_INPUT_LIMIT)throw new Error('Comic archives must be smaller than 128 MB.');chunks.push(new Uint8Array(chunk.value));}return new Blob(chunks);}
 finally{await stream.cancel().catch(()=>{});stream.releaseLock();}
}
