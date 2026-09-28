import type { MediaView } from '../ui/types';

export const isHeroTitle = (item: Pick<MediaView, 'kind'>) =>
  item.kind === 'movie' || item.kind === 'show';

/** Browsing heroes represent titles, even when their rows contain seasons or episodes. */
export function heroTitleIds(items: Pick<MediaView, 'id' | 'kind' | 'showId'>[]): string[] {
  return [
    ...new Set(
      items.flatMap((item) =>
        isHeroTitle(item)
          ? [item.id]
          : (item.kind === 'season' || item.kind === 'episode') && item.showId
            ? [item.showId]
            : []
      )
    ),
  ];
}
