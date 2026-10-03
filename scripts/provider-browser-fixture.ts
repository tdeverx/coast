/** Synthetic, disposable browser QA only. Never points to an existing Coast database. */
import { persistMusic } from '../src/lib/music/persistence.server';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq } from 'drizzle-orm';
import { getDb, closeDb } from '../src/lib/server/db';
import { users, systemSettings, externalIds, providerItems, providerInstances } from '../src/lib/server/db/schema';
import { defaultConfig } from '../src/lib/server/config';
import { configureInstance } from '../src/lib/providers/instances.server';
import { connectJellyfin } from '../src/lib/providers/jellyfin/connection.server';
import { scanJellyfinLibrary, syncJellyfinUser } from '../src/lib/sync/jellyfin';

if (!/\/(coast_browser_test(?:_audit_[a-f0-9]{32})?|coast_collection_test)$/.test(process.env.DATABASE_URL??''))
  throw new Error('Use only the disposable coast_browser_test or coast_collection_test database.');
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
const album={Id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',Type:'MusicAlbum',Name:'Coast Audio Album',ChildCount:2,Artists:['Fixture artist'],ProductionYear:2020};
const audioSource=(id:string,hls=false)=>({Id:id,Name:hls?'Audio HLS':'Audio original',Container:hls?'ts':'m4a',Bitrate:32000,RunTimeTicks:120000000,SupportsDirectPlay:!hls,SupportsTranscoding:hls,TranscodingUrl:hls?`/Audio/${id.split('-')[0]}/master.m3u8?api_key=fixture-upstream`:undefined,MediaStreams:[{Index:0,Type:'Audio',Codec:'aac',IsDefault:true}]});
const song=(id:string,name:string,index:number)=>({Id:id,Type:'Audio',Name:name,Artists:['Fixture artist'],AlbumId:album.Id,Album:album.Name,IndexNumber:index,ParentIndexNumber:1,ProductionYear:2020,RunTimeTicks:120000000,UserData:{Played:false,PlayCount:0,PlaybackPositionTicks:0,IsFavorite:false}});
const songOne=song('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','Coast Audio One',1),songTwo=song('dddddddddddddddddddddddddddddddd','Coast Audio Two',3);
const musicItems=[album,songOne,songTwo];
for(const track of [songOne,songTwo])playable.set(track.Id,[audioSource(`${track.Id}-direct`),audioSource(`${track.Id}-hls`,true)]);
const json = (value: unknown) => Response.json(value);
const server = Bun.serve({
  hostname: address,
  port: Number(process.env.COAST_FIXTURE_PORT??0),
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
    if (path === '/Users/AuthenticateByName') {
      const account=process.env.COAST_FIXTURE_MULTIPLE_USERS==='1' ? String((await request.json()).Username||'fixture') : 'fixture';
      return json({
        AccessToken: 'synthetic-fixture-token',
        ServerId: 'coast-browser-fixture',
        User: { Id: account==='fixture'?'fixture-user':`fixture-${account}`, Name: 'Fixture viewer' },
      });
    }
    if (path === '/Items') {
      if(/Music|Audio/.test(url.searchParams.get('includeItemTypes')??'')){
        const types=(url.searchParams.get('includeItemTypes')??'').split(',');
        const items=musicItems.filter(i=>types.includes(i.Type));
        return json({Items:items,TotalRecordCount:items.length,StartIndex:0});
      }
      const offset = Math.max(0, Number(url.searchParams.get('startIndex')) || 0);
      const limit = Math.max(1, Number(url.searchParams.get('limit')) || 100);
      return json({
        Items: library.slice(offset, offset + limit),
        TotalRecordCount: library.length,
        StartIndex: offset,
      });
    }
    const itemPath = /^\/Users\/fixture-[^/]+\/Items\/([^/]+)$/.exec(path);
    if (itemPath) {
      const item = [...library,...musicItems].find((item) => item.Id === itemPath[1]);
      return item ? json(item) : new Response('Fixture item not found', { status: 404 });
    }
    const playbackPath = /^\/Items\/([^/]+)\/PlaybackInfo$/.exec(path);
    if (playbackPath) {
      const sources = playable.get(playbackPath[1]);
      return sources
        ? json({ MediaSources: sources, PlaySessionId: `browser-play-${playbackPath[1]}` })
        : new Response('Fixture item is not playable', { status: 404 });
    }
    const statePath=/^\/UserItems\/([^/]+)\/UserData$/.exec(path);
    const favouritePath=/^\/UserFavoriteItems\/([^/]+)$/.exec(path);
    if(statePath||favouritePath){
      const item=musicItems.find(i=>i.Id===(statePath??favouritePath)![1]) as typeof songOne|undefined;
      if(!item||!('UserData' in item))return new Response('Not found',{status:404});
      if(statePath)Object.assign(item.UserData,await request.json());
      else item.UserData.IsFavorite=request.method==='POST';
      return json(item.UserData);
    }
    if (path === '/Sessions') return Response.json([]);
    if (path.startsWith('/Sessions/')) return new Response(null, { status: 204 });
    const trailerPath = /^\/Items\/([^/]+)\/LocalTrailers$/.exec(path);
    if (trailerPath)
      return json(
        [movie.Id, show.Id].includes(trailerPath[1])
          ? [{ Id: 'browser-trailer', Name: 'Coast synthetic trailer' }]
          : []
      );
    const videoPath = /^\/(?:Videos|Audio)\/([^/]+)\//.exec(path);
    const isAudio=path.startsWith('/Audio/');
    if (!videoPath || !playable.has(videoPath[1]))
      return new Response('Fixture resource not found', { status: 404 });
    if (path.endsWith('/Stream.vtt'))
      return new Response('WEBVTT\n\n00:00.000 --> 01:00.000\nCoast synthetic playback fixture\n', {
        headers: { 'content-type': 'text/vtt' },
      });
    if (path.endsWith('/master.m3u8'))
      return new Response(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=32000\nmain.m3u8?api_key=fixture-upstream\n',
        { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
      );
    if (path.endsWith('/main.m3u8'))
      return new Response(
        `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${isAudio?13:60}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:${isAudio?12.05:60},\nsegment.ts?api_key=fixture-upstream\n#EXT-X-ENDLIST\n`,
        { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
      );
    if (path.endsWith('/segment.ts'))
      return new Response(Bun.file(join(import.meta.dir, isAudio?'../tests/fixtures/browser-audio.mpegts':'../tests/fixtures/browser.mpegts')), {
        headers: { 'content-type': 'video/mp2t' },
      });
    if (path.endsWith('/stream')) {
      const bytes = new Uint8Array(
          await Bun.file(join(import.meta.dir, isAudio?'../tests/fixtures/browser-audio.m4a':'../tests/fixtures/browser.mp4')).arrayBuffer()
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
            'content-type': isAudio?'audio/mp4':'video/mp4',
            'content-range': `bytes ${start}-${end}/${bytes.length}`,
            'accept-ranges': 'bytes',
          },
        });
      }
      return new Response(bytes, {
        headers: { 'content-type': isAudio?'audio/mp4':'video/mp4', 'accept-ranges': 'bytes' },
      });
    }
    return new Response('Fixture route not found', { status: 404 });
  },
});
await getDb()
  .insert(systemSettings)
  .values({
    key: 'coast',
    value: { ...defaultConfig, experimentalFeatures:true, allowedProviderPorts: [server.port!], serverAllowlist: [address] },
  })
  .onConflictDoUpdate({
    target: systemSettings.key,
    set: {
      value: { ...defaultConfig, experimentalFeatures:true, allowedProviderPorts: [server.port!], serverAllowlist: [address] },
    },
  });
// This named disposable installation keeps a single synthetic source across reruns.
await getDb().delete(providerInstances).where(eq(providerInstances.name,'Synthetic home library'));
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
await persistMusic(instance.id,{id:'cccccccccccccccccccccccccccccccc',kind:'track',title:'Coast missing audio',albumId:album.Id,trackNumber:2,discNumber:1,artistNames:['Fixture artist'],artists:[],albumArtists:[],genres:[],externalIds:{}});
const musicMappings=await getDb().select().from(providerItems).where(eq(providerItems.instanceId,instance.id));
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
// Seeding is complete; serving synthetic HTTP media does not need a database pool.
await closeDb();
console.info(
  JSON.stringify({
    username,
    password,
    mediaId,
    connectionId:connection.id,
    albumId:musicMappings.find(i=>i.externalId===album.Id)?.mediaId,
    trackId:musicMappings.find(i=>i.externalId===songOne.Id)?.mediaId,
    showId: canonical(show.Id),
    episodeOneId: canonical(episodeOne.Id),
    episodeTwoId: canonical(episodeTwo.Id),
    specialId: canonical(special.Id),
    detailPath: `/media/${mediaId}`,
    providerUrl: `http://${address}:${server.port}`,
    dataDir: process.env.COAST_DATA_DIR,
    database: new URL(process.env.DATABASE_URL!).pathname.slice(1),
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
