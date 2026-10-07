import {companionPageSchema} from './companion';
import { artworkKeys, artworkTypes } from '$lib/artwork';
import {activeSessionsSchema,streamPresentation} from './streams';
import * as v from 'valibot';
import { browseMusic, musicItem, musicItems, type MusicBrowseOptions, type MusicScanOptions } from './music.server';
import { jellyfinItemKey, validateJellyfinItems, validateJellyfinPage } from './paging';
import { ProviderHttpError } from '$lib/server/security/provider-fetch';
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
  CustomRating: str,
  SourceType: str,
  LocationType: str,
  Tags: v.optional(v.array(v.string())),
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
    access: {sourceType:i.SourceType, locationType:i.LocationType, tags:i.Tags, officialRating:i.OfficialRating, customRating:i.CustomRating},
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
  async companionChanges(epoch?:string,cursor=0){
    const query=new URLSearchParams({cursor:String(cursor)});if(epoch)query.set('epoch',epoch);
    return v.parse(companionPageSchema,await this.call(`/Coast/Changes?${query}`));
  }
  async createUser(name:string,password:string){return v.parse(v.object({Id:v.string()}),await this.call('/Users/New',{method:'POST',body:JSON.stringify({Name:name,Password:password})}));}
  async userForProvisioning(id:string){const user=v.parse(v.object({Id:v.string(),Name:v.string(),Policy:v.record(v.string(),v.unknown())}),await this.call(`/Users/${encodeURIComponent(id)}`));if(user.Id!==id)throw new ProviderActionError('Jellyfin returned an unexpected user.','identity');return user;}
  async setProvisionPolicy(id:string,policy:Record<string,unknown>){await this.call(`/Users/${encodeURIComponent(id)}/Policy`,{method:'POST',body:JSON.stringify(policy)});}
  async setProvisionPassword(id:string,password:string){await this.call(`/Users/Password?userId=${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify({NewPw:password,ResetPassword:false})});}
  async virtualFolders(){return v.parse(v.array(v.object({ItemId:v.string(),Name:v.optional(v.string())})),await this.call('/Library/VirtualFolders'));}
  async sessions(userId:string) {
    const sessions=v.parse(v.array(v.object({UserId:v.optional(v.string()),NowPlayingItem:v.optional(v.nullable(v.object({Id:v.string()}))),PlayState:v.optional(v.nullable(v.object({IsPaused:v.optional(v.boolean(),false)})))})),await this.call('/Sessions?ActiveWithinSeconds=120'));
    // Administrator accounts may see everyone; never import another user's live session.
    return sessions.filter(session=>session.UserId===userId);
  }
  async activeStreams(){
    const sessions=v.parse(activeSessionsSchema,await this.call('/Sessions?ActiveWithinSeconds=120'));
    return sessions.flatMap(session=>{const stream=streamPresentation(session);return stream?[stream]:[];});
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
  async library(userId: string, offset = 0, since?: string, scope: 'library' | 'user' = 'library', filter?: 'IsPlayed' | 'IsResumable' | 'IsFavorite', parentId?: string): Promise<LibraryPage> {
    const query = new URLSearchParams({
      userId,
      recursive: 'true',
      includeItemTypes: 'Movie,Series,Season,Episode',
      // Source identities/editions are needed for per-user access. Individual
      // streams are obtained from playback info when playback is requested.
      fields: scope === 'user' ? 'MediaSources,RecursiveItemCount,Tags,CustomRating,ParentId' : 'ProviderIds,Overview,Genres,OriginalTitle,Chapters,RecursiveItemCount,Tags,CustomRating,ParentId',
      enableImages: String(scope === 'library'),
      enableUserData: String(scope === 'user'),
      enableImageTypes: artworkKeys.map((type) => artworkTypes[type].jellyfin).join(','),
      startIndex: String(offset),
      limit: '100',
      sortBy: 'SortName',
      sortOrder: 'Ascending',
      enableTotalRecordCount: 'true',
      ...(scope==='library'&&since ? { minDateLastSaved:v.parse(v.pipe(v.string(),v.isoTimestamp()),since) } : {}),
      ...(filter ? {filters: filter} : {}),
      ...(parentId ? {parentId} : {}),
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
    validateJellyfinPage(page, offset, 100, 'library');
    const next = offset + page.Items.length;
    return {
      items,
      total: page.TotalRecordCount,
      nextOffset: next < page.TotalRecordCount ? next : null,
    };
  }
  /** Token-owned policy: a caller-supplied ID never determines which account is proved. */
  async accessIdentity(userId: string) {
    const user=v.parse(v.object({Id:v.string(),ServerId:v.string(),Policy:v.record(v.string(),v.unknown())}),await this.call('/Users/Me'));
    if(jellyfinItemKey(user.Id)!==jellyfinItemKey(userId))throw new ProviderActionError('Jellyfin returned an unexpected user identity.','identity');
    return user;
  }
  /** Real visible CollectionFolder IDs, before optional custom view grouping. */
  async screenLibraries(userId: string) {
    const folders=v.parse(v.array(v.object({Id:v.string(),Name:v.optional(v.string())})),await this.call(`/UserViews/GroupingOptions?userId=${encodeURIComponent(userId)}`));
    const ids=folders.map(folder=>jellyfinItemKey(folder.Id));
    if(ids.some(id=>!/^[a-f0-9]{32}$/.test(id))||new Set(ids).size!==ids.length)throw new Error('Jellyfin returned invalid library identities.');
    return ids.sort();
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
    const item = v.parse(
        itemSchema,
        await this.call(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(id)}`)
      );
    validateJellyfinItems([item], [id]);
    return mapLibraryItem({...item, Id:id});
  }
  /** Missing individual items do not imply a missing Items endpoint or account. */
  async itemIfAvailable(userId: string, id: string) {
    try { return await this.item(userId, id); }
    catch (error) {
      if (error instanceof ProviderHttpError && [404, 410].includes(error.status)) return null;
      throw error;
    }
  }
  /** Hydrate only missing shared mappings under this account's access policy. */
  async items(userId: string, ids: string[]): Promise<AvailableItem[]> {
    const requested = [...new Map(ids.map(id => [jellyfinItemKey(id), id])).values()];
    const result: AvailableItem[] = [];
    for (let offset = 0; offset < requested.length; offset += 100) {
      const batch = requested.slice(offset, offset + 100);
      const query = new URLSearchParams({userId, ids: batch.join(','), recursive: 'true',
        includeItemTypes: 'Movie,Series,Season,Episode',
        fields: 'ProviderIds,MediaSources,Overview,Genres,OriginalTitle,Chapters,RecursiveItemCount',
        enableImages: 'true', enableUserData: 'true', enableTotalRecordCount: 'true',
        startIndex: '0', limit: String(batch.length)});
      const page = v.parse(v.object({Items: v.array(itemSchema), TotalRecordCount: v.number(), StartIndex: v.optional(v.number())}), await this.call(`/Items?${query}`));
      validateJellyfinPage(page, 0, batch.length, 'library');
      validateJellyfinItems(page.Items, batch);
      if (page.TotalRecordCount !== page.Items.length) throw new Error('Jellyfin returned an incomplete item lookup.');
      const identities = new Map(batch.map(id => [jellyfinItemKey(id), id]));
      result.push(...page.Items.map(item => mapLibraryItem({...item, Id: identities.get(jellyfinItemKey(item.Id))!})));
    }
    return result;
  }
  async musicLibrary(userId: string, options: MusicBrowseOptions = {}, scan?: MusicScanOptions) {
    return browseMusic((path, init) => this.call(path, init), userId, options, scan);
  }
  async musicItems(userId: string, ids: string[]) {
    return musicItems((path, init) => this.call(path, init), userId, ids);
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
