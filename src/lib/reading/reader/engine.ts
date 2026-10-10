import type { ReadingFormat, ReadingLocation } from '../model';
export type ReaderEngine = { previous():Promise<void>; next():Promise<void>; go(location:ReadingLocation):Promise<void>; resize?():Promise<void>; destroy():void };
export type ReaderOptions = {host:HTMLElement;source:File|string;format:ReadingFormat;location:ReadingLocation|null;signal:AbortSignal;changed:(location:ReadingLocation)=>void};
/** Stop awaiting uncancellable decoder work as soon as this reader is closed. */
export async function readerLoad<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
 let abort:()=>void;
 const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
 try{return await Promise.race([cancelled,pending]);}finally{signal.removeEventListener('abort',abort!);}
}
export async function createReader(options:ReaderOptions):Promise<ReaderEngine>{
 options.signal.throwIfAborted();
 if(options.format==='pdf')return (await import('./pdf')).pdfReader(options);
 if(options.format==='epub')return (await import('./epub')).epubReader(options);
 return (await import('./comic')).comicReader(options);
}
