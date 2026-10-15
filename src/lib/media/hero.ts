import type { MediaView, MediaHeroPresentation } from '../ui/types';

type HeroTitle = Pick<MediaView,'id'|'showId'> & {kind:MediaView['kind']|MediaHeroPresentation['kind']};
export const isHeroTitle = (item: Pick<HeroTitle, 'kind'>) =>
  item.kind === 'movie' || item.kind === 'show' || item.kind === 'book' || item.kind === 'comic';

/** Browsing heroes represent titles, even when their rows contain seasons or episodes. */
export function heroTitleIds(items: HeroTitle[]): string[] {
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
