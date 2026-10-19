import { expect, test } from 'bun:test';
import { ZipWriter, BlobWriter, TextReader } from '@zip.js/zip.js';
import { openComicArchive } from '../src/lib/reading/reader/comic-archive';
import { readComicSource } from '../src/lib/reading/reader/comic-source';
import type { ReaderProgress } from '../src/lib/reading/reader/load';
// Custom transport is scoped to each test and always restored.
async function transport<T>(respond: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = respond as typeof fetch;
  try {
    return await run();
  }
  finally {
    globalThis.fetch = original;
  }
}
test('a remote comic downloads once and backward/forward reads never refetch pages', async () => {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, level: 0 });
  for (let page = 1; page <= 4; page++)
    await writer.add(`${page}.png`, new TextReader(`Original page ${page}`));
  const file = await writer.close();
  let downloads = 0;
  const owner = new AbortController();
  await transport((async (_input, init) => {
    downloads++;
    expect(init?.signal).toBe(owner.signal);
    expect(new Headers(init?.headers).has('range')).toBe(false);
    return new Response(file);
  }), async () => {
    const archive = await openComicArchive('https://fixture.invalid/comic', 'cbz', owner.signal);
    try {
      for (const index of [0, 1, 2, 3, 1, 0, 3]) {
        expect(await (await archive.read(archive.entries[index].index, owner.signal)).text()).toBe(`Original page ${index + 1}`);
      }
      expect(downloads).toBe(1);
    }
    finally {
      await archive.close();
    }
  });
});
test('closing a pending comic download aborts its wait and cancels its stream', async () => {
  const owner = new AbortController();
  let cancelled = 0;
  await transport((async () => new Response(new ReadableStream({ cancel() {
      cancelled++;
    } }))), async () => {
    const opened = readComicSource('https://fixture.invalid/comic', owner.signal);
    await Promise.resolve();
    owner.abort();
    await expect(opened).rejects.toMatchObject({ name: 'AbortError' });
  });
  expect(cancelled).toBe(1);
});
test('local comics preserve their original bytes and closed owners never fetch', async () => {
  const file = new File(['original'], 'comic.cbz');
  expect(await readComicSource(file, new AbortController().signal)).toBe(file);
  const owner = new AbortController();
  owner.abort();
  await transport((() => {
    throw Error('Unexpected fetch');
  }), async () => {
    await expect(readComicSource('https://fixture.invalid/comic', owner.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
test('download progress reports actual bytes and leaves missing totals indeterminate', async () => {
  for (const known of [true,false]) {
    const progress:ReaderProgress[]=[];
    await transport((async () => new Response(new ReadableStream({start(controller){
      controller.enqueue(new Uint8Array([1,2]));
      controller.enqueue(new Uint8Array([3,4,5]));
      controller.close();
    }}),{headers:known?{'content-length':'5'}:{}})),async()=>{
      const file=await readComicSource('https://fixture.invalid/comic',new AbortController().signal,value=>progress.push(value));
      expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1,2,3,4,5]);
    });
    expect(progress.filter(value=>value.phase==='download').map(value=>value.loaded)).toEqual([0,0,2,5]);
    expect(progress.at(-2)?.total).toBe(known?5:undefined);
    expect(progress.at(-1)).toEqual({phase:'prepare'});
  }
});

// Opt-in regression over a privately acquired actual document; never generate large filler bytes.
const actualManifest=process.env.COAST_READING_LARGE_MANIFEST;
(actualManifest?test:test.skip)('actual comics above both former download caps preserve bytes with and without a declared size',async()=>{
  const [input]=await Bun.file(actualManifest!).json();
  const original=Bun.file(input.file);
  expect(original.size).toBe(input.bytes);
  expect(original.size).toBeGreaterThan(512*1024**2);
  const hash=async(blob:Blob)=>{
    const digest=new Bun.CryptoHasher('sha256');
    const stream=blob.stream().getReader();
    try {
      while (true) {
        const chunk = await stream.read();
        if (chunk.done)
          break;
        digest.update(chunk.value);
      }
    }
    finally {
      stream.releaseLock();
    }
    return digest.digest('hex');
  };
  expect(await hash(original)).toBe(input.sha256);
  const local=new File([original],'actual.cbz');
  expect(await readComicSource(local,new AbortController().signal)).toBe(local);
  for(const known of [true,false]){
    let downloaded=0;
    await transport((async()=>new Response(original.stream(),{headers:known?{'content-length':String(original.size)}:{}})),async()=>{
      const loaded=await readComicSource('https://actual-replay.invalid/comic',new AbortController().signal,progress=>{if(progress.phase==='download')downloaded=progress.loaded??0;});
      expect(loaded.size).toBe(original.size);
      expect(downloaded).toBe(original.size);
      expect(await hash(loaded)).toBe(input.sha256);
    });
  }
},120000);
