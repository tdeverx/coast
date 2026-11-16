import type { RecommendationOptions } from '#lib/ui/shelves/for-you.svelte.js';
import { browseVariant, dynamicKind, type DynamicMedium, type GenreReason } from './model';

export function recommendationSection(section: string | null) {
  if (section==='dynamic') return 'row';
  if (section==='browse' || section==='recommendations' || section==='upcoming') return section;
}

/** Standalone grids and the detail sheet read the same row definition. */
export function recommendationSectionSource(url: { searchParams: Pick<URLSearchParams,'get'> }, category: DynamicMedium,
  mode: 'personal' | 'generic'): RecommendationOptions | undefined {
  const params = url.searchParams;
  const feature = recommendationSection(params.get('section'));
  const kind = dynamicKind(params.get('kind'));
  const variant = browseVariant(params.get('variant'));
  if (!feature || feature==='browse' && (!kind || !variant) || mode==='generic' && (feature==='upcoming' || !kind)) return;
  const reason = params.get('reason');
  return {type:'recommendation',mode,feature,category,kind,variant,layout:'grid',
    genre:params.get('genre') || undefined, workId:params.get('work') || undefined, seed:params.get('seed') || undefined,
    reason:reason && ['liked','watched','saved','explore'].includes(reason) ? reason as GenreReason : undefined};
}
