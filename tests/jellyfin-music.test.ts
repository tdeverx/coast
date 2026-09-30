import { describe, expect, test } from 'bun:test';
import { JellyfinAdapter } from '../src/lib/providers/jellyfin/adapter.server';

const artistId = 'a'.repeat(32),
  albumId = 'b'.repeat(32),
  trackId = 'c'.repeat(32);

describe('Jellyfin music browsing', () => {
  test('album-artist browsing uses the linked user and authenticated transport', async () => {
    const adapter = new JellyfinAdapter(
      async (path, init) => {
        const url = new URL(path, 'https://jellyfin.test');
        expect(url.pathname).toBe('/Artists/AlbumArtists');
        expect(url.searchParams.get('userId')).toBe('linked-user');
        expect(url.searchParams.get('includeItemTypes')).toBe('MusicAlbum,Audio');
        expect(url.searchParams.get('searchTerm')).toBe('A & B');
        expect(new Headers(init?.headers).get('Authorization')).toContain('Token="private-token"');
        return {
          Items: [{ Id: artistId, Type: 'MusicArtist', Name: 'A & B' }],
          TotalRecordCount: 1,
        };
      },
      'device',
      'private-token'
    );
    const page = await adapter.musicLibrary('linked-user', {
      kind: 'artist',
      search: ' A & B ',
    });
    expect(page.items[0].kind).toBe('artist');
    expect(page.nextOffset).toBeNull();
    expect(JSON.stringify(page)).not.toContain('private-token');
  });

  test('All requests mixed music types without accepting screen items', async () => {
    const adapter = new JellyfinAdapter(async (path) => {
      const query = new URL(path, 'https://jellyfin.test').searchParams;
      expect(query.get('includeItemTypes')).toBe('MusicArtist,MusicAlbum,Audio');
      expect(query.get('searchTerm')).toBe('fixture');
      expect(query.get('startIndex')).toBe('50');
      return {
        Items: [
          { Id: artistId, Type: 'MusicArtist', Name: 'Artist' },
          { Id: albumId, Type: 'MusicAlbum', Name: 'Album' },
          { Id: trackId, Type: 'Audio', Name: 'Track' },
        ],
        TotalRecordCount: 54,
        StartIndex: 50,
      };
    }, 'device');
    const result = await adapter.musicLibrary('user', {
      kind: 'all',
      search: 'fixture',
      offset: 50,
    });
    expect(result.items.map((item) => item.kind)).toEqual(['artist', 'album', 'track']);
    expect(result.nextOffset).toBe(53);
    const screen = new JellyfinAdapter(
      async () => ({ Items: [{ Id: albumId, Type: 'Movie' }], TotalRecordCount: 1 }),
      'device'
    );
    await expect(screen.musicLibrary('user', { kind: 'all' })).rejects.toThrow();
  });

  test('albums preserve music identities and distinct artist credits', async () => {
    const adapter = new JellyfinAdapter(async (path) => {
      const query = new URL(path, 'https://jellyfin.test').searchParams;
      expect(query.get('includeItemTypes')).toBe('MusicAlbum');
      expect(query.get('albumArtistIds')).toBe(artistId);
      return {
        Items: [
          {
            Id: albumId,
            Type: 'MusicAlbum',
            Name: 'Compilation',
            AlbumArtists: [{ Id: artistId, Name: 'Various artists' }],
            ArtistItems: [{ Id: trackId, Name: 'Guest artist' }],
            Artists: ['Guest artist'],
            ProviderIds: {
              MusicBrainzAlbum: ' mb-release ',
              MusicBrainzReleaseGroup: 'mb-group',
            },
            ProductionYear: 2020,
            PremiereDate: '2020-01-02T00:00:00Z',
            UserData: { IsFavorite: false },
          },
        ],
        TotalRecordCount: 1,
      };
    }, 'device');
    const [album] = (await adapter.musicLibrary('user', { artistId })).items;
    expect(album.albumArtists).toEqual([{ id: artistId, name: 'Various artists' }]);
    expect(album.artists).toEqual([{ id: trackId, name: 'Guest artist' }]);
    expect(album.externalIds).toEqual({
      musicbrainzalbum: 'mb-release',
      musicbrainzreleasegroup: 'mb-group',
    });
    expect(album.releaseDate).toBe('2020-01-02');
    expect(album.favourite).toBe(false);
    expect(album.trackNumber).toBeUndefined();
  });

  test('album tracks request disc/track ordering and preserve sub-minute duration', async () => {
    const adapter = new JellyfinAdapter(async (path) => {
      const query = new URL(path, 'https://jellyfin.test').searchParams;
      expect(query.get('includeItemTypes')).toBe('Audio');
      expect(query.get('albumIds')).toBe(albumId);
      expect(query.get('artistIds')).toBe(artistId);
      expect(query.get('sortBy')).toBe('ParentIndexNumber,IndexNumber,SortName');
      expect(query.get('startIndex')).toBe('50');
      expect(query.get('limit')).toBe('1');
      return {
        Items: [
          {
            Id: trackId,
            Type: 'Audio',
            Name: 'Interlude',
            Album: 'Album',
            AlbumId: albumId,
            ParentIndexNumber: 2,
            IndexNumber: 3,
            RunTimeTicks: 125000000,
            Path: '/private/library/track.flac',
            MediaSources: [{ TranscodingUrl: '/audio?api_key=secret' }],
          },
        ],
        StartIndex: 50,
        TotalRecordCount: 52,
      };
    }, 'device');
    const page = await adapter.musicLibrary('user', {
      kind: 'track',
      albumId,
      artistId,
      offset: 50,
      limit: 1,
    });
    expect(page.nextOffset).toBe(51);
    expect(page.items[0]).toMatchObject({
      kind: 'track',
      discNumber: 2,
      trackNumber: 3,
      durationSeconds: 12.5,
      albumId,
    });
    expect(JSON.stringify(page)).not.toContain('secret');
    expect(JSON.stringify(page)).not.toContain('/private/');
  });

  test('optional null music metadata and missing names remain usable', async () => {
    const adapter = new JellyfinAdapter(
      async () => ({
        Items: [
          {
            Id: trackId,
            Type: 'Audio',
            Name: null,
            IndexNumber: 7,
            ArtistItems: null,
            AlbumArtists: null,
            Artists: null,
            Genres: null,
            ProviderIds: null,
            UserData: null,
          },
        ],
        TotalRecordCount: 1,
      }),
      'device'
    );
    const [track] = (await adapter.musicLibrary('user', { kind: 'track' })).items;
    expect(track.title).toBe('Track 7');
    expect(track.artists).toEqual([]);
    expect(track.durationSeconds).toBeUndefined();
    expect(track.favourite).toBeUndefined();
  });

  test('invalid filters are rejected before making a provider request', async () => {
    let calls = 0;
    const adapter = new JellyfinAdapter(async () => {
      calls++;
      return {};
    }, 'device');
    for (const options of [
      { offset: -1 },
      { offset: 1.5 },
      { limit: 0 },
      { limit: 101 },
      { kind: 'album' as const, albumId },
      { kind: 'artist' as const, artistId },
      { artistId: 'a,b' },
      { albumId: '../private', kind: 'track' as const },
      { search: 'x'.repeat(201) },
    ])
      await expect(adapter.musicLibrary('user', options)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  test('incomplete pages, wrong offsets and screen items cannot masquerade as music', async () => {
    for (const response of [
      { Items: [], TotalRecordCount: 3 },
      { Items: [], TotalRecordCount: 0, StartIndex: 50 },
      {
        Items: [{ Id: albumId, Type: 'Movie', Name: 'Film' }],
        TotalRecordCount: 1,
      },
      {
        Items: [{ Id: trackId, Type: 'Audio', Name: 'Track' }],
        TotalRecordCount: 1,
      },
    ]) {
      const adapter = new JellyfinAdapter(async () => response, 'device');
      await expect(adapter.musicLibrary('user')).rejects.toThrow();
    }
    const empty = new JellyfinAdapter(async () => ({ Items: [], TotalRecordCount: 0 }), 'device');
    expect(await empty.musicLibrary('user')).toEqual({
      items: [],
      total: 0,
      nextOffset: null,
    });
  });

  test('single-item lookup stays user-scoped and rejects non-music items', async () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const adapter = new JellyfinAdapter(async (path) => {
      expect(path).toBe(`/Users/user%2Fname/Items/${id}`);
      return { Id: id, Type: 'Audio', Name: 'Track' };
    }, 'device');
    expect((await adapter.musicItem('user/name', id)).kind).toBe('track');
    await expect(adapter.musicItem('user/name', '../private')).rejects.toThrow();
    const screen = new JellyfinAdapter(async () => ({ Id: id, Type: 'Episode' }), 'device');
    await expect(screen.musicItem('user', id)).rejects.toThrow();
  });

  test('existing library scans still request only screen media', async () => {
    const adapter = new JellyfinAdapter(async (path) => {
      expect(new URL(path, 'https://jellyfin.test').searchParams.get('includeItemTypes')).toBe(
        'Movie,Series,Season,Episode'
      );
      return { Items: [], TotalRecordCount: 0 };
    }, 'device');
    expect((await adapter.library('user')).items).toEqual([]);
  });
});
