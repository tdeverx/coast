import wasmUrl from 'libarchive-wasm/dist/libarchive.wasm?url';
import {ComicDecoder} from './archive-decoder';
import type {ComicFormat} from '../model';
export type ArchiveCommand={id:number;type:'open';file:Blob;format:Exclude<ComicFormat,'cbz'>}|{id:number;type:'page';index:number};
let decoder:ComicDecoder|undefined;
self.onmessage=async({data}:MessageEvent<ArchiveCommand>)=>{
 try{
  if(data.type==='open'){
   decoder?.close();decoder=await ComicDecoder.open(await data.file.arrayBuffer(),data.format,{locateFile:()=>wasmUrl});
   self.postMessage({id:data.id,entries:decoder.entries});
  }else{
   if(!decoder)throw new Error('Open a comic archive first.');
   const page=decoder.read(data.index);self.postMessage({id:data.id,page},{transfer:[page]});
  }
 }catch(cause){
  const message=cause instanceof Error?cause.message:'';
  self.postMessage({id:data.id,error:/^(This comic|This file|Comic archives|Encrypted comic|No readable)/.test(message)?message:'This comic archive is damaged or unsupported.'});
 }
};
