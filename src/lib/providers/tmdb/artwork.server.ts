import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createImageCache } from '#lib/server/storage/image-cache.server.js';
import { getConfig } from '#lib/server/config.js';
import { dataDirectory } from '#lib/server/security/credentials.js';
import { secureProviderFetch } from '#lib/server/security/provider-fetch.js';
import { createArtworkFlights } from '../artwork-flight.server';

const caches = new Map<string, ReturnType<typeof createImageCache>>();
const flights = createArtworkFlights();
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
  const cached = await cache.get(key, bytes => imageType(bytes) !== null);
  request.signal.throwIfAborted();
  if (cached) return respond(cached);
  const pendingKey = `${directory}/${key}`;
  // Bound aggregate memory/network work. Saturation still delivers artwork via the CDN.
  if (!flights.has(pendingKey) && flights.active >= 4) return new Response(null, { status: 302, headers: { Location: `${origin}/t/p${path}`, 'Cache-Control': 'no-store' } });
  const store = cache;
  const bytes = await flights.run(pendingKey, request.signal, async signal => {
      const upstream = await secureProviderFetch({ baseUrl: origin, approved: true }, `/t/p${path}`, {signal}, { maxBytes: 20 * 1024 * 1024 });
      if (signal.aborted) { await upstream.body?.cancel(); signal.throwIfAborted(); }
      if (!upstream.ok || !upstream.headers.get('content-type')?.startsWith('image/')) {
        await upstream.body?.cancel();
        return null;
      }
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      signal.throwIfAborted();
      if (!imageType(bytes)) return null;
      if ((await getConfig()).cacheTmdbArtwork) { signal.throwIfAborted(); await store.put(key, bytes); }
      return bytes;
  });
  request.signal.throwIfAborted();
  return bytes ? respond(bytes) : new Response('Image unavailable.', { status: 404 });
}
