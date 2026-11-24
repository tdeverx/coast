import { actionFromCategory } from '#lib/actions.js';
import { progressFraction } from '#lib/media/model.js';
import { displayLabel } from './labels';
import type { CardMetadataValues } from './card-slots';
import type { MediaCardDisplay, MediaCardPresentation, MediaView } from './types';

type CardItem = MediaView | MediaCardPresentation | MediaCardDisplay;

export function usesScreenCardCaption(item: CardItem, showWorkMetadata = true) {
  return showWorkMetadata && !('href' in item) && !item.captionActor && !item.captionActivity &&
    !item.captionDate && (!('eventId' in item) || (item.kind === 'episode' && !item.captionEpisodeRun));
}

export function artworkCardProgress(item: CardItem, showWorkMetadata = true, activityProgress?: number | null) {
  if (activityProgress !== undefined || item.captionActor) return activityProgress ?? null;
  if (usesScreenCardCaption(item, showWorkMetadata)) return null;

  const progress = item.trackingProgress ?? ('href' in item ? undefined : {
    unit: 'seconds' as const, value: item.progress, ...(item.duration > 0 ? { total: item.duration } : {}),
  });
  if (!progress) return null;
  const fraction = progressFraction(progress);
  const limit = item.kind === 'book' || item.kind === 'comic' ? 1 : 0.9;
  return fraction !== null && fraction > 0 && fraction < limit ? fraction : null;
}

export function cardLibraryLink(kind: MediaView['kind'] | MediaCardPresentation['kind']) {
  if (kind === 'person') return;
  const category = kind === 'game' ? 'game' : kind === 'book' || kind === 'comic' ? 'reading'
    : kind === 'album' || kind === 'track' || kind === 'artist' ? 'music' : 'screen';
  const entity = kind === 'season' || kind === 'episode' ? 'show' : kind === 'game' ? 'all' : kind;
  return { text: displayLabel(kind), href: `/library?${new URLSearchParams({ view: actionFromCategory(category), kind: entity })}` };
}

function durationText(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours && `${hours}h`, remainder && `${remainder}m`].filter(Boolean).join(' ');
}

export function cardRuntime(item: Pick<MediaView, 'runtimeMinutes'> & Partial<Pick<MediaView, 'duration'>>) {
  const runtimeMinutes = item.runtimeMinutes || Math.ceil((item.duration ?? 0) / 60);
  return runtimeMinutes > 0 ? durationText(runtimeMinutes) : undefined;
}

export function cardTimeRemaining(item: MediaView) {
  const progress = item.trackingProgress ?? { unit: 'seconds', value: item.progress };
  if (!item.watched && progress.unit === 'seconds') {
    const runtimeMinutes = item.runtimeMinutes || Math.ceil(item.duration / 60);
    const total = progress.total || item.duration || runtimeMinutes * 60;
    const fraction = progressFraction({ ...progress, total });
    if (fraction !== null && fraction > 0 && fraction < 1) {
      return `${durationText(Math.ceil((total - progress.value) / 60))} left`;
    }
  }
}

export function screenCardCaption(item: MediaView, showTimeRemaining: boolean, values?: CardMetadataValues) {
  const { kind, seasonNumber, episodeNumber } = item;
  const seasonCode = values?.season?.trim() || (seasonNumber == null ? undefined : `S${String(seasonNumber).padStart(2, '0')}`);
  const seasonId = kind === 'season' ? item.id : item.seasonId;
  const certification = values?.certification?.trim() || item.certification?.trim();
  const count = item.totalEpisodes && item.completedEpisodes != null
    ? `${Math.max(0, item.totalEpisodes - item.completedEpisodes)} behind` : undefined;
  const library = cardLibraryLink(kind);
  const mediaType = values?.type?.trim();
  const mediaLabel = mediaType ? { ...library, text: mediaType } : library;

  const title = kind === 'episode' && episodeNumber != null ? `${episodeNumber}. ${item.title}`
    : kind === 'season' ? item.title.trim() || (seasonNumber === 0 ? 'Specials' : seasonNumber == null ? 'Season' : `Season ${seasonNumber}`)
    : item.title;
  const showTitle = values?.show?.trim() || item.showTitle;
  const context = kind === 'episode' && showTitle && (item.showId || values?.show)
    ? { text: showTitle, href: item.showId ? `/media/${item.showId}` : undefined } : undefined;

  const label = kind === 'episode' || kind === 'season'
    ? seasonCode ? { text: seasonCode, href: seasonId ? `/media/${seasonId}` : undefined } : mediaLabel
    : certification ? { text: certification, href: item.certificationHref ?? `/media/${item.id}` } : mediaLabel;
  const detail = kind === 'movie' || kind === 'episode'
    ? (showTimeRemaining ? values?.['time-left']?.trim() || cardTimeRemaining(item) : undefined)
      ?? (values?.runtime?.trim() || cardRuntime(item))
    : values?.behind?.trim() || count;
  return { title, context, label, detail };
}
