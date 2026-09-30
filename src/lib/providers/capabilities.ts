import type { MediaCategory } from '$lib/media/model';
export type ProviderField =
  | 'metadata'
  | 'availability'
  | 'history'
  | 'progress'
  | 'favourite'
  | 'collection'
  | 'ratings'
  | 'watchlist'
  | 'lists'
  | 'scrobble'
  | 'requests';
type Capability = {
  categories: readonly MediaCategory[];
  read: readonly ProviderField[];
  write: readonly ProviderField[];
  playback: boolean;
};
/** Implemented adapter abilities, independent of per-account sync preferences/permissions. */
export const providerCapabilities = {
  jellyfin: {
    categories: ['screen'],
    read: ['metadata', 'availability', 'history', 'progress', 'favourite'],
    write: ['history', 'progress', 'favourite', 'scrobble'],
    playback: true,
  },
  trakt: {
    categories: ['screen'],
    read: ['metadata', 'history', 'progress', 'collection', 'ratings', 'watchlist', 'lists'],
    write: ['history', 'progress', 'collection', 'ratings', 'watchlist', 'lists', 'scrobble'],
    playback: false,
  },
  seerr: {
    categories: ['screen'],
    read: ['requests', 'availability'],
    write: ['requests'],
    playback: false,
  },
  tmdb: { categories: ['screen'], read: ['metadata'], write: [], playback: false },
  igdb: { categories: ['game'], read: ['metadata'], write: [], playback: false },
} satisfies Record<string, Capability>;
export function supportsProviderField(
  provider: keyof typeof providerCapabilities,
  category: MediaCategory,
  field: ProviderField,
  direction: 'read' | 'write'
) {
  const capabilities: Capability = providerCapabilities[provider];
  return capabilities.categories.includes(category) && capabilities[direction].includes(field);
}
