import type { Dimensions } from './model.ts';
export type PageRegion = {
  index: number;
  x: number;
  width: number;
};
export type RasterSource = {
  count: number;
  dimensions?(index: number, signal: AbortSignal): Promise<Dimensions>;
  page(index: number, signal: AbortSignal): Promise<HTMLCanvasElement>;
  close?(): Promise<void> | void;
};
// Compare every scan against the document's typical single-page shape.
export function typicalPageRatio(dimensions: Dimensions[]) {
  const portraits = dimensions.filter(page => page.width <= page.height);
  const ratios = (portraits.length ? portraits : dimensions).map(page => page.width / page.height).sort((a, b) => a - b);
  const middle = Math.floor(ratios.length / 2);
  return ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2;
}
export function scanRegions(reference: Dimensions, scan: Dimensions) {
  const relative = scan.width / scan.height / (reference.width / reference.height);
  const spread = scan.width > scan.height && relative >= 1.6 && relative <= 2.5;
  if (!spread)
    return [{ x: 0, width: scan.width }];
  const middle = Math.floor(scan.width / 2);
  return [{ x: 0, width: middle }, { x: middle, width: scan.width - middle }];
}
export const finalSpreadIndex = (count: number) => Math.max(1, Math.floor((count - 3) / 2) * 2 + 1);
export const interiorPage = (index: number, count: number) => index >= 1 && index < count - 1 ? index : -1;
// Public numbers include the cover faces and select the nearest interior spread.
export function spreadForPage(page: number, count: number) {
  if (!Number.isFinite(page))
    throw new RangeError('Enter a valid page number.');
  return Math.max(1, Math.min(finalSpreadIndex(count), Math.floor((Math.trunc(page) - 2) / 2) * 2 + 1));
}
function cropScan(scan: HTMLCanvasElement, region: PageRegion) {
  if (region.x === 0 && region.width === scan.width)
    return scan;
  const canvas = document.createElement('canvas');
  canvas.width = region.width;
  canvas.height = scan.height;
  canvas.getContext('2d')!.drawImage(scan, region.x, 0, region.width, scan.height, 0, 0, region.width, scan.height);
  return canvas;
}
export async function normalizeComicPages<T extends RasterSource>(source: T, signal: AbortSignal, { crop = cropScan, sanitizeOddPages = true, onProgress = () => {
}, }: {
  crop?: typeof cropScan;
  sanitizeOddPages?: boolean;
  onProgress?: (current: number, total: number) => void;
} = {}) {
  const dimensions: Dimensions[] = [];
  let cached: {
    index: number;
    promise: Promise<HTMLCanvasElement>;
  } | undefined;
  // Retain dimensions and one decoded scan, never the whole document's pixels.
  for (let index = 0; index < source.count; index++) {
    signal.throwIfAborted();
    const canvas = source.dimensions ? await source.dimensions(index, signal) : await source.page(index, signal);
    signal.throwIfAborted();
    dimensions.push({ width: canvas.width, height: canvas.height });
    if (!source.dimensions)
      cached = { index, promise: Promise.resolve(canvas as HTMLCanvasElement) };
    onProgress(index + 1, source.count);
  }
  if (!dimensions.length)
    throw new Error('No readable images were found in this comic.');
  const reference = { width: typicalPageRatio(dimensions), height: 1 };
  const pages = dimensions.flatMap((scan, index) => scanRegions(reference, scan).map(region => ({ index, ...region })));
  // Preserve intentional trailing-face sanitization by default. Opting out
  // retains every scan/half, with unprinted faces that have no source location.
  if (sanitizeOddPages && pages.length > 1 && pages.length % 2)
    pages.pop();
  const spare = sanitizeOddPages ? 0 : Math.max(4, pages.length + pages.length % 2) - pages.length;
  if (spare) {
    const pairedBack = pages.length > 1 && pages[pages.length - 1].index === pages[pages.length - 2].index;
    const at = Math.max(1, pages.length - (pairedBack ? 2 : 1));
    // Preserve the outside back cover, and both halves of a wraparound scan.
    pages.splice(at, 0, ...Array.from({ length: spare }, () => ({ index: -1, x: 0, width: dimensions[0].width })));
  }
  return {
    ...source,
    count: pages.length,
    sourcePage: (index: number) => pages[index]?.index >= 0 ? pages[index].index : undefined,
    physicalPage(index: number) {
      const found = pages.findIndex(page => page.index >= index);
      let last = pages.length - 1;
      while (last > 0 && pages[last].index < 0)
        last--;
      return found < 0 ? last : found;
    },
    async page(index: number, pageSignal: AbortSignal) {
      pageSignal.throwIfAborted();
      const page = pages[index];
      if (!page)
        throw new RangeError('Comic page index is out of range.');
      if (page.index < 0) {
        const canvas = document.createElement('canvas');
        canvas.width = dimensions[0]?.width ?? 800;
        canvas.height = dimensions[0]?.height ?? 1200;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#f1ecdf';
        context.fillRect(0, 0, canvas.width, canvas.height);
        return canvas;
      }
      if (cached?.index !== page.index) {
        const entry = { index: page.index, promise: source.page(page.index, pageSignal) };
        cached = entry;
        void entry.promise.catch(() => {
          if (cached === entry)
            cached = undefined;
        });
      }
      const scan = await cached.promise;
      pageSignal.throwIfAborted();
      return crop(scan, page);
    },
    close() {
      cached = undefined;
      return source.close?.();
    },
  };
}
