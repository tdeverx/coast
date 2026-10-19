import type { ReadingLocation } from '../model';
import type { ReaderOptions } from './engine';
import { openComicArchive, COMIC_PAGE_LIMIT } from './comic-archive';
import { readerLoad } from './load';
import { normalizeComicPages } from './physical/page-layout';
export type PhysicalPages = {
  count: number;
  page(index: number, signal: AbortSignal): Promise<HTMLCanvasElement>;
  location(index: number): ReadingLocation | undefined;
  pageFor(location: ReadingLocation | null): number;
  close(): Promise<void> | void;
};
async function imagePage(blob: Blob, signal: AbortSignal) {
  const pending = createImageBitmap(blob);
  void pending.then(bitmap => {
    if (signal.aborted)
      bitmap.close();
  }, () => {
  });
  const bitmap = await readerLoad(pending, signal);
  try {
    signal.throwIfAborted();
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32 * 1024 ** 2) {
      throw new Error('This comic page is too large.');
    }
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  finally {
    bitmap.close();
  }
}
export async function physicalPages(options: ReaderOptions): Promise<PhysicalPages> {
  const { source, format, signal } = options;
  signal.throwIfAborted();
  if (format === 'epub')
    throw new Error('EPUB uses its reflow reader.');
  if (format === 'pdf')
    return (await import('./physical-pdf')).physicalPdfPages(options);
  const archive = await openComicArchive(source, format, signal);
  const total = archive.entries.length;
  try {
    if (!total)
      throw new Error('No readable images were found in this comic.');
    const pages = await normalizeComicPages({
      count: total,
      async page(index: number, pageSignal: AbortSignal) {
        const entry = archive.entries[index];
        if (!entry || entry.size > COMIC_PAGE_LIMIT)
          throw new Error('This comic page is too large.');
        const owner = AbortSignal.any([signal, pageSignal]);
        const blob = await readerLoad(archive.read(entry.index, owner), owner);
        return imagePage(blob, owner);
      },
      close: () => archive.close(),
    }, signal);
    return {
      ...pages,
      location(index) {
        const original = pages.sourcePage(index);
        // Reaching the binding's end also passes any discarded trailing junk scan.
        return original === undefined ? undefined : { format, page: index === pages.count - 1 ? total : original + 1, total };
      },
      pageFor(location) {
        return location?.format === format ? pages.physicalPage(location.page - 1) + 1 : 1;
      },
    };
  }
  catch (cause) {
    await archive.close();
    throw cause;
  }
}
