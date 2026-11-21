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
import { playbackResourcePath, rewriteHlsManifest } from '../src/lib/playback/service.server';
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
  test('movie and TV details collect keywords and creator signals in the existing request',async()=>{
    for(const kind of ['movie','show'] as const){
      let requests=0;
      const adapter=new TmdbAdapter(async path=>{
        requests++;expect(path).toContain('keywords');expect(path).toContain('credits');
        return {id:10,title:'Film',name:'Show',keywords:kind==='movie'?{keywords:[{id:1,name:'Space travel'}]}:{results:[{id:1,name:'Space travel'}]},credits:{cast:[{id:2,name:'Actor'}],crew:[{id:3,name:'Director',job:'Director'},{id:4,name:'Writer',job:'Screenplay'},{id:6,name:'Score credit',job:'Original Music Composer'},{id:7,name:'Camera credit',job:'Director of Photography'}]},belongs_to_collection:{id:5,name:'Series'}};
      });
      const result=await adapter.details(kind,'10',false);
      expect(requests).toBe(1);
      expect(result.tasteFeatures?.tags).toEqual([{id:'tmdb:1',name:'Space travel'}]);
      expect(result.tasteFeatures?.cast?.[0].name).toBe('Actor');
      expect(result.tasteFeatures?.directors?.[0].name).toBe('Director');
      expect(result.tasteFeatures?.writers?.[0].name).toBe('Writer');
      expect(result.tasteFeatures?.composers).toEqual([{id:'tmdb:6',name:'Score credit'}]);
      expect(result.tasteFeatures?.cinematographers).toEqual([{id:'tmdb:7',name:'Camera credit'}]);
      expect(result.tasteFeatures?.franchises?.[0].name).toBe('Series');
    }
  });
  test('series creator credits stay distinct from actual writing credits',async()=>{
    let calls=0;
    const adapter=new TmdbAdapter(async()=>{
      calls++;
      return {id:10,name:'Series',created_by:[{id:7,name:'Co-creator'},{id:8,name:'Creator'}],
        credits:{cast:[],crew:[{id:7,name:'Co-creator',job:'Screenplay'}]}};
    });
    const result=await adapter.details('show','10',false);
    expect(calls).toBe(1);
    expect(result.tasteFeatures?.writers).toEqual([{id:'tmdb:7',name:'Co-creator'}]);
    expect(result.facts?.credits).toContainEqual({id:'8',name:'Creator',role:'Creator'});
  });
  test('season and episode credits preserve guest cast and typed crew using their existing detail requests',async()=>{
    const regulars=Array.from({length:25},(_,i)=>({id:100+i,name:'Actor '+i}));
    const guest={id:2,name:'Guest',character:'Visitor'};
    const episodeCrew=[{id:3,name:'Episode director',job:'Director'},{id:4,name:'Episode writer',job:'Teleplay'},
      {id:5,name:'Episode composer',job:'Original Music Composer'},{id:6,name:'Episode camera',job:'Director of Photography'}];
    const seasonCrew=[{id:7,name:'Season writer',job:'Writer'}];
    const paths:string[]=[];
    const adapter=new TmdbAdapter(async path=>{
      paths.push(path);
      if(path.includes('/episode/'))return {id:20,crew:episodeCrew,guest_stars:[guest],
        credits:{cast:regulars,guest_stars:[guest],crew:episodeCrew}};
      return {id:10,credits:{cast:regulars,crew:seasonCrew},episodes:[
        {id:20,episode_number:1,guest_stars:[guest],crew:episodeCrew},{id:21,episode_number:2},
      ]};
    });
    const season=await adapter.season('1',1),episode=await adapter.episode('1',1,1);
    expect(paths).toHaveLength(2);
    for(const path of paths)expect(new URL(path,'https://example.invalid').searchParams.get('append_to_response')).toBe('credits');
    expect(season.tasteFeatures?.writers).toEqual([{id:'tmdb:7',name:'Season writer'}]);
    expect(episode.tasteFeatures?.directors).toEqual([{id:'tmdb:3',name:'Episode director'}]);
    expect(episode.tasteFeatures?.writers).toEqual([{id:'tmdb:4',name:'Episode writer'}]);
    expect(episode.tasteFeatures?.composers).toEqual([{id:'tmdb:5',name:'Episode composer'}]);
    expect(episode.tasteFeatures?.cinematographers).toEqual([{id:'tmdb:6',name:'Episode camera'}]);
    expect(episode.tasteFeatures?.cast?.[0]).toEqual({id:'tmdb:2',name:'Guest'});
    expect(episode.tasteFeatures?.cast).toHaveLength(20);
    expect(episode.cast?.map(person=>person.id)).toEqual([...regulars.map(person=>person.id),guest.id]);
    expect(episode.facts?.credits).toHaveLength(episodeCrew.length);
    const [embedded,shell]=season.children!;
    expect(embedded.cast).toEqual([{...guest,portrait:undefined}]);
    expect(embedded.facts?.credits).toEqual(episode.facts?.credits);
    expect(embedded.tasteFeatures).toBeUndefined();
    expect(shell.cast).toBeUndefined();
    expect(shell.facts).toBeUndefined();
  });
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
  test('LAN playback resources accept only the verified public alias and preserve item confinement', () => {
    const lan = 'http://192.168.0.18:8096/internal', publicUrl = 'https://jellyfin.example/jellyfin';
    for (const reference of [
      'https://jellyfin.example/jellyfin/Videos/abc/master.m3u8?api_key=secret',
      'http://192.168.0.18:8096/internal/Videos/abc/master.m3u8?api_key=secret',
      '/jellyfin/Videos/abc/master.m3u8?api_key=secret',
      '/internal/Videos/abc/master.m3u8?api_key=secret',
    ]) expect(playbackResourcePath(lan, 'abc', reference, undefined, 'video', publicUrl)).toBe('/Videos/abc/master.m3u8');
    for (const reference of [
      'https://evil.example/jellyfin/Videos/abc/master.m3u8',
      'https://jellyfin.example/elsewhere/Videos/abc/master.m3u8',
      'https://jellyfin.example/jellyfin/Videos/other/master.m3u8',
      'https://jellyfin.example/jellyfin/Videos/abc/master.m3u8#fragment',
      'https://user:password@jellyfin.example/jellyfin/Videos/abc/master.m3u8',
    ]) expect(() => playbackResourcePath(lan, 'abc', reference, undefined, 'video', publicUrl)).toThrow();
    expect(playbackResourcePath(lan, 'abc', 'segment.ts', '/Videos/abc/hls/main.m3u8', 'video', publicUrl)).toBe('/Videos/abc/hls/segment.ts');
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
  test('Seerr deduplicates claimed seasons across backends in one quality and permits previously completed requests', () => {
    const request = {
      id: 1,
      status: 2,
      is4k: false,
      serverId: 1,
      seasons: [{ seasonNumber: 1, status: 2 }],
    };
    expect(remainingSeasons([1, 2], [request], false)).toEqual([2]);
    expect(remainingSeasons([1, 2], [request], true)).toEqual([1, 2]);
    expect(remainingSeasons([1, 2], [{...request,status:5}], false)).toEqual([1, 2]);
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
    const delivery = await adapter.create({ kind: 'show', tmdbId: 10, is4k: false, serverId: 1, seasons: [1, 2] });
    expect(posted).toMatchObject({ mediaType: 'tv', seasons: [2], serverId: 1 });
    expect(delivery.seasons).toEqual([2]);
  });
  const seasonScope={kind:'show' as const,tmdbId:10,is4k:false,serverId:0,seasons:[6]};
  const request=(owner:number,numbers:number[],serverId:number|null=0)=>({id:40,status:2,serverId,is4k:false,requestedBy:{id:owner},seasons:numbers.map(seasonNumber=>({seasonNumber,status:2}))});
  function seasonService(requests:ReturnType<typeof request>[],post:unknown,seasonStatus=1) {
    const sent:number[][]=[];
    const adapter=new SeerrAdapter(async(path,init)=>{
      if(path.endsWith('/auth/me'))return {id:5,permissions:SeerrPermission.ADMIN};
      if(path.endsWith('/service/sonarr'))return [{id:0,name:'Default',isDefault:true}];
      if(path.includes('/tv/'))return {id:10,seasons:[1,6,7].map(seasonNumber=>({seasonNumber,episodeCount:8})),mediaInfo:{status:4,requests,
        seasons:[{seasonNumber:6,status:seasonStatus,status4k:1}]}};
      if(path.endsWith('/request')&&init?.method==='POST'){sent.push(JSON.parse(String(init.body)).seasons);return post;}
      throw Error('Unexpected fixture path');
    },'fixture',5);
    return {adapter,sent};
  }
  test('partially stocked seasons block only their own quality and a racing no-seasons envelope is a terminal denial',async()=>{
    const mixed=seasonService([],{id:41,status:2},4);
    await expect(mixed.adapter.create(seasonScope)).rejects.toMatchObject({code:'request-covered'});
    expect(mixed.sent).toEqual([]);
    const delivered=await mixed.adapter.create({...seasonScope,seasons:[6,7]});
    expect(mixed.sent).toEqual([[7]]);expect(delivered.seasons).toEqual([7]);
    await mixed.adapter.create({...seasonScope,is4k:true});expect(mixed.sent[1]).toEqual([6]);
    const race=seasonService([],{message:'No seasons available to request'});
    await expect(race.adapter.create(seasonScope)).rejects.toMatchObject({code:'request-covered'});
    expect(race.sent).toEqual([[6]]);
    for(const body of [{message:'An unexpected response'},null,{message:'No seasons available to request',id:null}]){
      await expect(seasonService([],body).adapter.create(seasonScope)).rejects.toMatchObject({name:'ValiError'});
    }
  });
  test('lost acknowledgments adopt only the same owner, quality, backend and season selection',async()=>{
    for(const remote of [request(8,[6]),request(5,[1]),request(5,[1,6])]){
      const fixture=seasonService([remote],null,4);
      await expect(fixture.adapter.create(seasonScope)).rejects.toMatchObject({code:'request-covered'});
      expect(fixture.sent).toEqual([]);
    }
    // The earlier partial POST accepted only season 7. Season 6 is covered independently.
    const retry=seasonService([request(5,[7])],null,4);
    await expect(retry.adapter.create({...seasonScope,seasons:[6,7]})).rejects.toMatchObject({code:'request-covered'});
    expect(retry.sent).toEqual([]);
    const inferred=seasonService([request(5,[6],null)],null);
    expect((await inferred.adapter.create(seasonScope)).request.id).toBe(40);
    await expect(inferred.adapter.create({...seasonScope,serverId:1})).rejects.toMatchObject({code:'request-covered'});
    expect(inferred.sent).toEqual([]);
    const unrelated=seasonService([],request(8,[7]));
    await expect(unrelated.adapter.create(seasonScope)).rejects.toMatchObject({name:'ValiError'});
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
test('Trakt accepts existing list items and zero deletions but rejects partial or malformed item receipts', async () => {
  const counts = {movies:0, shows:0, seasons:0, episodes:0};
  const payload = {movies:[{ids:{trakt:11}}]};
  const list = {updated_at:'2026-11-01T00:00:00Z',item_count:3};
  let receipt: unknown = {added:counts,existing:{...counts,movies:1},not_found:{movies:[],episodes:null},list};
  const adapter = new TraktAdapter(async () => receipt, 'client', 'secret');
  await adapter.writeList('example', payload);
  await adapter.write('watchlist', payload);
  receipt = {deleted:counts,not_found:{},list};
  await adapter.writeList('example', payload, true);
  await adapter.write('history', {ids:[23]}, true);
  receipt = {added:{movies:1},not_found:{seasons:[{ids:{trakt:42},seasons:[{number:1}]}]}};
  for (const category of ['collection','history','ratings','watchlist'] as const)
    await expect(adapter.write(category,payload)).rejects.toMatchObject({code:'identity'});
  await expect(adapter.writeList('example',payload)).rejects.toMatchObject({code:'identity'});
  receipt = {deleted:counts,not_found:{ids:[23]}};
  await expect(adapter.write('history',{ids:[23]},true)).rejects.toMatchObject({code:'identity'});
  for (const bad of [null,{}, {added:counts}, {added:{movies:-1},not_found:{}}, {added:{},not_found:{}}, {added:counts,not_found:{movies:1}}, {deleted:counts,not_found:{}}]) {
    receipt = bad;
    await expect(adapter.write('ratings',payload)).rejects.toThrow();
  }
  receipt = {updated:0,skipped_ids:[],list};
  await adapter.reorderList('example',[4]);
  receipt = {updated:1,skipped_ids:[4],list};
  await expect(adapter.reorderList('example',[3,4])).rejects.toMatchObject({code:'identity'});
});

test('Trakt playback acknowledges the requested action only after a valid scrobble receipt', async () => {
  let receipt: unknown = {id:12,action:'pause',progress:41.21};
  const adapter = new TraktAdapter(async () => receipt, 'client', 'secret');
  expect(await adapter.scrobble('pause','movie',{trakt:1},41.21)).toMatchObject({id:12,action:'pause'});
  await expect(adapter.scrobble('start','movie',{trakt:1},41.21)).rejects.toMatchObject({code:'invalid-request'});
  expect(await adapter.scrobble('stop','movie',{trakt:1},41.21)).toMatchObject({action:'pause'});
  receipt = {id:13,action:'scrobble',progress:100};
  expect(await adapter.scrobble('stop','movie',{trakt:1},100)).toMatchObject({id:13,action:'scrobble'});
  for(const bad of [{}, {id:0,action:'pause',progress:1}, {id:12,action:'pause',progress:101}]){
    receipt=bad;
    await expect(adapter.scrobble('pause','movie',{trakt:1},1)).rejects.toThrow();
  }
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
