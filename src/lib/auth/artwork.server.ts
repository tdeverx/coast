import { tmdbArtwork } from '#lib/providers/tmdb/artwork.js';
import { getSql } from '#lib/server/db/index.js';

let cached: { until: number; urls: Promise<string[]> } | undefined;
export function authArtwork() {
  if (!cached || cached.until <= Date.now()) {
    cached = { until: Date.now() + 60_000, urls: loadArtwork().catch(() => []) };
  }
  return cached.urls;
}

async function loadArtwork() {
  // Signed-out pages use public CDN artwork so private provider URLs stay on the server.
  const rows = await getSql()<{ path: string }[]>`
    select substring(backdrop_path from '/[^/]+$') as path
    from media
    where kind in ('movie', 'show')
      and backdrop_path ~ '^https://image[.]tmdb[.]org/t/p/(original|w1280|w780)/[a-zA-Z0-9_-]+[.](jpg|jpeg|png|webp)$'
    group by 1
    order by random()
    limit 8
  `;
  return rows.map(({ path }) => tmdbArtwork(path, 'w780')).filter(url => url !== undefined);
}
