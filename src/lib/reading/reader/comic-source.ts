import { COMIC_INPUT_LIMIT } from './comic-pages';
import { readerLoad } from './load';
/** One bounded download per open archive; decoding and page turns read locally. */
export async function readComicSource(source: File | string, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  if (typeof source !== 'string') {
    if (source.size > COMIC_INPUT_LIMIT)
      throw new Error('Comic archives must be smaller than 128 MB.');
    return source;
  }
  const response = await fetch(source, { signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('This reading file is unavailable.');
  }
  if (Number(response.headers.get('content-length')) > COMIC_INPUT_LIMIT) {
    await response.body?.cancel();
    throw new Error('Comic archives must be smaller than 128 MB.');
  }
  if (!response.body)
    throw new Error('This comic archive is empty.');
  const stream = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await readerLoad(stream.read(), signal);
      if (chunk.done)
        break;
      size += chunk.value.byteLength;
      if (size > COMIC_INPUT_LIMIT)
        throw new Error('Comic archives must be smaller than 128 MB.');
      chunks.push(new Uint8Array(chunk.value));
    }
    return new Blob(chunks);
  }
  finally {
    await stream.cancel().catch(() => {
    });
    stream.releaseLock();
  }
}
