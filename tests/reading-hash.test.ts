import {test,expect} from 'bun:test';
import {ReadingHash} from '../src/lib/reading/reader/hash';
test('streamed edition identity matches SHA-256 across padding and stream boundaries',()=>{
 for(const size of [0,1,55,56,63,64,65,128,4097,1024*1024]){
  const bytes=crypto.getRandomValues(new Uint8Array(Math.min(size,65536)));const source=new Uint8Array(size);for(let i=0;i<size;i++)source[i]=bytes[i%bytes.length];
  const hash=new ReadingHash();for(let offset=0;offset<size;offset+=57)hash.update(source.subarray(offset,offset+57));
  expect(hash.digest()).toBe(new Bun.CryptoHasher('sha256').update(source).digest('hex'));
 }
});


test('cancelling file identification terminates its worker before any digest arrives',async()=>{
 const {readingFileIdentity}=await import('../src/lib/reading/reader/file-identity');
 const Original=globalThis.Worker;let terminated=0;
 globalThis.Worker=class {postMessage(){}terminate(){terminated++;}} as unknown as typeof Worker;
 try{
  const abort=new AbortController(),reason=new DOMException('Closed','AbortError');
  const pending=readingFileIdentity(new File(['fixture'],'fixture.pdf'),abort.signal);abort.abort(reason);
  await expect(pending).rejects.toBe(reason);expect(terminated).toBe(1);
  await expect(readingFileIdentity(new File(['fixture'],'fixture.pdf'),abort.signal)).rejects.toBe(reason);expect(terminated).toBe(1);
 }finally{globalThis.Worker=Original;}
});
