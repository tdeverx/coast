import { ZipReader, BlobReader, type FileEntry } from '@zip.js/zip.js';
import { readComicSource } from './comic-source';
import type { ReaderProgress } from './load';
import type { ComicFormat } from '../model';
import { COMIC_EXPANDED_LIMIT, COMIC_PAGE_LIMIT, COMIC_ENTRY_LIMIT, orderComicEntries, comicEntryName, comicImage, type ComicEntry, type ComicArchive } from './comic-pages';
export { COMIC_PAGE_LIMIT } from './comic-pages';
/** Bound actual output, rather than trusting an archive's declared page size. */
export async function zipComicPage(entry: Pick<FileEntry, 'getData'>, signal: AbortSignal) {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  await entry.getData!(new WritableStream<Uint8Array>({ write(chunk) {
      signal.throwIfAborted();
      size += chunk.byteLength;
      if (size > COMIC_PAGE_LIMIT)
        throw new Error('This comic page is too large.');
      chunks.push(new Uint8Array(chunk));
    } }), { signal, useWebWorkers: false });
  signal.throwIfAborted();
  return new Blob(chunks);
}
export async function openComicArchive(source: File | string, format: ComicFormat, signal: AbortSignal, progress?: (value: ReaderProgress) => void): Promise<ComicArchive> {
  signal.throwIfAborted();
  if (format !== 'cbz')
    return (await import('./archive')).openArchiveComic(source, format, signal, progress);
  const file = await readComicSource(source, signal, progress);
  signal.throwIfAborted();
  const zip = new ZipReader(new BlobReader(file));
  const files: FileEntry[] = [], entries: ComicEntry[] = [], names = new Set<string>();
  let expanded = 0, count = 0;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= zip.close();
  const abort = () => {
    void close().catch(() => {
    });
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const entry of zip.getEntriesGenerator()) {
      signal.throwIfAborted();
      expanded += entry.uncompressedSize;
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || expanded > COMIC_EXPANDED_LIMIT || ++count > COMIC_ENTRY_LIMIT)
        throw new Error('This comic archive is too large.');
      if (!entry.directory) {
        const filename = comicEntryName(entry.filename);
        if (names.has(filename))
          throw new Error('This comic contains duplicate page paths.');
        names.add(filename);
        if (comicImage(filename)) {
          entries.push({ filename, size: entry.uncompressedSize, index: files.length });
          files.push(entry);
        }
      }
    }
    return { entries: orderComicEntries(entries), read: (index, pageSignal) => zipComicPage(files[index], pageSignal), close: () => {
        signal.removeEventListener('abort', abort);
        return close();
      } };
  }
  catch (cause) {
    signal.removeEventListener('abort', abort);
    await close().catch(() => {
    });
    throw cause;
  }
}
