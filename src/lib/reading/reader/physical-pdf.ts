import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ReaderOptions } from './engine';
import type { PhysicalPages } from './physical-pages';
import { readerLoad } from './load';
GlobalWorkerOptions.workerSrc = workerUrl;
export async function physicalPdfPages({ source, signal }: ReaderOptions): Promise<PhysicalPages> {
  const data = typeof source === 'string'
    ? { url: source, withCredentials: true }
    : { data: new Uint8Array(await readerLoad(source.arrayBuffer(), signal)) };
  signal.throwIfAborted();
  const loading = getDocument({ ...data, maxImageSize: 32 * 1024 ** 2, enableXfa: false });
  let closed = false;
  const close = () => {
    if (closed)
      return;
    closed = true;
    signal.removeEventListener('abort', close);
    void loading.destroy();
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    const document = await readerLoad(loading.promise, signal);
    if (document.numPages > 100000)
      throw new Error('This PDF has too many pages.');
    const total = document.numPages;
    // A spare face completes an odd binding; it never discards a PDF page.
    const count = Math.max(4, total + total % 2);
    return {
      count,
      async page(index, pageSignal) {
        const owner = AbortSignal.any([signal, pageSignal]);
        owner.throwIfAborted();
        const canvas = window.document.createElement('canvas');
        if (index >= total) {
          canvas.width = 800;
          canvas.height = 1200;
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#f1ecdf';
          context.fillRect(0, 0, canvas.width, canvas.height);
          return canvas;
        }
        const page = await readerLoad(document.getPage(index + 1), owner);
        try {
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2, 2048 / Math.max(natural.width, natural.height)) });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, background: '#ffffff' });
          const cancel = () => task.cancel();
          owner.addEventListener('abort', cancel, { once: true });
          try {
            await readerLoad(task.promise, owner);
            return canvas;
          }
          finally {
            owner.removeEventListener('abort', cancel);
          }
        }
        finally {
          page.cleanup();
        }
      },
      location: index => index < total ? { format: 'pdf', page: index + 1, total } : undefined,
      pageFor: location => location?.format === 'pdf' ? Math.max(1, Math.min(total, location.page)) : 1,
      close,
    };
  }
  catch (cause) {
    close();
    throw cause;
  }
}
