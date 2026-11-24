import type { CardBadgeSlots, CardMetadataField, CardMetadataLayer, CardTextField } from '../card-slots';
import type { ArtworkPriority, MediaCardArtwork, MediaCardOverlay, MediaCardShape } from '../types';

export type CardHeaderField = CardTextField | 'none';
export type CardValueField = CardTextField | 'default' | 'rating' | 'match' | 'body' | 'footer';
export type CardLayoutValues = Partial<Record<CardValueField, string>>;
export type EditableCardLayer = { id: number; size: CardMetadataLayer['size']; fields: CardMetadataField[] };

export const cardLayoutTargets = ['movie', 'show', 'season', 'episode', 'box-set', 'album', 'track', 'game', 'book', 'comic', 'person'] as const;
export type CardLayoutTarget = typeof cardLayoutTargets[number];
export const cardShapes = ['auto', 'poster', 'fanart', 'square', 'circle', 'banner'] as const satisfies readonly (MediaCardShape | 'auto')[];
export const cardImageTypes = ['auto', 'none', 'primary', 'backdrop', 'thumb', 'banner', 'screenshot'] as const satisfies readonly MediaCardArtwork[];
export const cardOverlays = ['auto', 'none', 'logo', 'art', 'disc'] as const satisfies readonly (MediaCardOverlay | 'auto')[];
export const cardArtworkPriorities = [
  '', 'episode-season-show', 'episode-show-season', 'season-episode-show', 'season-show-episode', 'show-episode-season', 'show-season-episode',
] as const satisfies readonly (ArtworkPriority | '')[];
export const maxCardLayers = 6;
export const maxCardFields = 6;

export const cardLayoutDefaults = {
  shape: 'auto' as typeof cardShapes[number],
  artwork: true,
  monochromeMissing: undefined as boolean | undefined,
  artworkStyle: 'auto' as MediaCardArtwork,
  artworkPriority: '' as ArtworkPriority | '',
  overlay: 'auto' as typeof cardOverlays[number],
  caption: undefined as boolean | undefined,
  badges: undefined as boolean | undefined,
  header: undefined as boolean | undefined,
  headerLeading: 'actor' as CardHeaderField,
  headerTrailing: 'activity-date' as CardHeaderField,
  progressBar: undefined as boolean | undefined,
  primaryAction: undefined as boolean | undefined,
  artworkMenu: undefined as boolean | undefined,
  secondaryAction: undefined as boolean | undefined,
  requestStatus: undefined as boolean | undefined,
  body: undefined as boolean | undefined,
  footer: undefined as boolean | undefined,
};

export const defaultBadgeSlots: CardBadgeSlots = {
  'top-left': 'none', 'top-right': 'none', 'bottom-left': 'rating-or-match', 'bottom-right': 'friends',
};
export const emptyBadgeSlots: CardBadgeSlots = { 'top-left': 'none', 'top-right': 'none', 'bottom-left': 'none', 'bottom-right': 'none' };

export function defaultCardLayers(): EditableCardLayer[] {
  return [{ id: 0, size: 'medium', fields: ['title'] }, { id: 1, size: 'small', fields: ['default'] }];
}

export type CardLayout = {
  settings: typeof cardLayoutDefaults;
  badgeSlots: CardBadgeSlots;
  metadataLayers: EditableCardLayer[];
  metadataValues: CardLayoutValues;
};
export type CardLayouts = Partial<Record<`everywhere:${CardLayoutTarget | 'all'}`, CardLayout>>;
export const cardLayoutKey = <T extends CardLayoutTarget | 'all'>(type: T) => `everywhere:${type}` as const;

export function layoutForCard(layouts: CardLayouts | undefined, kind: CardLayoutTarget | 'collection' | 'artist') {
  return layouts?.[cardLayoutKey(kind === 'collection' ? 'box-set' : kind === 'artist' ? 'person' : kind)];
}

export function cardLayoutShowsFriends(layout: CardLayout | undefined) {
  return !layout || (layout.settings.badges !== false && Object.values(layout.badgeSlots).includes('friends'));
}

export function cardLayoutNumber(text: string | undefined, max: number) {
  const value = text?.trim().replace(/%$/, '');
  const number = value ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 && number <= max ? number : undefined;
}
