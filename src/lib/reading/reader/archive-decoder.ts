import {libarchiveWasm,type LibarchiveWasm} from 'libarchive-wasm';
import {comicEntryName,comicImage,orderComicEntries,COMIC_INPUT_LIMIT,COMIC_EXPANDED_LIMIT,COMIC_PAGE_LIMIT,COMIC_ENTRY_LIMIT,type ComicEntry} from './comic-pages';
import type {ComicFormat} from '../model';

/** Worker-owned compressed bytes and a single forward cursor; no extracted-page cache. */
export class ComicDecoder {
 private archive=0;private pointer=0;private length=0;private cursor=-1;
 readonly entries:ComicEntry[]=[];
 private constructor(private mod:LibarchiveWasm){}
 static async open(data:ArrayBuffer,format:Exclude<ComicFormat,'cbz'>,options:object={}){
  if(!data.byteLength||data.byteLength>COMIC_INPUT_LIMIT)throw new Error('Comic archives must be smaller than 128 MB.');
  const bytes=new Uint8Array(data);
  const rar=bytes[0]===0x52&&bytes[1]===0x61&&bytes[2]===0x72&&bytes[3]===0x21&&bytes[4]===0x1a&&bytes[5]===7;
  const seven=bytes[0]===0x37&&bytes[1]===0x7a&&bytes[2]===0xbc&&bytes[3]===0xaf&&bytes[4]===0x27&&bytes[5]===0x1c;
  if(format==='cbr'&&!rar||format==='cb7'&&!seven||format==='cbt'&&!tarHeader(bytes))throw new Error('This file does not contain the selected comic archive format.');
  const decoder=new ComicDecoder(await libarchiveWasm(options));
  try{
   decoder.length=bytes.length;decoder.pointer=decoder.mod.module._malloc(bytes.length);
   if(!decoder.pointer)throw new Error('This comic archive is too large.');
   decoder.mod.module.HEAPU8.set(bytes,decoder.pointer);decoder.reset();
   let expanded=0,index=0;const names=new Set<string>();
   for(let entry=decoder.next();entry;entry=decoder.next()){
    const size=decoder.mod.entry_size(entry);expanded+=size;
    if(!Number.isSafeInteger(size)||size<0||expanded>COMIC_EXPANDED_LIMIT||index>=COMIC_ENTRY_LIMIT)throw new Error('This comic archive is too large.');
    if(decoder.mod.entry_is_encrypted(entry))throw new Error('Encrypted comic archives are not supported.');
    // Links and devices never become comic pages.
    if(decoder.mod.entry_filetype(entry)===0o100000&&!decoder.mod.entry_hardlink(entry)){
     const filename=comicEntryName(decoder.mod.entry_pathname(entry));
     if(names.has(filename))throw new Error('This comic contains duplicate page paths.');names.add(filename);
     if(comicImage(filename))decoder.entries.push({filename,size,index});
    }
    decoder.mod.read_data_skip(decoder.archive);index++;
   }
   if(!decoder.entries.length)throw new Error('No readable images were found in this comic.');
   orderComicEntries(decoder.entries);decoder.reset();return decoder;
  }catch(cause){decoder.close();throw cause;}
 }
 private next(){
  const entry=this.mod.read_next_entry(this.archive);
  if(!entry&&this.mod.error_string(this.archive))throw new Error('This comic archive is damaged or unsupported.');
  return entry;
 }
 private reset(){
  if(this.archive)this.mod.read_free(this.archive);this.archive=0;this.cursor=-1;
  this.archive=this.mod.read_new_memory(this.pointer,this.length);
 }
 read(index:number):ArrayBuffer{
  const selected=this.entries.find(entry=>entry.index===index);
  if(!selected)throw new Error('This comic page was not found.');
  if(selected.size>COMIC_PAGE_LIMIT)throw new Error('This comic page is too large.');
  if(this.cursor>=index)this.reset();
  let entry=0;
  while(this.cursor<index){entry=this.next();if(!entry)throw new Error('This comic archive is incomplete.');this.cursor++;if(this.cursor<index)this.mod.read_data_skip(this.archive);}
  // A fixed chunk allocation bounds actual output even when size headers are false.
  const chunkSize=64*1024,ptr=this.mod.module._malloc(chunkSize),chunks:Uint8Array[]= [];let used=0;
  if(!ptr)throw new Error('This comic page is too large.');
  try{
   while(true){const size=this.mod.read_data(this.archive,ptr,chunkSize);if(!size)break;used+=size;if(used>COMIC_PAGE_LIMIT)throw new Error('This comic page is too large.');chunks.push(this.mod.module.HEAPU8.slice(ptr,ptr+size));}
   if(used!==selected.size)throw new Error('This comic page is incomplete.');
   const data=new Uint8Array(used);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}return data.buffer;
  }finally{this.mod.module._free(ptr);}
 }
 close(){try{if(this.archive)this.mod.read_free(this.archive);}finally{this.archive=0;if(this.pointer)this.mod.module._free(this.pointer);this.pointer=0;this.length=0;}}
}
function tarHeader(bytes:Uint8Array){
 if(bytes.length<512)return false;let checksum=0;
 for(let i=0;i<512;i++)checksum+=i>=148&&i<156?32:bytes[i];
 const stored=new TextDecoder().decode(bytes.subarray(148,156)).replace(/\0.*$/,'').trim();
 return /^[0-7]+$/.test(stored)&&parseInt(stored,8)===checksum;
}
