import type { MediaCardPresentation, MediaHeroPresentation } from '$lib/ui/types';
import type { ReadingKind, ReadingProvider, ReadingState } from './model';
export type ReadingDisplay = {
  id: string; kind: ReadingKind; provider: ReadingProvider; externalId: string;
  title: string; authors: string[]; subjects: string[]; sourceUrl: string;
  overview?: string | null; coverUrl?: string | null; publishedYear?: number | null;
  editionIds?: string[]; releaseDate?: string | null;
  pageCount?: number | null; seriesTitle?: string | null; issueNumber?: string | null;
};
export type ReadingCardMetadata = Pick<ReadingDisplay, 'id' | 'kind' | 'title' | 'authors'> & Partial<Pick<ReadingDisplay, 'provider' | 'coverUrl' | 'publishedYear' | 'seriesTitle' | 'issueNumber' | 'sourceUrl'>>;
export type ReadingProgressView = {
  state: ReadingState; page: number; totalPages: number | null;
  startedAt: Date | string | null; completedAt: Date | string | null;
};
export type ReadingDetailData = {
  kind: ReadingKind; item: ReadingDisplay; remote: boolean;
  progress: ReadingProgressView | null;
  relationships: { favourite: boolean; watchlist: boolean; collected: boolean };
  rating: number | null;
};
export const readingLabel = (kind: ReadingKind) => kind === 'book' ? 'Books' : 'Comics';
export const readingProviderLabel = (provider: ReadingProvider) => provider === 'openlibrary' ? 'Open Library' : 'Comic Vine';
export function readingCard(item: ReadingCardMetadata, href = `/media/${item.id}`, progress?: ReadingProgressView | null): MediaCardPresentation {
  const issue = item.seriesTitle && item.issueNumber ? `${item.seriesTitle} #${item.issueNumber}` : undefined;
  const subtitle = issue && issue !== item.title.trim() ? issue : item.authors.join(' · ');
  return {
    id: item.id, kind: item.kind, title: item.title, href,
    workId: /^[0-9a-f-]{36}$/.test(item.id) ? item.id : undefined,
    poster: item.coverUrl, year: item.publishedYear, available: false,
    ...(progress ? { watched: progress.state === 'completed', trackingProgress: { unit: 'pages' as const, value: progress.page, ...(progress.totalPages ? { total: progress.totalPages } : {}) } } : {}),
    captionSubtitle: subtitle || (issue ? undefined : item.kind === 'book' ? 'Book' : 'Comic'),
    attribution: item.provider === 'comic-vine' || (!item.provider && item.sourceUrl?.startsWith('https://comicvine.gamespot.com/')) ? { label: 'Comic Vine', href: item.sourceUrl ?? 'https://comicvine.gamespot.com' } : undefined,
  };
}
export function readingHero(item: ReadingDisplay, remote = false): MediaHeroPresentation {
  const href = remote ? `/media/${item.provider}/${item.externalId}` : undefined;
  return { ...readingCard(item, href), id: `${item.kind}:${item.id}`, overview: item.overview, genres: item.subjects };
}
export function readingFacts(item: ReadingDisplay) {
  return [
    ...(item.authors.length ? [{ label: 'Authors', value: item.authors.join(', ') }] : []),
    ...(item.publishedYear ? [{ label: 'First published', value: String(item.publishedYear) }] : []),
    ...(item.seriesTitle ? [{ label: 'Series', value: item.seriesTitle }] : []),
    ...(item.issueNumber ? [{ label: 'Issue', value: item.issueNumber }] : []),
    ...(item.subjects.length ? [{ label: 'Subjects', value: item.subjects.join(', ') }] : []),
    { label: 'Metadata', value: readingProviderLabel(item.provider) },
  ];
}
