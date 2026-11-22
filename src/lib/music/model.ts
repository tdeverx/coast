/** Provider item IDs require their service instance; workId is the shared Coast identity. */
export type MusicKind = 'artist' | 'album' | 'track';
export interface MusicArtist {
  id: string;
  name: string;
  /** Shared artist catalogue destination when the credit has a known identity. */
  href?: string;
}
export interface MusicItem {
  id: string;
  entryId?: string;
  workId?: string;
  available?: boolean;
  artistId?: string;
  playCount?: number;
  positionSeconds?: number;
  expectedMembers?: number;
  kind: MusicKind;
  title: string;
  artists: MusicArtist[];
  albumArtists: MusicArtist[];
  artistNames: string[];
  album?: string;
  albumId?: string;
  discNumber?: number;
  trackNumber?: number;
  durationSeconds?: number;
  releaseDate?: string;
  addedAt?: string;
  year?: number;
  genres: string[];
  tasteFeatures?: import('#lib/social/taste-profile.js').TasteFeatures;
  overview?: string;
  favourite?: boolean;
  primaryImageTag?: string;
  artworkUrl?: string;
  backdropUrl?: string;
  externalIds: Record<string, string>;
}
export interface MusicPage {
  items: MusicItem[];
  total: number;
  nextOffset: number | null;
}
