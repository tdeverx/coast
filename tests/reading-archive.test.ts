import {test,expect} from 'bun:test';
import {ZipReader,ZipWriter,BlobReader,BlobWriter,TextReader,TextWriter,type FileEntry} from '@zip.js/zip.js';
import {extractEpubEntry,prepareEpubArchive} from '../src/lib/reading/reader/epub-archive';

test('EPUB extraction enforces actual output and aggregate limits before retaining chunks',async()=>{
 const signal=new AbortController().signal;
 const entry=(size:number)=>({getData:async(writable:WritableStream)=>{const writer=writable.getWriter();try{await writer.write(new Uint8Array(size));await writer.close();}finally{writer.releaseLock();}}}) as Pick<FileEntry,'getData'>;
 await expect(extractEpubEntry(entry(9),signal,{used:0},8)).rejects.toThrow('too large');
 const budget={used:256*1024**2-8};
 await expect(extractEpubEntry(entry(9),signal,budget)).rejects.toThrow('too large');
 expect(budget.used).toBe(256*1024**2-8);
 expect((await extractEpubEntry(entry(8),signal,{used:0},8)).size).toBe(8);
 const closed=new AbortController();closed.abort();
 await expect(extractEpubEntry(entry(1),closed.signal,{used:0})).rejects.toMatchObject({name:'AbortError'});
});

test('EPUB preparation preserves legitimate assets in a verified stored archive',async()=>{
 const writer=new ZipWriter(new BlobWriter(),{useWebWorkers:false,level:0});
 const files={'META-INF/container.xml':'container','OPS/package.opf':'package','OPS/chapter.xhtml':'<html><body>Read me</body></html>','OPS/style.css':'p { color: red }'};
 for(const [name,text] of Object.entries(files))await writer.add(name,new TextReader(text));
 const data=await prepareEpubArchive(await writer.close(),new AbortController().signal,async read=>{
  expect(await read('META-INF/container.xml')).toBe('container');expect(await read('OPS/package.opf')).toBe('package');
 });
 const archive=new ZipReader(new BlobReader(new Blob([data])));
 try{for(const entry of await archive.getEntries())if(!entry.directory){expect(entry.compressionMethod).toBe(0);expect(await entry.getData(new TextWriter(),{useWebWorkers:false})).toBe(files[entry.filename as keyof typeof files]);}}
 finally{await archive.close();}
});
