import * as v from 'valibot';
import type { MusicItem, MusicPage } from '$lib/music/model';
import type { ProviderTransport } from '../contracts';
import { jellyfinItemKey, validateJellyfinItems, validateJellyfinPage } from './paging';

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
    kind: v.optional(v.picklist(['all', 'artist', 'album', 'track']), 'album'),
    availableOnly: v.optional(v.boolean(), false),
    offset: v.optional(v.pipe(count, v.maxValue(2147483647)), 0),
    limit: v.optional(v.pipe(count, v.minValue(1), v.maxValue(100)), 50),
    search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
    artistId: v.optional(jellyfinMusicIdSchema),
    albumId: v.optional(jellyfinMusicIdSchema),
    filter: v.optional(v.picklist(['IsPlayed', 'IsResumable', 'IsFavorite'])),
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
/** Internal scan intent; interactive browse projection remains unchanged. */
export type MusicScanOptions = { scope: 'library' | 'user'; since?: string };
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
  ChildCount: number,
  PremiereDate: text,
  ProductionYear: number,
  Genres: v.nullish(v.array(v.string()), []),
  Overview: text,
  ImageTags: v.nullish(v.record(v.string(), v.string()), {}),
  ProviderIds: v.nullish(v.record(v.string(), v.string()), {}),
  UserData: v.nullish(v.object({ IsFavorite: v.optional(v.boolean()), Played: v.optional(v.boolean()), PlayCount: v.optional(count), PlaybackPositionTicks: number })),
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
    expectedMembers: item.Type === 'MusicAlbum' ? item.ChildCount ?? undefined : undefined,
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
    playCount: item.UserData?.PlayCount ?? (item.UserData?.Played ? 1 : 0),
    positionSeconds: item.UserData?.PlaybackPositionTicks ? item.UserData.PlaybackPositionTicks / 10000000 : undefined,
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
  input: MusicBrowseOptions = {},
  scan?: MusicScanOptions
): Promise<MusicPage> {
  const options = v.parse(musicBrowseSchema, input);
  if (options.availableOnly && options.kind === 'artist')
    return { items: [], total: 0, nextOffset: null };
  const query = new URLSearchParams({
    userId,
    recursive: 'true',
    fields: scan?.scope === 'user' ? 'ChildCount' : 'Genres,Overview,ProviderIds,ChildCount',
    enableUserData: String(scan?.scope !== 'library'),
    enableImages: String(scan?.scope !== 'user'),
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
      options.kind === 'all'
        ? options.availableOnly ? 'MusicAlbum,Audio' : 'MusicArtist,MusicAlbum,Audio'
        : options.kind === 'artist'
          ? 'MusicAlbum,Audio'
          : options.kind === 'album'
            ? 'MusicAlbum'
            : 'Audio',
  });
  if (options.search) query.set('searchTerm', options.search);
  if (options.artistId)
    query.set(options.kind === 'album' ? 'albumArtistIds' : 'artistIds', options.artistId);
  if (options.albumId) query.set('albumIds', options.albumId);
  if (options.filter) query.set('filters', options.filter);
  // Metadata-save dates are never a user-state/access change cursor.
  if (scan?.scope === 'library' && scan.since) query.set('minDateLastSaved', v.parse(v.pipe(v.string(), v.isoTimestamp()), scan.since));
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
  validateJellyfinPage(page, options.offset, options.limit, 'music');
  const items = page.Items.map(mapItem);
  if (options.kind !== 'all' && items.some((item) => item.kind !== options.kind))
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
  const item = v.parse(
      itemSchema,
      await call(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(id)}`)
    );
  validateJellyfinItems([item], [id]);
  return mapItem({...item, Id:id});
}

/** Authenticated rich hydration for only the identities missing from shared metadata. */
export async function musicItems(call: ProviderTransport, userId: string, ids: string[]): Promise<MusicItem[]> {
  const requested = [...new Map(ids.map(id => [jellyfinItemKey(v.parse(jellyfinMusicIdSchema, id)), id])).values()];
  const result: MusicItem[] = [];
  for (let offset = 0; offset < requested.length; offset += 100) {
    const batch = requested.slice(offset, offset + 100);
    const query = new URLSearchParams({userId, ids: batch.join(','), recursive: 'true',
      includeItemTypes: 'MusicAlbum,Audio', fields: 'Genres,Overview,ProviderIds,ChildCount',
      enableUserData: 'true', enableImages: 'true', enableImageTypes: 'Primary',
      enableTotalRecordCount: 'true', startIndex: '0', limit: String(batch.length)});
    const page = v.parse(v.object({Items: v.array(itemSchema), TotalRecordCount: count, StartIndex: v.optional(count)}), await call(`/Items?${query}`));
    validateJellyfinPage(page, 0, batch.length, 'music');
    validateJellyfinItems(page.Items, batch);
    if (page.TotalRecordCount !== page.Items.length) throw new Error('Jellyfin returned an incomplete item lookup.');
    const identities = new Map(batch.map(id => [jellyfinItemKey(id), id]));
    const items = page.Items.map(item => mapItem({...item, Id:identities.get(jellyfinItemKey(item.Id))!}));
    if (items.some(item => item.kind === 'artist')) throw new Error('Jellyfin returned an unexpected music item type.');
    result.push(...items);
  }
  return result;
}
