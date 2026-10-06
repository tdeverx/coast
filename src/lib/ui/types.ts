import type { ScreenKind, MediaCategory, Lifecycle, Progress } from '$lib/media/model';
import type { ArtworkImages } from '$lib/artwork';
import type { MusicKind } from '$lib/music/model';
export type MediaCardPresentation = Pick<
  MediaView,
  | 'id'
  | 'recommendationIds'
  | 'title'
  | 'captionTitle'
  | 'captionSubtitle'
  | 'captionActor'
  | 'captionActivity'
  | 'year'
  | 'poster'
  | 'backdrop'
  | 'artwork'
  | 'artworkSources'
  | 'logo'
> & { kind: MusicKind | 'game' | 'person'; href: string; connectionId?: string; workId?: string; entryId?: string; listContext?: {listId:string;entryId:string}; available?: boolean; watched?: boolean };
/** A server item can be displayed before it has a shared catalogue destination. */
export type MediaCardDisplay = Omit<MediaCardPresentation,'kind'|'href'> & {kind:MediaKind|MusicKind|'game'|'person';href:null};
export type MediaHeroPresentation = MediaCardPresentation &
  Pick<MediaView, 'overview' | 'genres' | 'runtimeMinutes' | 'certification'>;
export type MediaCardShape = 'poster' | 'square' | 'circle' | 'fanart' | 'banner';
export type MediaCardArtwork =
  | 'auto'
  | 'none'
  | 'primary'
  | 'backdrop'
  | 'thumb'
  | 'banner'
  | 'screenshot';
export type MediaCardOverlay = 'none' | 'logo' | 'art' | 'disc';
export type MediaKind = ScreenKind;
export type ArtworkLevel = 'show' | 'season' | 'episode';
export type ArtworkPriority =
  | 'episode-season-show'
  | 'episode-show-season'
  | 'season-episode-show'
  | 'season-show-episode'
  | 'show-season-episode'
  | 'show-episode-season';
export interface MediaRowStyle {
  artworkPriority?: ArtworkPriority;
  shape: MediaCardShape;
  artworkStyle: MediaCardArtwork;
  overlay: MediaCardOverlay;
}
export interface MediaView {
  recommendationIds?: string[];
  id: string;
  kind: MediaKind;
  title: string;
  entryId?: string;
  listContext?: { listId: string; entryId: string };
  sequence?: import('$lib/media/sequence').SequenceContext;
  captionTitle?: string;
  captionSubtitle?: string;
  captionActivity?: {id:string;occurredAt:string;dateKnown:boolean;kind:string;action?:string;detail?:string;myReaction?:string|null};
  captionActor?: {username:string;avatar?:string|null;status?:import('$lib/social/status').ActivityStatus;profileHref?:string|null};
  originalTitle?: string | null;
  overview?: string | null;
  year?: number | null;
  runtimeMinutes?: number | null;
  poster?: string | null;
  backdrop?: string | null;
  artworkSources?: Partial<Record<ArtworkLevel, ArtworkImages>>;
  logo?: string | null;
  artwork?: ArtworkImages;
  genres?: string[];
  certification?: string | null;
  source?: string;
  category?: MediaCategory;
  status?: Lifecycle | null;
  trackingProgress?: Progress;
  canOpen?: boolean;
  queued?: boolean;
  available: boolean;
  availableSources?: string[];
  progress: number;
  duration: number;
  watched: boolean;
  playCount: number;
  watchlist: boolean;
  favourite: boolean;
  collected: boolean;
  dropped: boolean;
  rewatchStartedAt?: string | null;
  trackingParents?: {
    id: string;
    kind: MediaKind;
    title: string;
    dropped: boolean;
  }[];
  rating: number | null;
  completedEpisodes?: number;
  totalEpisodes?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  showId?: string;
  tmdbId?: string;
  trailer?: string | null;
  requestable?: boolean;
}
export interface PlaybackView {
  mediaType?: 'audio' | 'video';
  sequence?: import('$lib/media/sequence').SequenceContext;
  detail: string;
  id: string;
  mediaId: string;
  title: string;
  artwork?: string | null;
  url: string;
  kind: 'direct' | 'hls';
  startSeconds: number;
  durationSeconds: number;
  provider: string;
  edition?: string;
  defaultSubtitleIndex: number | null;
  subtitlePrompt: boolean;
  subtitles: {
    index: number;
    label: string;
    language?: string;
    url?: string;
  }[];
  sources: { id: string; label: string; edition?: string }[];
}
