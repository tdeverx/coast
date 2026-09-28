import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from '$lib/server/config';
import { dataDirectory } from '$lib/server/security/credentials';
import { secureProviderFetch } from '$lib/server/security/provider-fetch';

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
  const path = `/${size}/${filename}`;
  if (!imagePath.test(path)) return new Response('Image not found.', { status: 404 });
  const origin = 'https://image.tmdb.org';
  if (!(await getConfig()).cacheTmdbArtwork)
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/t/p${path}`, 'Cache-Control': 'no-store' },
    });
  const directory = join(dataDirectory(), 'artwork', 'tmdb');
  const cachePath = join(directory, createHash('sha256').update(path).digest('hex') + '.image');
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
  try {
    return respond(await readFile(cachePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const upstream = await secureProviderFetch(
    { baseUrl: origin, approved: true },
    `/t/p${path}`,
    { signal: request.signal },
    { maxBytes: 20 * 1024 * 1024 }
  );
  if (!upstream.ok || !upstream.headers.get('content-type')?.startsWith('image/')) {
    await upstream.body?.cancel();
    return new Response('Image unavailable.', { status: 404 });
  }
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (!imageType(bytes)) return new Response('Unsupported image.', { status: 502 });
  // A setting changed during the download must stop new disk writes too.
  if ((await getConfig()).cacheTmdbArtwork) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${cachePath}.${crypto.randomUUID()}`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, cachePath);
  }
  return respond(bytes);
}
