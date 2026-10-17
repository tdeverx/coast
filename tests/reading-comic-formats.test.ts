import {expect,test} from 'bun:test';
import {ComicDecoder} from '../src/lib/reading/reader/archive-decoder';
import {zipComicPage} from '../src/lib/reading/reader/comic-archive';
import {rarComic,tarComic,sevenComic} from './fixtures/comic-archives';
const text=new TextEncoder(),files={'page10.png':text.encode('page ten'),'page2.png':text.encode('page two')};

test('real RAR, 7z and TAR decoders sort naturally, extract one page and support backwards/repeated seeks',async()=>{
 for(const [format,data] of [['cbr',rarComic(files)],['cb7',sevenComic()],['cbt',tarComic(files)]] as const){
  const decoder=await ComicDecoder.open(data,format);
  try{
   expect(decoder.entries.map(e=>e.filename)).toEqual(['page2.png','page10.png']);
   for(const n of [0,1,1,0])expect(new TextDecoder().decode(decoder.read(decoder.entries[n].index))).toBe(n?'page ten':'page two');
   expect(()=>decoder.read(99)).toThrow('not found');
  }finally{decoder.close();decoder.close();}
 }
});
test('archives reject wrong containers, traversal, duplicate paths, damaged input and excessive pages',async()=>{
 await expect(ComicDecoder.open(tarComic(files),'cbr')).rejects.toThrow('format');
 await expect(ComicDecoder.open(rarComic(files),'cb7')).rejects.toThrow('format');
 await expect(ComicDecoder.open(tarComic({'../page.png':text.encode('bad')}),'cbt')).rejects.toThrow('path');
 await expect(ComicDecoder.open(tarComic({'x\\page.png':text.encode('bad'),'x/page.png':text.encode('bad')}),'cbt')).rejects.toThrow('duplicate');
 await expect(ComicDecoder.open(rarComic(files).slice(0,20),'cbr')).rejects.toThrow();
 await expect(ComicDecoder.open(tarComic({'page.png':new Uint8Array(33*1024**2)}),'cbt').then(d=>{try{d.read(d.entries[0].index);}finally{d.close();}})).rejects.toThrow('too large');
});
test('ZIP extraction enforces actual page bytes even when an entry understates its size',async()=>{
 const entry={getData:async(stream:WritableStream<Uint8Array>)=>{const writer=stream.getWriter();try{await writer.write(new Uint8Array(32*1024**2+1));}finally{writer.releaseLock();}}};
 await expect(zipComicPage(entry as never,new AbortController().signal)).rejects.toThrow('too large');
});
