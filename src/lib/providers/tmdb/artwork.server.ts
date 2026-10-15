import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createImageCache } from '$lib/server/storage/image-cache.server';
import { getConfig } from '$lib/server/config';
import { dataDirectory } from '$lib/server/security/credentials';
import { secureProviderFetch } from '$lib/server/security/provider-fetch';

const caches = new Map<string, ReturnType<typeof createImageCache>>();
type ArtworkDownload = {promise: Promise<Uint8Array | null>; controller: AbortController; waiters: number; settled: boolean};
const pending = new Map<string, ArtworkDownload>();
let activeDownloads = 0;
async function waitForArtwork(key: string, download: ArtworkDownload, signal: AbortSignal) {
  signal.throwIfAborted();
  download.waiters++;
  let aborted!: () => void;
  try {
    return await Promise.race([download.promise, new Promise<never>((_resolve, reject) => {
      aborted = () => reject(signal.reason ?? new DOMException('Artwork request cancelled.', 'AbortError'));
      signal.addEventListener('abort', aborted, {once: true});
      if (signal.aborted) aborted();
    })]);
  } finally {
    signal.removeEventListener('abort', aborted);
    download.waiters--;
    if (!download.waiters && !download.settled) {
      download.controller.abort();
      if (pending.get(key) === download) pending.delete(key);
    }
  }
}
const imagePath = /^\/(w342|w780|w1280|original)\/([a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp))$/;

/** Keep stored metadata canonical; only route displayed TMDB artwork through the cache when enabled. */
export function tmdbArtworkUrl(url: string | null | undefined, cache: boolean) {
  if (!cache || !url) return url;
  const match = /^https:\/\/image\.tmdb\.org\/t\/p(\/.*)$/.exec(url);
  return match && imagePath.test(match[1]) ? `/api/v1/artwork/tmdb${match[1]}` : url;
}
function imageType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'image/png';
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}
export async function streamTmdbArtwork(size: string, filename: string, request: Request) {
  request.signal.throwIfAborted();
  const path = `/${size}/${filename}`;
  if (!imagePath.test(path)) return new Response('Image not found.', { status: 404 });
  const origin = 'https://image.tmdb.org';
  const config = await getConfig();
  request.signal.throwIfAborted();
  if (!config.cacheTmdbArtwork)
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/t/p${path}`, 'Cache-Control': 'no-store' },
    });
  const directory = join(dataDirectory(), 'artwork', 'tmdb');
  const key = createHash('sha256').update(path).digest('hex') + '.image';
  let cache = caches.get(directory);
  if (!cache) { cache = createImageCache(directory); caches.set(directory, cache); }
  const respond = (bytes: Uint8Array) => {
    const type = imageType(bytes);
    return type
      ? new Response(new Uint8Array(bytes), {
          headers: {
            'Content-Type': type,
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      : new Response('Unsupported image.', { status: 502 });
  };
  const cached = await cache.get(key);
  request.signal.throwIfAborted();
  if (cached) return respond(cached);
  const pendingKey = `${directory}/${key}`;
  let download = pending.get(pendingKey);
  if (!download) {
    // Bound aggregate memory/network work. Saturation still delivers artwork via the CDN.
    if (activeDownloads >= 4) return new Response(null, { status: 302, headers: { Location: `${origin}/t/p${path}`, 'Cache-Control': 'no-store' } });
    const store = cache;
    const entry: ArtworkDownload = {promise: Promise.resolve(null), controller: new AbortController(), waiters: 0, settled: false};
    activeDownloads++;
    entry.promise = (async () => {
      const upstream = await secureProviderFetch({ baseUrl: origin, approved: true }, `/t/p${path}`, {signal: entry.controller.signal}, { maxBytes: 20 * 1024 * 1024 });
      if (!upstream.ok || !upstream.headers.get('content-type')?.startsWith('image/')) {
        await upstream.body?.cancel();
        return null;
      }
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      if (!imageType(bytes)) return null;
      if ((await getConfig()).cacheTmdbArtwork) { entry.controller.signal.throwIfAborted(); await store.put(key, bytes); }
      return bytes;
    })().finally(() => {
      entry.settled = true; activeDownloads--;
      if (pending.get(pendingKey) === entry) pending.delete(pendingKey);
    });
    download = entry; pending.set(pendingKey, entry);
  }
  const bytes = await waitForArtwork(pendingKey, download, request.signal);
  return bytes ? respond(bytes) : new Response('Image unavailable.', { status: 404 });
}
