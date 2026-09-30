import type { ScreenKind, MediaCategory, Lifecycle, Progress } from '$lib/media/model';
import type { ArtworkImages } from '$lib/artwork';
import type { MusicKind } from '$lib/music/model';
export type MediaCardPresentation = Pick<
  MediaView,
  | 'id'
  | 'title'
  | 'captionTitle'
  | 'captionSubtitle'
  | 'year'
  | 'poster'
  | 'backdrop'
  | 'artwork'
  | 'artworkSources'
  | 'logo'
> & { kind: MusicKind | 'game'; href: string; connectionId?: string };
export type MediaHeroPresentation = MediaCardPresentation &
  Pick<MediaView, 'overview' | 'genres' | 'runtimeMinutes' | 'certification'>;
export type MediaCardShape = 'poster' | 'square' | 'fanart' | 'banner';
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
  id: string;
  kind: MediaKind;
  title: string;
  entryId?: string;
  listContext?: { listId: string; entryId: string };
  sequence?: import('$lib/media/sequence').SequenceContext;
  captionTitle?: string;
  captionSubtitle?: string;
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
