import type { MusicItem } from './model';
import type { MediaCardDisplay, MediaCardPresentation, MediaHeroPresentation } from '#lib/ui/types.js';

/** Artists are browse destinations; tracks/albums use their music queue. */
export function canPlayMusicCard(item: Pick<MediaCardDisplay, 'kind' | 'available' | 'workId' | 'connectionId'>) {
  return (item.kind === 'track' || item.kind === 'album') && item.available !== false &&
    !!(item.workId || item.connectionId);
}

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
    entryId: item.entryId ?? (connectionId ? `music:${connectionId}:${item.id}` : item.id),
    workId: item.workId,
    artistId: item.artistId,
    favourite: item.favourite,
    kind: item.kind,
    ...(item.positionSeconds ? { trackingProgress: { unit: 'seconds' as const, value: item.positionSeconds, ...(item.durationSeconds ? { total: item.durationSeconds } : {}) } } : {}),
    title: item.title,
    href: item.workId?`/music/work/${item.workId}`:musicHref(connectionId, item.id),
    connectionId,
    backdrop: item.backdropUrl,
    available: item.kind !== 'artist' && (item.available ?? !!connectionId),
    captionCredits: item.kind === 'album' ? item.albumArtists : item.artists,
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
    year:item.kind==='artist'?undefined:item.year,
    durationLabel:item.kind!=='artist'&&item.durationSeconds?musicDuration(item.durationSeconds):undefined,
  };
}
