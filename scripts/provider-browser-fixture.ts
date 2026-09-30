/** Synthetic, disposable browser QA only. Never points to an existing Coast database. */
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq } from 'drizzle-orm';
import { getDb, closeDb } from '../src/lib/server/db';
import { users, systemSettings, externalIds } from '../src/lib/server/db/schema';
import { defaultConfig } from '../src/lib/server/config';
import { configureInstance } from '../src/lib/providers/instances.server';
import { connectJellyfin } from '../src/lib/providers/jellyfin/connection.server';
import { scanJellyfinLibrary, syncJellyfinUser } from '../src/lib/sync/jellyfin';

if (!process.env.DATABASE_URL?.endsWith('/coast_browser_test'))
  throw new Error('Use only the disposable coast_browser_test database.');
if (!process.env.COAST_DATA_DIR?.includes('coast-browser'))
  throw new Error('Use an isolated COAST_DATA_DIR containing coast-browser.');
const address = Object.values(networkInterfaces())
  .flat()
  .find(
    (i) =>
      i &&
      !i.internal &&
      i.family === 'IPv4' &&
      /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)
  )?.address;
if (!address)
  throw new Error('A private LAN interface is required; loopback policy remains enforced.');
await migrate(getDb(), { migrationsFolder: join(import.meta.dir, '../drizzle') });
const username = 'fixtureadmin',
  password = 'Coast-fixture-password';
const existing = await getDb().select().from(users).where(eq(users.username, username));
const actor =
  existing[0] ||
  (
    await getDb()
      .insert(users)
      .values({
        username,
        passwordHash: await Bun.password.hash(password, { algorithm: 'argon2id' }),
        role: 'admin',
      })
      .returning()
  )[0];
const source = (id: string, direct: boolean, itemId = 'browser-movie') => ({
  Id: id,
  Name: direct ? 'Original' : 'Cinema',
  Container: direct ? 'mp4' : 'mkv',
  Bitrate: direct ? 1000000 : 80000000,
  RunTimeTicks: 600000000,
  SupportsDirectPlay: direct,
  SupportsTranscoding: !direct,
  TranscodingUrl: direct ? undefined : `/Videos/${itemId}/master.m3u8?api_key=fixture-upstream`,
  MediaStreams: [
    { Index: 0, Type: 'Video', Codec: direct ? 'h264' : 'hevc', Width: 320, Height: 180 },
    { Index: 1, Type: 'Subtitle', Codec: 'vtt', Language: 'en', DisplayTitle: 'English' },
  ],
});
const movie = {
  Id: 'browser-movie',
  Name: 'Coast Playback Fixture',
  OriginalTitle: 'Coast Playback Fixture',
  Type: 'Movie',
  Overview:
    'A synthetic local media source for testing playback, navigation, subtitles and settings. No external provider credentials are used.',
  ProductionYear: 2026,
  RunTimeTicks: 600000000,
  MediaSources: [source('fixture-direct', true), source('fixture-hls', false)],
};
const show = {
  Id: 'browser-show',
  Name: 'Coast Series Fixture',
  Type: 'Series',
  ProductionYear: 2026,
  Overview: 'A synthetic series for next-episode, post-play and resume verification.',
};
const season = {
  Id: 'browser-season-one',
  Name: 'Season 1',
  Type: 'Season',
  SeriesId: show.Id,
  ParentId: show.Id,
  IndexNumber: 1,
};
const specials = {
  Id: 'browser-specials',
  Name: 'Specials',
  Type: 'Season',
  SeriesId: show.Id,
  ParentId: show.Id,
  IndexNumber: 0,
};
const episode = (id: string, name: string, number: number, parent = season) => ({
  Id: id,
  Name: name,
  Type: 'Episode',
  SeriesId: show.Id,
  ParentId: parent.Id,
  ParentIndexNumber: parent.IndexNumber,
  IndexNumber: number,
  ProductionYear: 2026,
  RunTimeTicks: 600000000,
  MediaSources: [source(`${id}-direct`, true, id), source(`${id}-hls`, false, id)],
});
const episodeOne = episode('browser-episode-one', 'Coast Episode One', 1);
const episodeTwo = episode('browser-episode-two', 'Coast Episode Two', 2);
const special = episode('browser-special', 'Coast Special', 1, specials);
const library = [movie, show, season, episodeOne, episodeTwo, specials, special];
const playable = new Map([
  ...[movie, episodeOne, episodeTwo, special].map((item) => [item.Id, item.MediaSources] as const),
  ['browser-trailer', [source('fixture-trailer-direct', true, 'browser-trailer')]] as const,
]);
const json = (value: unknown) => Response.json(value);
const server = Bun.serve({
  hostname: address,
  port: 0,
  fetch: async (request) => {
    const url = new URL(request.url),
      path = url.pathname;
    if (path === '/System/Info/Public')
      return json({
        Id: 'coast-browser-fixture',
        ServerName: 'Browser fixture',
        ProductName: 'Jellyfin Server',
        Version: '10.11.0',
      });
    if (path === '/Users/AuthenticateByName')
      return json({
        AccessToken: 'synthetic-fixture-token',
        ServerId: 'coast-browser-fixture',
        User: { Id: 'fixture-user', Name: 'Fixture viewer' },
      });
    if (path === '/Items') {
      const offset = Math.max(0, Number(url.searchParams.get('startIndex')) || 0);
      const limit = Math.max(1, Number(url.searchParams.get('limit')) || 100);
      return json({
        Items: library.slice(offset, offset + limit),
        TotalRecordCount: library.length,
        StartIndex: offset,
      });
    }
    const itemPath = /^\/Users\/fixture-user\/Items\/([^/]+)$/.exec(path);
    if (itemPath) {
      const item = library.find((item) => item.Id === itemPath[1]);
      return item ? json(item) : new Response('Fixture item not found', { status: 404 });
    }
    const playbackPath = /^\/Items\/([^/]+)\/PlaybackInfo$/.exec(path);
    if (playbackPath) {
      const sources = playable.get(playbackPath[1]);
      return sources
        ? json({ MediaSources: sources, PlaySessionId: `browser-play-${playbackPath[1]}` })
        : new Response('Fixture item is not playable', { status: 404 });
    }
    if (path.startsWith('/Sessions/')) return new Response(null, { status: 204 });
    const trailerPath = /^\/Items\/([^/]+)\/LocalTrailers$/.exec(path);
    if (trailerPath)
      return json(
        [movie.Id, show.Id].includes(trailerPath[1])
          ? [{ Id: 'browser-trailer', Name: 'Coast synthetic trailer' }]
          : []
      );
    const videoPath = /^\/Videos\/([^/]+)\//.exec(path);
    if (!videoPath || !playable.has(videoPath[1]))
      return new Response('Fixture resource not found', { status: 404 });
    if (path.endsWith('/Stream.vtt'))
      return new Response('WEBVTT\n\n00:00.000 --> 01:00.000\nCoast synthetic playback fixture\n', {
        headers: { 'content-type': 'text/vtt' },
      });
    if (path.endsWith('/master.m3u8'))
      return new Response(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nmain.m3u8?api_key=fixture-upstream\n',
        { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
      );
    if (path.endsWith('/main.m3u8'))
      return new Response(
        '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:60\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:60,\nsegment.ts?api_key=fixture-upstream\n#EXT-X-ENDLIST\n',
        { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
      );
    if (path.endsWith('/segment.ts'))
      return new Response(Bun.file(join(import.meta.dir, '../tests/fixtures/browser.mpegts')), {
        headers: { 'content-type': 'video/mp2t' },
      });
    if (path.endsWith('/stream')) {
      const bytes = new Uint8Array(
          await Bun.file(join(import.meta.dir, '../tests/fixtures/browser.mp4')).arrayBuffer()
        ),
        range = request.headers.get('range');
      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (!match) return new Response(null, { status: 416 });
        const start = Number(match[1]),
          end = Math.min(match[2] ? Number(match[2]) : bytes.length - 1, bytes.length - 1);
        return new Response(bytes.slice(start, end + 1), {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-range': `bytes ${start}-${end}/${bytes.length}`,
            'accept-ranges': 'bytes',
          },
        });
      }
      return new Response(bytes, {
        headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' },
      });
    }
    return new Response('Fixture route not found', { status: 404 });
  },
});
await getDb()
  .insert(systemSettings)
  .values({
    key: 'coast',
    value: { ...defaultConfig, allowedProviderPorts: [server.port!], serverAllowlist: [address] },
  })
  .onConflictDoUpdate({
    target: systemSettings.key,
    set: {
      value: { ...defaultConfig, allowedProviderPorts: [server.port!], serverAllowlist: [address] },
    },
  });
const instance = await configureInstance(actor.id, {
  provider: 'jellyfin',
  name: 'Synthetic home library',
  baseUrl: `http://${address}:${server.port}`,
  allowPrivateNetwork: true,
});
const connection = await connectJellyfin(actor.id, {
  instanceId: instance.id,
  username: 'fixture',
  password: 'synthetic',
});
await scanJellyfinLibrary(actor.id, connection.id, true);
await syncJellyfinUser(actor.id, connection.id);
const mappings = await getDb()
  .select()
  .from(externalIds)
  .where(eq(externalIds.provider, `jellyfin:${instance.id}`));
const canonical = (externalId: string) => {
  const mapping = mappings.find((item) => item.externalId === externalId);
  if (!mapping) throw new Error(`Fixture item was not imported: ${externalId}`);
  return mapping.mediaId;
};
const mediaId = canonical(movie.Id);
console.info(
  JSON.stringify({
    username,
    password,
    mediaId,
    showId: canonical(show.Id),
    episodeOneId: canonical(episodeOne.Id),
    episodeTwoId: canonical(episodeTwo.Id),
    specialId: canonical(special.Id),
    detailPath: `/media/${mediaId}`,
    providerUrl: `http://${address}:${server.port}`,
    dataDir: process.env.COAST_DATA_DIR,
    database: 'coast_browser_test',
  })
);
console.info(
  'Keep this process alive while the app uses the same DATABASE_URL and COAST_DATA_DIR. Ctrl-C stops only the synthetic HTTP server; all fixture rows remain in the disposable database.'
);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  server.stop(true);
  await closeDb();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
