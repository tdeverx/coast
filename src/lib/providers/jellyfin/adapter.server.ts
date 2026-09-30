import { artworkKeys, artworkTypes } from '$lib/artwork';
import * as v from 'valibot';
import { browseMusic, musicItem, type MusicBrowseOptions } from './music.server';
import { ProviderActionError } from '../contracts';
import type {
  AvailableItem,
  BrowserCapabilities,
  LibraryPage,
  PlaybackSource,
  ProviderTransport,
} from '../contracts';
const str = v.nullish(v.string()),
  num = v.nullish(v.number()),
  bool = v.optional(v.boolean(), false);
const streamSchema = v.object({
  Index: v.number(),
  Type: v.picklist(['Video', 'Audio', 'Subtitle', 'EmbeddedImage', 'Data', 'Lyric']),
  Codec: str,
  Language: str,
  DisplayTitle: str,
  IsDefault: bool,
  IsForced: bool,
  IsExternal: bool,
  DeliveryUrl: str,
  DeliveryMethod: str,
  Width: num,
  Height: num,
});
const sourceSchema = v.object({
  Id: v.string(),
  Name: str,
  Container: str,
  Bitrate: num,
  RunTimeTicks: num,
  SupportsDirectPlay: bool,
  SupportsDirectStream: bool,
  SupportsTranscoding: bool,
  TranscodingUrl: str,
  TranscodingContainer: str,
  MediaStreams: v.optional(v.array(streamSchema), []),
});
const itemSchema = v.object({
  Id: v.string(),
  Name: str,
  Type: v.picklist(['Movie', 'Series', 'Season', 'Episode']),
  UserData: v.nullish(
    v.object({
      Played: bool,
      IsFavorite: v.optional(v.boolean()),
      PlaybackPositionTicks: num,
      PlayCount: num,
      LastPlayedDate: str,
    })
  ),
  OriginalTitle: str,
  Overview: str,
  ProductionYear: num,
  PremiereDate: str,
  RunTimeTicks: num,
  RecursiveItemCount: num,
  IndexNumber: num,
  ParentIndexNumber: num,
  ParentId: str,
  SeriesId: str,
  ProviderIds: v.optional(v.record(v.string(), v.string()), {}),
  Genres: v.optional(v.array(v.string()), []),
  OfficialRating: str,
  MediaSources: v.optional(v.array(sourceSchema), []),
  ImageTags: v.optional(v.record(v.string(), v.string()), {}),
  BackdropImageTags: v.optional(v.array(v.string()), []),
  ScreenshotImageTags: v.nullish(v.array(v.string()), []),
  Chapters: v.nullish(v.array(v.object({ ImageTag: str })), []),
});
const identitySchema = v.object({
  Id: v.string(),
  ServerName: v.string(),
  Version: v.string(),
  ProductName: v.optional(v.string()),
});
// ProviderIds can also contain shared membership IDs such as TmdbCollection.
// Only identifiers of this title may participate in canonical identity matching.
const canonicalIdProviders = new Set(['tmdb', 'imdb', 'tvdb']);
export function jellyfinAuthorization(deviceId: string, token?: string) {
  return `MediaBrowser Client="Coast", Device="Coast Web", DeviceId="${deviceId.replace(/[^\w-]/g, '')}", Version="0.1.0"${token ? `, Token="${token.replace(/["\\\r\n]/g, '')}"` : ''}`;
}
function source(data: v.InferOutput<typeof sourceSchema>): PlaybackSource {
  return {
    id: data.Id,
    name: data.Name || data.Container || 'Original',
    container: data.Container || undefined,
    bitrate: data.Bitrate ?? undefined,
    durationSeconds: data.RunTimeTicks ? data.RunTimeTicks / 10000000 : undefined,
    directPlay: data.SupportsDirectPlay,
    directStream: data.SupportsDirectStream,
    transcoding: data.SupportsTranscoding,
    transcodingUrl: data.TranscodingUrl || undefined,
    transcodingContainer: data.TranscodingContainer || undefined,
    streams: data.MediaStreams.filter(
      (s) => s.Type === 'Video' || s.Type === 'Audio' || s.Type === 'Subtitle'
    ).map((s) => ({
      index: s.Index,
      type: s.Type as 'Video' | 'Audio' | 'Subtitle',
      codec: s.Codec || undefined,
      language: s.Language || undefined,
      title: s.DisplayTitle || undefined,
      isDefault: s.IsDefault,
      isForced: s.IsForced,
      isExternal: s.IsExternal,
      deliveryUrl: s.DeliveryUrl || undefined,
      deliveryMethod: s.DeliveryMethod || undefined,
      width: s.Width ?? undefined,
      height: s.Height ?? undefined,
    })),
    raw: data,
  };
}
function mapLibraryItem(i: v.InferOutput<typeof itemSchema>): AvailableItem {
  const kind = ({ Movie: 'movie', Series: 'show', Season: 'season', Episode: 'episode' } as const)[
    i.Type
  ];
  const title =
    i.Name?.trim() ||
    i.OriginalTitle?.trim() ||
    (kind === 'episode' ? `Episode ${i.IndexNumber ?? '?'}` : i.Id);
  return {
    id: i.Id,
    kind,
    expectedMembers: (kind === 'show' || kind === 'season') ? i.RecursiveItemCount ?? undefined : undefined,
    parentId: i.ParentId || undefined,
    showId: i.SeriesId || undefined,
    seasonNumber: (kind === 'season' ? i.IndexNumber : i.ParentIndexNumber) ?? undefined,
    episodeNumber: kind === 'episode' ? (i.IndexNumber ?? undefined) : undefined,
    userData: i.UserData
      ? {
          played: i.UserData.Played,
          favourite: i.UserData.IsFavorite,
          positionSeconds: Math.max(0, (i.UserData.PlaybackPositionTicks ?? 0) / 10000000),
          playCount: Math.max(0, Math.floor(i.UserData.PlayCount ?? 0)),
          lastPlayedAt: i.UserData.LastPlayedDate || undefined,
        }
      : undefined,
    metadata: {
      provider: 'jellyfin',
      externalId: i.Id,
      kind,
      title,
      originalTitle: i.OriginalTitle || undefined,
      overview: i.Overview || undefined,
      releaseDate: i.PremiereDate?.slice(0, 10),
      runtimeMinutes: i.RunTimeTicks ? Math.round(i.RunTimeTicks / 600000000) : undefined,
      genres: i.Genres,
      certificate: i.OfficialRating || undefined,
      externalIds: Object.fromEntries(
        Object.entries(i.ProviderIds)
          .filter(
            ([provider, value]) =>
              canonicalIdProviders.has(provider.toLowerCase()) && value.trim() !== ''
          )
          .map(([provider, value]) => [provider.toLowerCase(), value.trim()])
      ),
      seasonNumber: (kind === 'season' ? i.IndexNumber : i.ParentIndexNumber) ?? undefined,
      episodeNumber: kind === 'episode' ? (i.IndexNumber ?? undefined) : undefined,
    },
    sources: i.MediaSources.map(source),
    artwork: Object.fromEntries(
      artworkKeys.flatMap((type) => {
        const index = type === 'chapter' ? i.Chapters.findIndex((chapter) => chapter.ImageTag) : 0;
        const tag =
          type === 'backdrop'
            ? i.BackdropImageTags[0]
            : type === 'screenshot'
              ? i.ScreenshotImageTags[0] || i.ImageTags.Screenshot
              : type === 'chapter'
                ? i.Chapters[index]?.ImageTag || i.ImageTags.Chapter
                : i.ImageTags[artworkTypes[type].jellyfin];
        return tag ? [[type, { tag, index: Math.max(0, index) }]] : [];
      })
    ),
  };
}
export class JellyfinAdapter {
  constructor(
    private request: ProviderTransport,
    private deviceId: string,
    private token?: string
  ) {}
  private call(path: string, init: RequestInit = {}) {
    return this.request(path, {
      ...init,
      headers: {
        Authorization: jellyfinAuthorization(this.deviceId, this.token),
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  }
  async identity(expectedId?: string) {
    const info = v.parse(identitySchema, await this.call('/System/Info/Public'));
    if (info.ProductName !== 'Jellyfin Server')
      throw new ProviderActionError('The endpoint is not a Jellyfin server.', 'identity');
    if (expectedId && info.Id !== expectedId)
      throw new ProviderActionError(
        'Jellyfin server identity changed. Administrator review is required.',
        'identity'
      );
    return { id: info.Id, name: info.ServerName, version: info.Version };
  }
  async authenticate(username: string, password: string, expectedId?: string) {
    const identity = await this.identity(expectedId);
    const auth = v.parse(
      v.object({
        AccessToken: v.string(),
        ServerId: v.string(),
        User: v.object({ Id: v.string(), Name: v.string() }),
      }),
      await this.call('/Users/AuthenticateByName', {
        method: 'POST',
        body: JSON.stringify({ Username: username, Pw: password }),
      })
    );
    if (auth.ServerId !== identity.id)
      throw new ProviderActionError(
        'Jellyfin authentication returned an unexpected server identity.',
        'identity'
      );
    return {
      id: auth.User.Id,
      username: auth.User.Name,
      accessToken: auth.AccessToken,
      serverId: auth.ServerId,
    };
  }
  async library(userId: string, offset = 0, since?: string, scope: 'library' | 'user' = 'library'): Promise<LibraryPage> {
    const query = new URLSearchParams({
      userId,
      recursive: 'true',
      includeItemTypes: 'Movie,Series,Season,Episode',
      fields: scope === 'user' ? 'MediaSources,MediaStreams,RecursiveItemCount' : 'ProviderIds,MediaSources,MediaStreams,Overview,Genres,OriginalTitle,Chapters,RecursiveItemCount',
      enableImages: String(scope === 'library'),
      enableUserData: String(scope === 'user'),
      enableImageTypes: artworkKeys.map((type) => artworkTypes[type].jellyfin).join(','),
      startIndex: String(offset),
      limit: '100',
      sortBy: 'SortName',
      sortOrder: 'Ascending',
      enableTotalRecordCount: 'true',
      ...(since ? { minDateLastSaved: since } : {}),
    });
    const page = v.parse(
      v.object({
        Items: v.array(itemSchema),
        TotalRecordCount: v.number(),
        StartIndex: v.optional(v.number()),
      }),
      await this.call(`/Items?${query}`)
    );
    const items: AvailableItem[] = page.Items.map(mapLibraryItem);
    const next = offset + page.Items.length;
    if (!page.Items.length && next < page.TotalRecordCount)
      throw new Error('Jellyfin returned an incomplete library page.');
    return {
      items,
      total: page.TotalRecordCount,
      nextOffset: next < page.TotalRecordCount ? next : null,
    };
  }
  async userPolicy(userId: string) {
    const user = v.parse(
      v.object({
        Id: v.string(),
        Name: v.string(),
        Policy: v.object({ IsAdministrator: v.boolean(), IsDisabled: v.boolean() }),
      }),
      await this.call(`/Users/${encodeURIComponent(userId)}`)
    );
    if (user.Id !== userId)
      throw new ProviderActionError('Jellyfin returned an unexpected user identity.', 'identity');
    return { administrator: user.Policy.IsAdministrator, disabled: user.Policy.IsDisabled };
  }
  async item(userId: string, id: string) {
    return mapLibraryItem(
      v.parse(
        itemSchema,
        await this.call(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(id)}`)
      )
    );
  }
  async musicLibrary(userId: string, options: MusicBrowseOptions = {}) {
    return browseMusic((path, init) => this.call(path, init), userId, options);
  }
  async musicItem(userId: string, id: string) {
    return musicItem((path, init) => this.call(path, init), userId, id);
  }
  async setMusicFavourite(userId: string, id: string, value: boolean) {
    const item = await this.musicItem(userId, id);
    if (item.favourite === value) return;
    await this.call(
      `/UserFavoriteItems/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`,
      {
        method: value ? 'POST' : 'DELETE',
      }
    );
  }
  async localTrailers(userId: string, itemId: string) {
    return v
      .parse(
        v.array(v.object({ Id: v.string(), Name: v.string() })),
        await this.call(
          `/Items/${encodeURIComponent(itemId)}/LocalTrailers?userId=${encodeURIComponent(userId)}`
        )
      )
      .map((item) => ({ id: item.Id, name: item.Name }));
  }
  async playbackInfo(
    itemId: string,
    userId: string,
    capabilities: BrowserCapabilities,
    maxBitrate: number
  ) {
    const profile = {
      Name: 'Coast browser',
      MaxStreamingBitrate: maxBitrate,
      MaxStaticBitrate: maxBitrate,
      DirectPlayProfiles: [
        {
          Container: capabilities.containers.join(','),
          AudioCodec: capabilities.audioCodecs.join(','),
          Type: 'Audio',
        },
        {
          Container: capabilities.containers.join(','),
          VideoCodec: capabilities.videoCodecs.join(','),
          AudioCodec: capabilities.audioCodecs.join(','),
          Type: 'Video',
        },
      ],
      TranscodingProfiles: [
        {
          Container: 'ts',
          Type: 'Audio',
          AudioCodec: 'aac',
          Protocol: 'hls',
          Context: 'Streaming',
          MaxAudioChannels: '2',
          MinSegments: 1,
        },
        {
          Container: 'ts',
          Type: 'Video',
          VideoCodec: 'h264',
          AudioCodec: 'aac',
          Protocol: 'hls',
          Context: 'Streaming',
          MaxAudioChannels: '2',
          MinSegments: 1,
          BreakOnNonKeyFrames: true,
        },
      ],
      SubtitleProfiles: [
        { Format: 'vtt', Method: 'External' },
        { Format: 'srt', Method: 'External' },
        { Format: 'ass', Method: 'Encode' },
        { Format: 'pgssub', Method: 'Encode' },
      ],
    };
    const info = v.parse(
      v.object({
        MediaSources: v.optional(v.array(sourceSchema), []),
        PlaySessionId: str,
        ErrorCode: str,
      }),
      await this.call(`/Items/${encodeURIComponent(itemId)}/PlaybackInfo`, {
        method: 'POST',
        body: JSON.stringify({
          UserId: userId,
          MaxStreamingBitrate: maxBitrate,
          DeviceProfile: profile,
          EnableDirectPlay: true,
          EnableDirectStream: true,
          EnableTranscoding: true,
          AllowVideoStreamCopy: true,
          AllowAudioStreamCopy: true,
        }),
      })
    );
    if (info.ErrorCode) throw new Error(`Jellyfin playback is unavailable (${info.ErrorCode}).`);
    return {
      sources: info.MediaSources.map(source),
      playSessionId: info.PlaySessionId || undefined,
    };
  }
  async setUserState(
    userId: string,
    itemId: string,
    field: 'watched' | 'favourite',
    value: boolean
  ) {
    const current = (await this.item(userId, itemId)).userData;
    if (current && (field === 'watched' ? current.played : current.favourite) === value) return;
    await this.call(
      `/${field === 'watched' ? 'UserPlayedItems' : 'UserFavoriteItems'}/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(userId)}`,
      {
        method: value ? 'POST' : 'DELETE',
      }
    );
  }
  async setViewingSummary(
    userId: string,
    itemId: string,
    state: {
      watched: boolean;
      playCount: number;
      positionSeconds: number;
      lastWatchedAt: string | null;
    }
  ) {
    await this.call(
      `/UserItems/${encodeURIComponent(itemId)}/UserData?userId=${encodeURIComponent(userId)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          Played: state.watched,
          PlayCount: state.playCount,
          PlaybackPositionTicks: Math.round((state.watched ? 0 : state.positionSeconds) * 10000000),
          LastPlayedDate: state.lastWatchedAt,
        }),
      }
    );
  }
  async setProgress(userId: string, itemId: string, positionSeconds: number) {
    await this.call(
      `/UserItems/${encodeURIComponent(itemId)}/UserData?userId=${encodeURIComponent(userId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ PlaybackPositionTicks: Math.round(positionSeconds * 10000000) }),
      }
    );
  }
  async setListeningSummary(userId:string,itemId:string,playCount:number){
    await this.call(`/UserItems/${encodeURIComponent(itemId)}/UserData?userId=${encodeURIComponent(userId)}`,{
      method:'POST',body:JSON.stringify({Played:playCount>0,PlayCount:playCount}),
    });
  }
  async scrobble(
    event: 'start' | 'progress' | 'stop',
    input: {
      itemId: string;
      sourceId: string;
      playSessionId?: string;
      positionSeconds: number;
      paused?: boolean;
      method?: 'DirectPlay' | 'DirectStream' | 'Transcode';
    }
  ) {
    await this.call(
      `/Sessions/Playing${event === 'start' ? '' : event === 'stop' ? '/Stopped' : '/Progress'}`,
      {
        method: 'POST',
        body: JSON.stringify({
          ItemId: input.itemId,
          MediaSourceId: input.sourceId,
          PlaySessionId: input.playSessionId,
          PositionTicks: Math.round(input.positionSeconds * 10000000),
          IsPaused: input.paused ?? false,
          CanSeek: true,
          PlayMethod: input.method || 'DirectPlay',
          EventName: event === 'progress' ? 'timeupdate' : undefined,
        }),
      }
    );
  }
}
