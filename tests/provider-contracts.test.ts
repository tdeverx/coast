import { tmdbArtworkUrl } from '../src/lib/providers/tmdb/artwork.server';
import { describe, test, expect } from 'bun:test';
import { TmdbAdapter } from '../src/lib/providers/tmdb/adapter.server';
import { JellyfinAdapter } from '../src/lib/providers/jellyfin/adapter.server';
import {
  SeerrAdapter,
  SeerrPermission,
  canRequest,
  groupDestination,
  remainingSeasons,
} from '../src/lib/providers/seerr/adapter.server';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { planPlayback } from '../src/lib/playback/planning';
import { playbackResourcePath, rewriteHlsManifest } from '../src/lib/playback/server';
import type { PlaybackSource, BrowserCapabilities } from '../src/lib/providers/contracts';

const browser: BrowserCapabilities = {
  containers: ['mp4'],
  videoCodecs: ['h264'],
  audioCodecs: ['aac'],
  nativeHls: false,
  hlsJs: true,
};
const source = (id: string, bitrate: number, codec = 'h264'): PlaybackSource => ({
  id,
  name: id,
  container: 'mp4',
  bitrate,
  directPlay: true,
  directStream: true,
  transcoding: true,
  transcodingUrl: `/Videos/abc/master.m3u8?MediaSourceId=${id}`,
  streams: [
    { index: 0, type: 'Video', codec },
    { index: 1, type: 'Audio', codec: 'aac' },
  ],
  raw: {},
});
describe('TMDB boundary and relevant metadata', () => {
  test('search excludes people, preserves translated and original titles', async () => {
    const adapter = new TmdbAdapter(async (path) => {
      expect(path).toContain('include_adult=false');
      return {
        results: [
          {
            id: 10,
            media_type: 'movie',
            title: 'Spirited Away',
            original_title: '千と千尋の神隠し',
            release_date: '2001-07-20',
          },
          { id: 20, media_type: 'person', name: 'Someone' },
        ],
      };
    });
    const result = await adapter.search('Spirited');
    expect(result).toHaveLength(1);
    expect(result[0].originalTitle).toBe('千と千尋の神隠し');
  });
  test('details select certificate by region and retain stable episode IDs', async () => {
    const adapter = new TmdbAdapter(
      async (path) =>
        path.includes('/season/')
          ? {
              id: 99,
              name: 'Season 1',
              episodes: [{ id: 501, name: 'Pilot', episode_number: 1, season_number: 1 }],
            }
          : {
              id: 10,
              name: 'Show',
              original_name: 'Original',
              seasons: [{ season_number: 1 }],
              content_ratings: {
                results: [
                  { iso_3166_1: 'US', rating: 'TV-MA' },
                  { iso_3166_1: 'GB', rating: '15' },
                ],
              },
            },
      'en-US',
      'GB'
    );
    expect((await adapter.details('show', '10')).certificate).toBe('15');
    expect((await adapter.season('10', 1)).children?.[0].externalId).toBe('501');
  });
  test('invalid provider JSON fails instead of creating corrupt identities', async () => {
    await expect(
      new TmdbAdapter(async () => ({ results: [{ id: 'not-number' }] })).search('x')
    ).rejects.toThrow();
  });
});
describe('Jellyfin identity and library contracts', () => {
  test('accepts an episode without a Jellyfin Name and supplies a useful fallback title', async () => {
    const adapter = new JellyfinAdapter(
      async () => ({
        TotalRecordCount: 1,
        Items: [
          {
            Id: 'unnamed-episode',
            Type: 'Episode',
            SeriesId: 'show',
            ParentId: 'season',
            IndexNumber: 7,
            ParentIndexNumber: 1,
          },
        ],
      }),
      'device'
    );

    const [episode] = (await adapter.library('user')).items;
    expect(episode.kind).toBe('episode');
    expect(episode.metadata.title).toBe('Episode 7');
    expect(episode.metadata.seasonNumber).toBe(1);
    expect(episode.metadata.episodeNumber).toBe(7);
  });

  test('accepts the public product identity returned by Jellyfin servers', async () => {
    const adapter = new JellyfinAdapter(
      async () => ({
        Id: 'server-id',
        ServerName: 'Home',
        Version: '12.1.0',
        ProductName: 'Jellyfin Server',
      }),
      'device'
    );
    expect(await adapter.identity()).toEqual({ id: 'server-id', name: 'Home', version: '12.1.0' });
  });
  test('rejects other or missing product identities before sending account credentials', async () => {
    for (const product of ['Emby Server', 'Jellyfin', undefined]) {
      const paths: string[] = [];
      const adapter = new JellyfinAdapter(async (path) => {
        paths.push(path);
        return { Id: 'server-id', ServerName: 'Home', Version: '12.1.0', ProductName: product };
      }, 'device');
      await expect(adapter.authenticate('user', 'password')).rejects.toThrow(
        'not a Jellyfin server'
      );
      expect(paths).toEqual(['/System/Info/Public']);
    }
  });
  test('mismatched identity prevents authentication', async () => {
    const paths: string[] = [];
    const adapter = new JellyfinAdapter(async (path) => {
      paths.push(path);
      return {
        Id: 'unexpected',
        ServerName: 'Jellyfin',
        Version: '10.11',
        ProductName: 'Jellyfin Server',
      };
    }, 'device');
    await expect(adapter.authenticate('user', 'password', 'expected')).rejects.toThrow(
      'identity changed'
    );
    expect(paths).toEqual(['/System/Info/Public']);
  });
  test('imports optional Jellyfin artwork and preserves chapter image indices', async () => {
    const adapter = new JellyfinAdapter(
      async (path) => {
        expect(path).toContain('Chapters');
        expect(path).toContain('enableImageTypes=');
        return {
          TotalRecordCount: 1,
          Items: [
            {
              Id: 'movie',
              Name: 'Movie',
              Type: 'Movie',
              ImageTags: {
                Primary: 'p',
                Thumb: 't',
                Banner: 'b',
                Logo: 'l',
                Art: 'a',
                Disc: 'd',
                Box: 'x',
                BoxRear: 'r',
                Menu: 'm',
                Profile: 'f',
              },
              BackdropImageTags: ['backdrop'],
              ScreenshotImageTags: ['screen'],
              Chapters: [{}, { ImageTag: 'chapter-two' }],
            },
          ],
        };
      },
      'device',
      'token'
    );
    const [item] = (await adapter.library('user')).items;
    expect(item.artwork).toEqual({
      primary: { tag: 'p', index: 0 },
      thumb: { tag: 't', index: 0 },
      banner: { tag: 'b', index: 0 },
      logo: { tag: 'l', index: 0 },
      art: { tag: 'a', index: 0 },
      disc: { tag: 'd', index: 0 },
      box: { tag: 'x', index: 0 },
      boxRear: { tag: 'r', index: 0 },
      menu: { tag: 'm', index: 0 },
      profile: { tag: 'f', index: 0 },
      backdrop: { tag: 'backdrop', index: 0 },
      screenshot: { tag: 'screen', index: 0 },
      chapter: { tag: 'chapter-two', index: 1 },
    });
  });
  test('paged scanning cannot reconcile an unexpectedly empty middle page', async () => {
    const adapter = new JellyfinAdapter(
      async () => ({ Items: [], TotalRecordCount: 150 }),
      'device',
      'token'
    );
    await expect(adapter.library('u', 100)).rejects.toThrow('incomplete library');
  });
  test('availability maps provider IDs and media streams', async () => {
    const adapter = new JellyfinAdapter(
      async () => ({
        Items: [
          {
            Id: 'episode',
            Name: 'Pilot',
            Type: 'Episode',
            SeriesId: 'show',
            ParentId: 'season',
            IndexNumber: 1,
            ParentIndexNumber: 1,
            ProviderIds: { Tmdb: '501' },
            MediaSources: [
              {
                Id: 'source',
                Name: 'Theatrical',
                Container: 'mp4',
                RunTimeTicks: 600000000,
                SupportsDirectPlay: true,
                MediaStreams: [
                  { Index: 0, Type: 'Video', Codec: 'h264', Width: 1920, Height: 1080 },
                ],
              },
            ],
          },
        ],
        TotalRecordCount: 1,
      }),
      'device'
    );
    const page = await adapter.library('u');
    expect(page.nextOffset).toBeNull();
    expect(page.items[0].metadata.externalIds?.tmdb).toBe('501');
    expect(page.items[0].sources[0].durationSeconds).toBe(60);
  });
  test('shared collection membership never becomes a canonical movie identifier', async () => {
    const adapter = new JellyfinAdapter(
      async () => ({
        Items: [
          {
            Id: 'first',
            Name: 'First movie',
            Type: 'Movie',
            ProviderIds: {
              Tmdb: '101',
              Imdb: 'tt101',
              TmdbCollection: '900',
              UnknownMembership: 'shared',
            },
          },
          {
            Id: 'second',
            Name: 'Second movie',
            Type: 'Movie',
            ProviderIds: { Tmdb: '102', Tvdb: '202', TmdbCollection: '900', Imdb: ' ' },
          },
        ],
        TotalRecordCount: 2,
      }),
      'device'
    );
    const page = await adapter.library('user');
    expect(page.items[0].metadata.externalIds).toEqual({ tmdb: '101', imdb: 'tt101' });
    expect(page.items[1].metadata.externalIds).toEqual({ tmdb: '102', tvdb: '202' });
  });
});
describe('policy-aware playback', () => {
  test('examines all sources and prefers compatible direct over first transcode', () => {
    const plan = planPlayback(
      [source('4k', 80000000, 'hevc'), source('1080p', 15000000)],
      browser,
      { delivery: 'allow-direct', maxBitrate: 25000000, allowTranscoding: true }
    );
    expect(plan.source.id).toBe('1080p');
    expect(plan.mode).toBe('direct');
  });
  test('relay-only does not force an unnecessary transcode', () => {
    expect(
      planPlayback([source('1080p', 10000000)], browser, {
        delivery: 'relay-only',
        maxBitrate: 20000000,
        allowTranscoding: false,
      }).mode
    ).toBe('relay');
  });
  test('rejects incompatible sources when transcoding forbidden', () => {
    expect(() =>
      planPlayback([source('4k', 80000000, 'hevc')], browser, {
        delivery: 'allow-direct',
        maxBitrate: 20000000,
        allowTranscoding: false,
      })
    ).toThrow();
  });
  test('resource paths cannot escape server origin, prefix, or item identity', () => {
    expect(
      playbackResourcePath(
        'https://jellyfin.example/jellyfin',
        'abc',
        'segment.ts?api_key=secret',
        '/Videos/abc/hls/main.m3u8'
      )
    ).toBe('/Videos/abc/hls/segment.ts');
    for (const uri of [
      'https://evil.example/segment.ts',
      '/jellyfin/System/Info',
      '/jellyfin/Videos/other/stream',
      '/jellyfin/Videos/abc/%2e%2e/other/stream',
    ])
      expect(() => playbackResourcePath('https://jellyfin.example/jellyfin', 'abc', uri)).toThrow();
  });
  test('accepts Jellyfin GUID formatting while keeping resources bound to the same item', () => {
    const compact = '0123456789abcdef0123456789abcdef';
    const hyphenated = '01234567-89ab-cdef-0123-456789abcdef';
    expect(
      playbackResourcePath(
        'https://jellyfin.example',
        compact,
        `/videos/${hyphenated}/master.m3u8?api_key=secret`
      )
    ).toBe(`/videos/${hyphenated}/master.m3u8`);
    expect(
      playbackResourcePath(
        'https://jellyfin.example',
        hyphenated,
        `/Videos/${compact.toUpperCase()}/stream`
      )
    ).toBe(`/Videos/${compact.toUpperCase()}/stream`);
    for (const wrong of [
      '01234567-89ab-cdef-0123-456789abcdee',
      '0123456789ab-cdef0123456789abcdef',
      `${hyphenated}-extra`,
    ])
      expect(() =>
        playbackResourcePath('https://jellyfin.example', compact, `/videos/${wrong}/master.m3u8`)
      ).toThrow();
    expect(() =>
      playbackResourcePath('https://jellyfin.example', 'abc123', '/videos/abc-123/stream')
    ).toThrow();
  });
  test('rewrites variant, key, and segment URIs without exposing credentials', async () => {
    const seen: string[] = [];
    const result = await rewriteHlsManifest(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key?api_key=secret"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmain.m3u8?api_key=secret\n',
      async (reference) => {
        seen.push(reference);
        return `/opaque/${seen.length}`;
      }
    );
    expect(seen).toHaveLength(2);
    expect(result).not.toContain('secret');
    expect(result).toContain('URI="/opaque/1"');
  });
});
describe('Seerr permissions and season scope', () => {
  test('mapped Jellyfin accounts may have a null Seerr username without losing verified identity', async () => {
    const adapter = new SeerrAdapter(
      async () => ({
        id: 7,
        username: null,
        displayName: 'Viewer',
        permissions: SeerrPermission.REQUEST,
      }),
      'fixture-key'
    );
    const account = await adapter.jellyfinUser('fixture-jellyfin-user');
    expect(account.id).toBe(7);
    expect(account.username).toBeNull();
    expect(canRequest(account.permissions, 'movie')).toBe(true);
  });

  test('4K variants stay in the same destination and enforce independent permission', () => {
    const servers = [
      { id: 1, name: 'Main', is4k: false, isDefault: true },
      { id: 2, name: '4K', is4k: true, isDefault: true },
    ];
    const [destination] = groupDestination(
      'coast-server',
      'Home',
      servers,
      SeerrPermission.REQUEST | SeerrPermission.REQUEST_4K_TV,
      'show'
    );
    expect(destination.can4k).toBe(true);
    expect(destination.standardServerId).toBe(1);
    expect(destination.fourKServerId).toBe(2);
    expect(canRequest(SeerrPermission.REQUEST, 'movie', true)).toBe(false);
  });
  test('duplicates exclude matching seasons but preserve other server/variant scopes', () => {
    const request = {
      id: 1,
      status: 2,
      is4k: false,
      serverId: 1,
      seasons: [{ seasonNumber: 1, status: 2 }],
    };
    expect(remainingSeasons([1, 2], [request], false, 1)).toEqual([2]);
    expect(remainingSeasons([1, 2], [request], true, 1)).toEqual([1, 2]);
    expect(remainingSeasons([1, 2], [request], false, 2)).toEqual([1, 2]);
  });
  test('a user cannot cancel someone else’s request', async () => {
    let mutation = false;
    const adapter = new SeerrAdapter(
      async (path, init) => {
        if (init?.method) mutation = true;
        return path.endsWith('/auth/me')
          ? { id: 5, permissions: 32 }
          : { id: 10, status: 1, requestedBy: { id: 6 } };
      },
      'key',
      5
    );
    await expect(adapter.manage(10, 'cancel')).rejects.toThrow('permission');
    expect(mutation).toBe(false);
  });
  test('creates only unrequested valid seasons using the mapped identity', async () => {
    let posted: unknown;
    const adapter = new SeerrAdapter(
      async (path, init) => {
        expect(new Headers(init?.headers).get('X-Api-User')).toBe('5');
        if (path.endsWith('/auth/me')) return { id: 5, permissions: 32 };
        if (path.includes('/tv/'))
          return {
            id: 10,
            seasons: [
              { seasonNumber: 1, episodeCount: 8 },
              { seasonNumber: 2, episodeCount: 8 },
            ],
            mediaInfo: {
              status: 2,
              requests: [
                {
                  id: 1,
                  status: 1,
                  is4k: false,
                  serverId: 1,
                  seasons: [{ seasonNumber: 1, status: 1 }],
                },
              ],
            },
          };
        posted = JSON.parse(String(init?.body));
        return { id: 2, status: 1 };
      },
      'key',
      5
    );
    await adapter.create({ kind: 'show', tmdbId: 10, is4k: false, serverId: 1, seasons: [1, 2] });
    expect(posted).toMatchObject({ mediaType: 'tv', seasons: [2], serverId: 1 });
  });
});
test('Trakt uses server-held OAuth application credentials and validates tokens', async () => {
  let sent: Record<string, unknown> = {};
  const adapter = new TraktAdapter(
    async (path, init) => {
      sent = JSON.parse(String(init?.body));
      expect(path).toBe('/oauth/device/token');
      return {
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 7200,
        created_at: 1,
        token_type: 'bearer',
        scope: 'public',
      };
    },
    'client',
    'secret'
  );
  expect((await adapter.finishDevice('device')).access_token).toBe('token');
  expect(sent).toMatchObject({ code: 'device', client_id: 'client', client_secret: 'secret' });
});
describe('Trakt list and nullable metadata contracts', () => {
  test('reads all personal list and mixed-item pages without losing order', async () => {
    const paths: string[] = [];
    const lists = Array.from({ length: 101 }, (_, index) => ({
      name: `List ${index}`,
      description: null,
      ids: { trakt: index + 1, slug: `list-${index}` },
    }));
    const records = Array.from({ length: 200 }, (_, index) => ({
      id: index + 1,
      type: 'movie',
      movie: { title: `Movie ${index}`, runtime: null, ids: { trakt: index + 1 } },
    }));
    const adapter = new TraktAdapter(
      async (path) => {
        paths.push(path);
        const url = new URL(path, 'https://api.trakt.tv');
        const page = Number(url.searchParams.get('page'));
        expect(url.searchParams.get('limit')).toBe('100');
        const values = url.pathname === '/users/me/lists' ? lists : records;
        if (values === records) {
          expect(url.pathname).toBe('/users/me/lists/42/items/movie,show,season,episode');
          expect(url.searchParams.get('extended')).toBe('full');
        }
        return values.slice((page - 1) * 100, page * 100);
      },
      'client',
      'secret'
    );
    expect((await adapter.lists()).map((list) => list.ids.trakt)).toEqual(
      lists.map((list) => list.ids.trakt)
    );
    expect((await adapter.listItems('42')).map((record) => record.id)).toEqual(
      records.map((record) => record.id)
    );
    expect(paths).toHaveLength(5);
    expect(paths.at(-1)).toContain('page=3&limit=100');
  });
  test('retains season identity and accepts absent metadata allowed by Trakt', async () => {
    const show = { title: 'Show', runtime: null, ids: { trakt: 10 } };
    const adapter = new TraktAdapter(
      async () => [
        {
          type: 'season',
          season: { number: 2, title: null, ids: { trakt: 20, tmdb: null, tvdb: null } },
          show,
        },
        {
          type: 'episode',
          episode: { season: 2, number: 1, title: null, runtime: null, ids: { trakt: 30 } },
          show,
        },
        { type: 'movie', movie: null },
        { type: 'show', show: null },
        { type: 'season', season: null, show: null },
        { type: 'episode', episode: null, show: null },
      ],
      'client',
      'secret'
    );
    const records = await adapter.read('ratings');
    expect(records[0].season).toEqual({
      number: 2,
      title: null,
      ids: { trakt: 20, tmdb: null, tvdb: null },
    });
    expect(records[0].show?.ids.trakt).toBe(10);
    expect(records[1].episode?.title).toBeNull();
    expect(records[1].episode?.runtime).toBeNull();
    expect(records[2].movie).toBeNull();
    expect(records[3].show).toBeNull();
    expect(records[4].season).toBeNull();
    expect(records[5].episode).toBeNull();
  });
  test('still rejects malformed runtime and missing required movie titles', async () => {
    for (const movie of [
      { title: 'Movie', runtime: '90', ids: { trakt: 1 } },
      { title: null, runtime: 90, ids: { trakt: 1 } },
    ]) {
      const adapter = new TraktAdapter(async () => [{ type: 'movie', movie }], 'client', 'secret');
      await expect(adapter.listItems('42')).rejects.toThrow();
    }
  });
});
test('TMDB collection details preserve member identities in release order', async () => {
  const adapter = new TmdbAdapter(async (path) => {
    expect(path).toContain('/3/collection/42');
    return {
      id: 42,
      name: 'A collection',
      parts: [
        { id: 2, title: 'Sequel', release_date: '2026-01-01' },
        { id: 1, title: 'First', release_date: '2024-01-01' },
      ],
    };
  });
  const collection = await adapter.collection('42');
  expect(collection.kind).toBe('collection');
  expect(collection.children?.map((item) => item.externalId)).toEqual(['1', '2']);
});

test('TMDB caching routes only approved image URLs and leaves Jellyfin uncached', () => {
  const tmdb = 'https://image.tmdb.org/t/p/w780/poster.jpg';
  expect(tmdbArtworkUrl(tmdb, false)).toBe(tmdb);
  expect(tmdbArtworkUrl(tmdb, true)).toBe('/api/v1/artwork/tmdb/w780/poster.jpg');
  for (const value of [
    '/api/v1/artwork/instance/item/logo?tag=test',
    'https://other.example/poster.jpg',
    'https://image.tmdb.org.evil.test/t/p/w780/poster.jpg',
    'https://image.tmdb.org/t/p/w780/../secret.jpg',
    'https://image.tmdb.org/t/p/w780/file.svg',
  ])
    expect(tmdbArtworkUrl(value, true)).toBe(value);
});

test('TMDB supplies language-preferred logos and episode still artwork', async () => {
  const adapter = new TmdbAdapter(async (path) => {
    if (path.includes('/season/'))
      return { id: 20, episodes: [{ id: 21, episode_number: 1, still_path: '/still.jpg' }] };
    expect(path).toContain('images');
    expect(path).toContain('include_image_language=fr%2Cen%2Cnull');
    return {
      id: 10,
      images: {
        logos: [
          { file_path: '/english.png', iso_639_1: 'en' },
          { file_path: '/french.png', iso_639_1: 'fr' },
        ],
      },
    };
  }, 'fr-FR');
  const details = await adapter.details('show', '10');
  expect(details.artwork?.logo).toBe('https://image.tmdb.org/t/p/original/french.png');
  expect(details.artworkUpdatedAt).toBeDefined();
  const episode = (await adapter.season('10', 1)).children?.[0];
  expect(episode?.artwork?.thumb).toBe('https://image.tmdb.org/t/p/w780/still.jpg');
  expect(episode?.backdropPath).toBe('https://image.tmdb.org/t/p/original/still.jpg');
});

test('TMDB detail rows preserve cast order, roles, missing portraits and related identities', async () => {
  const adapter = new TmdbAdapter(async (path) => {
    expect(path).toContain('aggregate_credits');
    expect(path).toContain('recommendations');
    return {
      id: 10,
      name: 'Series',
      aggregate_credits: {
        cast: [
          {
            id: 1,
            name: 'First Actor',
            roles: [{ character: 'Lead' }],
            profile_path: '/portrait.jpg',
          },
          { id: 2, name: 'Second Actor', roles: [{ character: 'Guest' }], profile_path: null },
        ],
      },
      recommendations: {
        results: [
          { id: 10, name: 'Series' },
          { id: 11, name: 'Related Series' },
        ],
      },
    };
  });
  const details = await adapter.details('show', '10');
  expect(details.cast).toEqual([
    {
      id: 1,
      name: 'First Actor',
      character: 'Lead',
      portrait: 'https://image.tmdb.org/t/p/original/portrait.jpg',
    },
    { id: 2, name: 'Second Actor', character: 'Guest', portrait: undefined },
  ]);
  expect(details.recommendations?.map((item) => [item.externalId, item.kind])).toEqual([
    ['11', 'show'],
  ]);
});

test('Jellyfin playback state stays separate from shared metadata', async () => {
  const adapter = new JellyfinAdapter(async (path) => {
    expect(path).toContain('enableUserData=true');
    return {
      Items: [
        {
          Id: 'movie',
          Name: 'Movie',
          Type: 'Movie',
          UserData: {
            Played: true,
            PlayCount: 4,
            PlaybackPositionTicks: 1200000000,
            LastPlayedDate: '2020-01-01T00:00:00Z',
          },
        },
      ],
      TotalRecordCount: 1,
    };
  }, 'test-device');
  const [item] = (await adapter.library('viewer', 0, undefined, 'user')).items;
  expect(item.userData).toEqual({
    played: true,
    playCount: 4,
    positionSeconds: 120,
    lastPlayedAt: '2020-01-01T00:00:00Z',
  });
  expect(item.metadata).not.toHaveProperty('userData');
});

test('Jellyfin progress resolution writes only resume ticks, without creating a playback session', async () => {
  const calls: { path: string; method?: string; body: unknown }[] = [];
  const adapter = new JellyfinAdapter(async (path, init) => {
    calls.push({ path, method: init?.method, body: JSON.parse(String(init?.body)) });
    return {};
  }, 'fixture-device');
  await adapter.setProgress('user-1', 'item-1', 123.5);
  expect(calls).toEqual([
    {
      path: '/UserItems/item-1/UserData?userId=user-1',
      method: 'POST',
      body: { PlaybackPositionTicks: 1235000000 },
    },
  ]);
});
test('Trakt cleared progress deletes only the matching media kind and identity', async () => {
  const deleted: string[] = [];
  const adapter = new TraktAdapter(
    async (path, init) => {
      if (init?.method === 'DELETE') {
        deleted.push(path);
        return null;
      }
      return [
        { id: 10, movie: { title: 'Movie', ids: { trakt: 1 } } },
        { id: 11, episode: { season: 1, number: 1, ids: { trakt: 1 } } },
        { id: 12, movie: { title: 'Other', ids: { trakt: 2 } } },
      ];
    },
    'fixture',
    'fixture',
    'fixture'
  );
  await adapter.clearProgress('movie', { trakt: 1 });
  expect(deleted).toEqual(['/sync/playback/10']);
});


test('Jellyfin shared scans omit account state and activity scans omit expensive metadata fields', async () => {
  const calls: URLSearchParams[] = [];
  const adapter = new JellyfinAdapter(async path => {
    calls.push(new URL(path, 'https://fixture.invalid').searchParams);
    return { Items: [], TotalRecordCount: 0 };
  }, 'fixture');
  await adapter.library('source', 0, '2026-01-01T00:00:00Z');
  await adapter.library('viewer', 0, undefined, 'user');
  expect(calls[0].get('enableUserData')).toBe('false');
  expect(calls[0].get('minDateLastSaved')).toBe('2026-01-01T00:00:00Z');
  expect(calls[1].get('userId')).toBe('viewer');
  expect(calls[1].get('enableUserData')).toBe('true');
  expect(calls[1].get('enableImages')).toBe('false');
  expect(calls[1].get('fields')).not.toContain('Overview');
  expect(calls[1].get('minDateLastSaved')).toBeNull();
});
