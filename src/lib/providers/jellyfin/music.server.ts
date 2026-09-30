import * as v from 'valibot';
import type { MusicItem, MusicPage } from '$lib/music/model';
import type { ProviderTransport } from '../contracts';

const text = v.nullish(v.string());
const number = v.nullish(v.pipe(v.number(), v.finite(), v.minValue(0)));
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
// Jellyfin uses both compact and hyphenated GUIDs for item identities.
export const jellyfinMusicIdSchema = v.pipe(
  v.string(),
  v.regex(/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i)
);
export const musicBrowseSchema = v.pipe(
  v.object({
    kind: v.optional(v.picklist(['artist', 'album', 'track']), 'album'),
    offset: v.optional(v.pipe(count, v.maxValue(2147483647)), 0),
    limit: v.optional(v.pipe(count, v.minValue(1), v.maxValue(100)), 50),
    search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
    artistId: v.optional(jellyfinMusicIdSchema),
    albumId: v.optional(jellyfinMusicIdSchema),
  }),
  v.check(
    (options) => !options.albumId || options.kind === 'track',
    'Choose tracks when filtering by album.'
  ),
  v.check(
    (options) => !options.artistId || options.kind !== 'artist',
    'Choose albums or tracks when filtering by artist.'
  )
);
export type MusicBrowseOptions = v.InferInput<typeof musicBrowseSchema>;
const artists = v.nullish(v.array(v.object({ Id: v.string(), Name: v.string() })), []);
const itemSchema = v.object({
  Id: v.string(),
  Type: v.picklist(['MusicArtist', 'MusicAlbum', 'Audio']),
  Name: text,
  ArtistItems: artists,
  AlbumArtists: artists,
  Artists: v.nullish(v.array(v.string()), []),
  Album: text,
  AlbumId: text,
  IndexNumber: number,
  ParentIndexNumber: number,
  RunTimeTicks: number,
  PremiereDate: text,
  ProductionYear: number,
  Genres: v.nullish(v.array(v.string()), []),
  Overview: text,
  ImageTags: v.nullish(v.record(v.string(), v.string()), {}),
  ProviderIds: v.nullish(v.record(v.string(), v.string()), {}),
  UserData: v.nullish(v.object({ IsFavorite: v.optional(v.boolean()) })),
});
const kinds = {
  MusicArtist: 'artist',
  MusicAlbum: 'album',
  Audio: 'track',
} as const;
function mapItem(item: v.InferOutput<typeof itemSchema>): MusicItem {
  return {
    id: item.Id,
    kind: kinds[item.Type],
    title:
      item.Name?.trim() || (item.Type === 'Audio' ? `Track ${item.IndexNumber ?? '?'}` : item.Id),
    artists: item.ArtistItems.map((artist) => ({
      id: artist.Id,
      name: artist.Name,
    })),
    albumArtists: item.AlbumArtists.map((artist) => ({
      id: artist.Id,
      name: artist.Name,
    })),
    artistNames: item.Artists,
    album: item.Album || undefined,
    albumId: item.AlbumId || undefined,
    discNumber: item.Type === 'Audio' ? (item.ParentIndexNumber ?? undefined) : undefined,
    trackNumber: item.Type === 'Audio' ? (item.IndexNumber ?? undefined) : undefined,
    durationSeconds: item.RunTimeTicks == null ? undefined : item.RunTimeTicks / 10000000,
    releaseDate: item.PremiereDate?.slice(0, 10),
    year: item.ProductionYear ?? undefined,
    genres: item.Genres,
    overview: item.Overview || undefined,
    favourite: item.UserData?.IsFavorite,
    primaryImageTag: item.ImageTags.Primary || undefined,
    externalIds: Object.fromEntries(
      Object.entries(item.ProviderIds)
        .filter(([, value]) => value.trim())
        .map(([provider, value]) => [provider.toLowerCase(), value.trim()])
    ),
  };
}

/** Receives the adapter's authenticated, policy-controlled transport. Never returns raw sources. */
export async function browseMusic(
  call: ProviderTransport,
  userId: string,
  input: MusicBrowseOptions = {}
): Promise<MusicPage> {
  const options = v.parse(musicBrowseSchema, input);
  const query = new URLSearchParams({
    userId,
    recursive: 'true',
    fields: 'Genres,Overview,ProviderIds',
    enableUserData: 'true',
    enableImages: 'true',
    enableImageTypes: 'Primary',
    enableTotalRecordCount: 'true',
    startIndex: String(options.offset),
    limit: String(options.limit),
    sortOrder: 'Ascending',
    sortBy:
      options.kind === 'track' && options.albumId
        ? 'ParentIndexNumber,IndexNumber,SortName'
        : 'SortName',
    includeItemTypes:
      options.kind === 'artist'
        ? 'MusicAlbum,Audio'
        : options.kind === 'album'
          ? 'MusicAlbum'
          : 'Audio',
  });
  if (options.search) query.set('searchTerm', options.search);
  if (options.artistId)
    query.set(options.kind === 'album' ? 'albumArtistIds' : 'artistIds', options.artistId);
  if (options.albumId) query.set('albumIds', options.albumId);
  const endpoint = options.kind === 'artist' ? '/Artists/AlbumArtists' : '/Items';
  const page = v.parse(
    v.object({
      Items: v.array(itemSchema),
      TotalRecordCount: count,
      StartIndex: v.optional(count),
    }),
    await call(`${endpoint}?${query}`)
  );
  const next = options.offset + page.Items.length;
  if (page.StartIndex !== undefined && page.StartIndex !== options.offset)
    throw new Error('Jellyfin returned an unexpected music page offset.');
  if (!page.Items.length && options.offset < page.TotalRecordCount)
    throw new Error('Jellyfin returned an incomplete music page.');
  const items = page.Items.map(mapItem);
  if (items.some((item) => item.kind !== options.kind))
    throw new Error('Jellyfin returned an unexpected music item type.');
  return {
    items,
    total: page.TotalRecordCount,
    nextOffset: next < page.TotalRecordCount ? next : null,
  };
}

export async function musicItem(
  call: ProviderTransport,
  userId: string,
  id: string
): Promise<MusicItem> {
  v.parse(jellyfinMusicIdSchema, id);
  return mapItem(
    v.parse(
      itemSchema,
      await call(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(id)}`)
    )
  );
}
