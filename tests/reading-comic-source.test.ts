import { expect, test } from 'bun:test';
import { ZipWriter, BlobWriter, TextReader } from '@zip.js/zip.js';
import { openComicArchive } from '../src/lib/reading/reader/comic-archive';
import { readComicSource } from '../src/lib/reading/reader/comic-source';
import { COMIC_INPUT_LIMIT } from '../src/lib/reading/reader/comic-pages';
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
test('comic input bounds reject declared and actual oversize downloads and cancel bodies', async () => {
  let cancelled = 0;
  await transport((async () => new Response(new ReadableStream({ cancel() {
      cancelled++;
    } }), { headers: { 'content-length': String(COMIC_INPUT_LIMIT + 1) } })), async () => {
    await expect(readComicSource('https://fixture.invalid/comic', new AbortController().signal)).rejects.toThrow('128 MB');
  });
  expect(cancelled).toBe(1);
  await transport((async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(COMIC_INPUT_LIMIT + 1));
    }, cancel() {
      cancelled++;
    } }))), async () => {
    await expect(readComicSource('https://fixture.invalid/comic', new AbortController().signal)).rejects.toThrow('128 MB');
  });
  expect(cancelled).toBe(2);
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
