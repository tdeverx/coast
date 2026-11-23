import {expect,test} from 'bun:test';
import {drainStderr,writeConsoleChunk} from '../scripts/container-stderr';
test('console writes keep the remainder after a short write or interruption',()=>{
  const output:number[]=[];
  let calls=0;
  writeConsoleChunk(new Uint8Array([1,2,3,4,5]),part=>{
    if(++calls===2)throw Object.assign(new Error('Interrupted'),{code:'EINTR'});
    const written=part.subarray(0,2);
    output.push(...written);
    return written.length;
  });
  expect(output).toEqual([1,2,3,4,5]);
  expect(calls).toBe(4);
});
test('an inherited pipe cannot conceal a completed child or change its status', async () => {
  let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('final evidence'));},cancel(){cancelled=true;}});
  const chunks:Uint8Array[]=[]; const started=performance.now();
  expect(await drainStderr(stream,Promise.resolve(7),bytes=>chunks.push(bytes))).toBe(7);
  expect(performance.now()-started).toBeLessThan(1000);
  expect(new TextDecoder().decode(chunks[0])).toBe('final evidence'); expect(cancelled).toBe(true);
});
test('reader/consumer errors cannot replace the completed child result', async () => {
  let calls=0;
  const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([1]));c.enqueue(new Uint8Array([2]));c.close();}});
  expect(await drainStderr(stream,Promise.resolve(17),()=>{calls++;throw Error('console unavailable');})).toBe(17);
  expect(calls).toBe(2);
});
