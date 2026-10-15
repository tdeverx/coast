/** Provider item IDs require their service instance; workId is the shared Coast identity. */
export type MusicKind = 'artist' | 'album' | 'track';
export interface MusicArtist {
  id: string;
  name: string;
  /** Only populated when the viewer has an active source for this artist. */
  href?: string;
}
export interface MusicItem {
  id: string;
  entryId?: string;
  workId?: string;
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
  year?: number;
  genres: string[];
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
