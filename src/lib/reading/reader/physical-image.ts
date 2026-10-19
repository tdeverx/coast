import { readerLoad } from './load';
import type { Dimensions } from './physical/model';
/** Shared raster lifetime for Coast and its local physical-reader tuning host. */
export function physicalImage(blob: Blob, signal: AbortSignal, inspect: true, pixelLimit?: number): Promise<Dimensions>;
export function physicalImage(blob: Blob, signal: AbortSignal, inspect?: false, pixelLimit?: number): Promise<HTMLCanvasElement>;
export async function physicalImage(blob: Blob, signal: AbortSignal, inspect = false, pixelLimit = 32 * 1024 ** 2) {
  signal.throwIfAborted();
  const pending = createImageBitmap(blob);
  void pending.then(bitmap => {
    if (signal.aborted)
      bitmap.close();
  }, () => {
  });
  const bitmap = await readerLoad(pending, signal);
  try {
    signal.throwIfAborted();
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > pixelLimit) {
      throw new Error('This comic page is too large.');
    }
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
    if (inspect)
      return { width, height };
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  finally {
    bitmap.close();
  }
}
