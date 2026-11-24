import type { IconName } from '#lib/ui/components/Icon.svelte';
import type { MediaCardShape } from '#lib/ui/types.js';
import type { CardKind } from './examples';
import type { CardLayoutTarget } from '../layout';

export const variantStyle: Record<CardKind, {
  shape: MediaCardShape;
  icon: IconName;
}> = {
  movie: { shape: 'poster', icon: 'film' },
  show: { shape: 'poster', icon: 'party' },
  season: { shape: 'poster', icon: 'collection' },
  episode: { shape: 'fanart', icon: 'play' },
  collection: { shape: 'poster', icon: 'collection' },
  album: { shape: 'square', icon: 'collection' },
  track: { shape: 'square', icon: 'volume' },
  artist: { shape: 'circle', icon: 'user' },
  game: { shape: 'square', icon: 'gamepad' },
  book: { shape: 'poster', icon: 'library' },
  comic: { shape: 'poster', icon: 'image' },
  person: { shape: 'circle', icon: 'user' },
};

export type CardVariant = {
  id: CardLayoutTarget;
  label: string;
  kind: CardKind;
};

export const variants: readonly [CardVariant, ...CardVariant[]] = [
  { id: 'movie', label: 'Movie', kind: 'movie' },
  { id: 'show', label: 'Show', kind: 'show' },
  { id: 'season', label: 'Season', kind: 'season' },
  { id: 'episode', label: 'Episode', kind: 'episode' },
  { id: 'box-set', label: 'Collection', kind: 'collection' },
  { id: 'album', label: 'Album', kind: 'album' },
  { id: 'track', label: 'Track', kind: 'track' },
  { id: 'game', label: 'Game', kind: 'game' },
  { id: 'book', label: 'Book', kind: 'book' },
  { id: 'comic', label: 'Comic', kind: 'comic' },
  { id: 'person', label: 'Person', kind: 'person' },
];

export const variantOptions = variants.map(option => ({ ...option, icon: variantStyle[option.kind].icon }));
