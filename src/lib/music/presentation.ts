import type { MusicItem } from './model';
import type { MediaCardPresentation } from '$lib/ui/types';

export function musicHref(connectionId: string, itemId: string) {
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
    kind: item.kind,
    title: item.title,
    href: musicHref(connectionId, item.id),
    captionSubtitle:
      musicCredits(item) ||
      (item.kind === 'artist' ? 'Artist' : item.kind === 'album' ? 'Album' : 'Track'),
    year: item.year,
    poster: item.primaryImageTag
      ? `/api/v1/providers/${connectionId}/music/${item.id}/artwork`
      : undefined,
  };
}
