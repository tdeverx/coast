import type { ScreenKind } from '$lib/media/model';
import type { ArtworkImages, ArtworkType } from '$lib/artwork';
/** Provider transports are injected server-side and must enforce Coast network policy. */
export type ProviderTransport = (path: string, init?: RequestInit) => Promise<unknown>;
export type MediaKind = ScreenKind;
export type DiscoverKind = 'movie' | 'show';
export interface CastMember {
  id: number;
  name: string;
  character: string;
  portrait?: string;
}
export interface Metadata {
  provider: string;
  externalId: string;
  kind: MediaKind;
  title: string;
  originalTitle?: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  artwork?: ArtworkImages;
  artworkUpdatedAt?: string;
  releaseDate?: string;
  runtimeMinutes?: number;
  genres?: string[];
  language?: string;
  region?: string;
  certificate?: string;
  externalIds?: Record<string, string>;
  seasonNumber?: number;
  episodeNumber?: number;
  children?: Metadata[];
  collection?: { id: string; name: string };
  trailerKey?: string;
  cast?: CastMember[];
  recommendations?: Metadata[];
}
export interface MetadataProvider {
  search(query: string, page?: number): Promise<Metadata[]>;
  trending(page?: number): Promise<Metadata[]>;
  details(kind: DiscoverKind, id: string): Promise<Metadata>;
}
export interface MediaStream {
  index: number;
  type: 'Video' | 'Audio' | 'Subtitle';
  codec?: string;
  language?: string;
  title?: string;
  isDefault?: boolean;
  isForced?: boolean;
  isExternal?: boolean;
  deliveryUrl?: string;
  deliveryMethod?: string;
  width?: number;
  height?: number;
}
export interface PlaybackSource {
  id: string;
  name: string;
  container?: string;
  bitrate?: number;
  durationSeconds?: number;
  directPlay: boolean;
  directStream: boolean;
  transcoding: boolean;
  transcodingUrl?: string;
  transcodingContainer?: string;
  streams: MediaStream[];
  raw: Record<string, unknown>;
}
export interface AvailableItem {
  id: string;
  kind: 'movie' | 'show' | 'season' | 'episode';
  metadata: Metadata;
  /** Account-scoped expected leaf count; never grants access or proves server inventory. */
  expectedMembers?: number;
  parentId?: string;
  showId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  userData?: {
    favourite?: boolean;
    played: boolean;
    positionSeconds: number;
    playCount: number;
    lastPlayedAt?: string;
  };
  sources: PlaybackSource[];
  artwork?: Partial<Record<ArtworkType, { tag: string; index: number }>>;
}
export interface LibraryPage {
  items: AvailableItem[];
  total: number;
  nextOffset: number | null;
}
export interface BrowserCapabilities {
  containers: string[];
  videoCodecs: string[];
  audioCodecs: string[];
  nativeHls: boolean;
  hlsJs: boolean;
  maxBitrate?: number;
  maxWidth?: number;
}
export interface PlaybackPolicy {
  delivery: 'allow-direct' | 'relay-only';
  maxBitrate: number;
  allowTranscoding: boolean;
}
export interface RequestScope {
  kind: DiscoverKind;
  tmdbId: number;
  seasons?: number[];
  is4k: boolean;
  serverId?: number;
}
export interface RequestDestination {
  id: string;
  name: string;
  standardServerId?: number;
  fourKServerId?: number;
  can4k: boolean;
}
export type SyncCategory =
  | 'history'
  | 'progress'
  | 'collection'
  | 'ratings'
  | 'watchlist'
  | 'lists'
  | 'scrobble';
export interface SyncPreferences {
  history: boolean;
  progress: boolean;
  collection: boolean;
  ratings: boolean;
  watchlist: boolean;
  lists: boolean;
  scrobble: boolean;
}
export const defaultSyncPreferences: SyncPreferences = {
  history: false,
  progress: false,
  collection: false,
  ratings: false,
  watchlist: false,
  lists: false,
  scrobble: false,
};
/** An adapter rejected a stable permission, identity or request-scope condition. */
export class ProviderActionError extends Error {
  constructor(
    message: string,
    public code: 'permission' | 'identity' | 'invalid-request'
  ) {
    super(message);
    this.name = 'ProviderActionError';
  }
}
