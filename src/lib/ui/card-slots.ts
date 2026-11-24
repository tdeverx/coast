import { progressFraction } from '#lib/media/model.js';
import { cardLibraryLink, cardRuntime, cardTimeRemaining } from './card-caption';
import { displayLabel } from './labels';
import type { MediaCardDisplay, MediaCardPresentation, MediaView } from './types';

export const cardBadgeCorners = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
] as const;

export const cardMetadataSizes = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
] as const;

const cardDataFields = [
  { id: 'type', label: 'Media type' },
  { id: 'subtitle', label: 'Subtitle' },
  { id: 'year', label: 'Year' },
  { id: 'release-date', label: 'Release date' },
  { id: 'certification', label: 'Age certificate' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'time-left', label: 'Time remaining' },
  { id: 'progress', label: 'Progress' },
  { id: 'behind', label: 'Items behind' },
  { id: 'show', label: 'Show title' },
  { id: 'season', label: 'Season number' },
  { id: 'episode', label: 'Episode number' },
  { id: 'credits', label: 'Credits' },
  { id: 'genres', label: 'Genres' },
  { id: 'actor', label: 'Activity author' },
  { id: 'activity', label: 'Activity' },
  { id: 'activity-date', label: 'Activity date' },
  { id: 'status', label: 'Status' },
  { id: 'availability', label: 'Availability' },
  { id: 'source', label: 'Source' },
] as const;

const emptyField = { id: 'none', label: 'None' } as const;
const titleField = { id: 'title', label: 'Title' } as const;
const scoreFields = [
  { id: 'rating-or-match', label: 'Rating or Taste match' },
  { id: 'rating', label: 'Rating' },
  { id: 'match', label: 'Taste match' },
] as const;

export const cardMetadataFields = [
  emptyField,
  titleField,
  { id: 'default', label: 'Default details' },
  ...scoreFields,
  ...cardDataFields,
] as const;

export const cardBadgeFields = [
  emptyField,
  ...scoreFields,
  { id: 'friends', label: 'Friend avatars' },
  ...cardDataFields,
] as const;

export type CardBadgeCorner = typeof cardBadgeCorners[number]['id'];
export type CardBadgeField = typeof cardBadgeFields[number]['id'];
export type CardBadgeSlots = Record<CardBadgeCorner, CardBadgeField>;
export type CardMetadataField = typeof cardMetadataFields[number]['id'];
export const cardTextFields = [titleField, ...cardDataFields] as const;
export type CardTextField = typeof cardTextFields[number]['id'];
export type CardMetadataValues = Partial<Record<CardTextField | 'default', string>>;
export type CardMetadataLayer = {
  size: typeof cardMetadataSizes[number]['id'];
  fields: readonly CardMetadataField[];
};

export type CardSlotValue = { text: string; href?: string };
export type CardDataField = typeof cardDataFields[number]['id'];
type CardItem = MediaView | MediaCardPresentation | MediaCardDisplay;

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

export function cardMetadataDate(value?: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;
  if (Number.isFinite(timestamp)) return dateFormat.format(timestamp);
}

function values(text?: string | number | null, href?: string): CardSlotValue[] {
  return text != null && String(text).trim() ? [{ text: String(text), href }] : [];
}

function slotValues(item: CardItem, field: CardDataField, activityProgress?: number | null): CardSlotValue[] {
  const work = 'href' in item ? undefined : item;
  switch (field) {
    case 'type': {
      const link = cardLibraryLink(item.kind);
      return link ? [link] : values(displayLabel(item.kind));
    }
    case 'subtitle': return values(item.captionSubtitle, item.captionSubtitleHref);
    case 'year': return values(item.year);
    case 'release-date': return values(cardMetadataDate(work?.releaseDate));
    case 'certification': {
      const certification = work?.certification?.trim();
      return values(certification, certification && work ? work.certificationHref ?? `/media/${work.id}` : undefined);
    }
    case 'runtime': return values(work ? cardRuntime(work) : item.durationLabel);
    case 'time-left': return values(work && cardTimeRemaining(work));
    case 'progress': {
      const progress = item.trackingProgress ?? (work && { unit: 'seconds' as const, value: work.progress, total: work.duration });
      const fraction = activityProgress === undefined ? (progress ? progressFraction(progress) : null) : activityProgress;
      return values(fraction == null ? undefined : `${Math.round(fraction * 100)}%`);
    }
    case 'behind': return values(work?.totalEpisodes && work.completedEpisodes != null
      ? `${Math.max(0, work.totalEpisodes - work.completedEpisodes)} behind` : undefined);
    case 'show': return values(work?.showTitle, work?.showId ? `/media/${work.showId}` : undefined);
    case 'season': {
      const seasonId = work?.kind === 'season' ? work.id : work?.seasonId;
      return values(work?.seasonNumber == null ? undefined : `S${String(work.seasonNumber).padStart(2, '0')}`,
        seasonId ? `/media/${seasonId}` : undefined);
    }
    case 'episode': return values(work?.episodeNumber == null ? undefined : `E${String(work.episodeNumber).padStart(2, '0')}`,
      work?.kind === 'episode' ? `/media/${work.id}` : undefined);
    case 'credits': return item.captionCredits?.map(({ name, href }) => ({ text: name, href })) ?? [];
    case 'genres': return work?.genres?.map(text => ({ text })) ?? [];
    case 'actor': return values(item.captionActor?.username, item.captionActor?.profileHref ?? undefined);
    case 'activity': return values([item.captionActivity?.action, item.captionActivity?.detail].filter(Boolean).join(' ') ||
      (item.captionActor ? item.captionSubtitle : undefined));
    case 'activity-date': return values(cardMetadataDate(item.captionActivity?.dateKnown ? item.captionActivity.occurredAt : item.captionDate));
    case 'status': return values(item.captionStatus?.label ?? (work?.status ? displayLabel(work.status) : undefined));
    case 'availability': return values(work?.playbackPending ? 'Playback pending' : item.available == null ? undefined : item.available ? 'Available' : 'Unavailable');
    case 'source': return values(work?.source);
  }
}

export function cardSlotValue(item: CardItem, field: CardDataField, activityProgress?: number | null,
  overrides?: CardMetadataValues): CardSlotValue[] {
  const data = slotValues(item, field, activityProgress);
  const text = overrides?.[field]?.trim();
  return text ? values(text, data[0]?.href) : data;
}

export function cardSlotData(item: CardItem, activityProgress?: number | null,
  overrides?: CardMetadataValues): Record<CardDataField, CardSlotValue[]> {
  return Object.fromEntries(cardDataFields.map(({ id }) => [id, cardSlotValue(item, id, activityProgress, overrides)])) as
    Record<CardDataField, CardSlotValue[]>;
}
