import type { MusicItem } from './model';
import type { MediaCardPresentation, MediaHeroPresentation } from '$lib/ui/types';

export function musicHref(connectionId: string, itemId: string) {
  if(!connectionId)return `/music/work/${encodeURIComponent(itemId)}`;
  return `/music/${encodeURIComponent(connectionId)}/${encodeURIComponent(itemId)}`;
}
export function musicCredits(item: MusicItem) {
  const credits = item.kind === 'album' ? item.albumArtists : item.artists;
  return credits.length
    ? credits.map((artist) => artist.name).join(', ')
    : item.artistNames.join(', ');
}
export function musicDuration(seconds?: number) {
  if (seconds === undefined) return '';
  const duration = Math.floor(seconds);
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
}
export function musicCard(item: MusicItem, connectionId: string): MediaCardPresentation {
  return {
    id: item.id,
    workId: item.workId,
    kind: item.kind,
    title: item.title,
    href: item.workId?`/music/work/${item.workId}`:musicHref(connectionId, item.id),
    connectionId,
    available: item.kind !== 'artist',
    captionSubtitle:
      musicCredits(item) ||
      (item.kind === 'artist' ? 'Artist' : item.kind === 'album' ? 'Album' : 'Track'),
    year: item.year,
    poster: item.artworkUrl??(item.primaryImageTag
      ? `/api/v1/providers/${connectionId}/music/${item.id}/artwork`
      : undefined),
  };
}

export function musicHero(item: MusicItem, connectionId: string): MediaHeroPresentation {
  return {
    ...musicCard(item, connectionId),
    id: `music:${connectionId}:${item.id}`,
    overview: item.overview,
    genres: item.genres,
    runtimeMinutes: item.durationSeconds ? Math.round(item.durationSeconds / 60) : undefined,
  };
}
