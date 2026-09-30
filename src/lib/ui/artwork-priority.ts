import type { ArtworkImages, ArtworkType } from '$lib/artwork';
import type { ArtworkLevel, ArtworkPriority, MediaView, MediaCardShape } from './types';
type ArtworkItem = Pick<MediaView, 'artworkSources' | 'poster' | 'backdrop' | 'artwork'>;

/** Preserve source levels until display time, so changing priority never uses inherited artwork as local artwork. */
export function orderedArtwork(item: ArtworkItem, priority?: ArtworkPriority): ArtworkImages[] {
  if (!priority || !item.artworkSources) return [];
  return (priority.split('-') as ArtworkLevel[]).flatMap((level) => {
    const images = item.artworkSources?.[level];
    return images ? [images] : [];
  });
}

/** Exhaust the requested artwork type across levels before substituting a different type. */
export function cardArtwork(
  item: ArtworkItem,
  type: ArtworkType | 'none',
  shape: MediaCardShape,
  priority?: ArtworkPriority
) {
  if (type === 'none') return { selected: undefined, candidates: [] as string[] };
  const sources = orderedArtwork(item, priority);
  const own =
    type === 'primary'
      ? item.poster || item.artwork?.primary
      : type === 'backdrop'
        ? item.backdrop || item.artwork?.backdrop
        : item.artwork?.[type];
  const exact = sources.map((images) => images[type]);
  const selected = exact.find(Boolean) || (sources.length ? undefined : own);
  const wide = shape === 'fanart' || shape === 'banner';
  const fallback = sources.flatMap((images) =>
    wide ? [images.backdrop, images.primary] : [images.primary, images.backdrop]
  );
  const candidates = [
    ...new Set(
      [
        ...exact,
        ...fallback,
        own,
        ...(wide ? [item.backdrop, item.poster] : [item.poster, item.backdrop]),
      ].filter((url): url is string => !!url)
    ),
  ];
  return { selected, candidates };
}

/** Overlays only fall back to the same image type at another level. */
export function overlayArtwork(
  item: ArtworkItem,
  type: 'none' | 'logo' | 'art' | 'disc',
  priority?: ArtworkPriority
) {
  if (type === 'none') return [];
  return [
    ...new Set(
      [
        ...orderedArtwork(item, priority).map((images) => images[type]),
        item.artwork?.[type],
      ].filter((url): url is string => !!url)
    ),
  ];
}
