import * as v from 'valibot';
import type { MediaView, MediaCardPresentation } from './ui/types';

export const progressOptionsSchema = v.object({
  view: v.optional(
    v.picklist(['watching', 'up-next', 'next', 'recommendations', 'watchlist', 'favourites', 'paused', 'finished', 'dropped']),
    'watching'
  ),
  category: v.optional(v.picklist(['screen', 'game', 'music', 'reading']), 'screen'),
  kind: v.optional(v.picklist(['all', 'movie', 'show', 'book', 'comic']), 'all'),
  scope: v.optional(v.picklist(['all', 'available']), 'all'),
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000)), 1),
});
export type ProgressOptions = v.InferOutput<typeof progressOptionsSchema>;
export type ProgressContent = ProgressOptions & {
  items: (MediaView | MediaCardPresentation)[];
  total: number;
  emptyAllMedia?: boolean;
  availableViews?: ProgressOptions['view'][];
  pages: number;
};
export const progressTabs = [
  { value: 'watching', label: 'Watching' },
  { value: 'up-next', label: 'Next' },
  { value: 'paused', label: 'Paused' },
  { value: 'watchlist', label: 'Watchlist' },
  { value: 'favourites', label: 'Favourites' },
  { value: 'finished', label: 'Finished' },
  { value: 'dropped', label: 'Dropped' },
] as const;
export type ProgressSurface = 'continue' | 'profile' | 'next' | 'recommendations' | 'watchlist' | 'favourites';
export function progressSelectionTabs(surface: 'continue'|'profile') {
  return progressTabs.filter(option=>['watching','up-next','paused'].includes(option.value) ||
    surface==='profile' && ['finished','dropped'].includes(option.value));
}
export function progressSurface(view: string, profile: boolean): ProgressSurface {
  if (view === 'recommendations') return 'recommendations';
  if (view === 'next') return 'next';
  if (view === 'watchlist' || view === 'favourites') return view;
  return profile || view === 'paused' || view === 'finished' || view === 'dropped' ? 'profile' : 'continue';
}
export const progressTitles: Record<ProgressSurface, string> = {
  continue: 'Continue',
  profile: 'Progress',
  next: 'Next',
  recommendations: 'Recommendations',
  watchlist: 'Watchlist',
  favourites: 'Favourites',
};
export function progressParameters(url: URL) {
  const surface = progressSurface(
    url.searchParams.get('view') ?? 'watching',
    url.searchParams.has('username')
  );
  return {
    view: url.searchParams.get('view') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    kind: url.searchParams.get('kind') ?? undefined,
    scope: surface === 'profile' ? 'all' : (url.searchParams.get('scope') ?? undefined),
    page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
  };
}
