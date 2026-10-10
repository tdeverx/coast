import {test,expect} from 'bun:test';
import {ReadingHash} from '../src/lib/reading/reader/hash';
test('streamed edition identity matches SHA-256 across padding and stream boundaries',()=>{
 for(const size of [0,1,55,56,63,64,65,128,4097,1024*1024]){
  const bytes=crypto.getRandomValues(new Uint8Array(Math.min(size,65536)));const source=new Uint8Array(size);for(let i=0;i<size;i++)source[i]=bytes[i%bytes.length];
  const hash=new ReadingHash();for(let offset=0;offset<size;offset+=57)hash.update(source.subarray(offset,offset+57));
  expect(hash.digest()).toBe(new Bun.CryptoHasher('sha256').update(source).digest('hex'));
 }
});
