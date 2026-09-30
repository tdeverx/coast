/** Jellyfin music identities are scoped to a connection, separate from screen tracking. */
export type MusicKind = 'artist' | 'album' | 'track';
export interface MusicArtist {
  id: string;
  name: string;
}
export interface MusicItem {
  id: string;
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
  externalIds: Record<string, string>;
}
export interface MusicPage {
  items: MusicItem[];
  total: number;
  nextOffset: number | null;
}
