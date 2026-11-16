import type { BrowseVariant, DynamicKind, DynamicMedium } from './model';

export const kindsByMedium: Record<DynamicMedium, readonly DynamicKind[]> = {
  screen: ['movie', 'show'], game: ['game'], music: ['album'], reading: ['book', 'comic'],
};

type Genre = { label: string; movie?: number; show?: number; game?: string; book?: string; trakt?: string; aliases?: string[] };

// Closed vocabulary for shared provider reads. Keep the provider taxonomies
// separate where they group genres differently (e.g. TMDB TV science fiction).
export const providerGenres = {
  action: {label:'Action',movie:28,show:10759,trakt:'action',aliases:['action & adventure']},
  adventure: {label:'Adventure',movie:12,game:'Adventure',trakt:'adventure'},
  animation: {label:'Animation',movie:16,show:16,trakt:'animation'},
  comedy: {label:'Comedy',movie:35,show:35,trakt:'comedy'},
  crime: {label:'Crime',movie:80,show:80,trakt:'crime'},
  documentary: {label:'Documentary',movie:99,show:99,trakt:'documentary'},
  drama: {label:'Drama',movie:18,show:18,trakt:'drama'},
  fantasy: {label:'Fantasy',movie:14,book:'fantasy',trakt:'fantasy'},
  history: {label:'History',movie:36,book:'history',trakt:'history'},
  horror: {label:'Horror',movie:27,book:'horror',trakt:'horror'},
  mystery: {label:'Mystery',movie:9648,show:9648,book:'mystery',trakt:'mystery'},
  romance: {label:'Romance',movie:10749,book:'romance',trakt:'romance'},
  scifi: {label:'Science fiction',movie:878,show:10765,book:'science fiction',trakt:'science-fiction',aliases:['sci-fi','sci-fi & fantasy','science fiction & fantasy']},
  thriller: {label:'Thriller',movie:53,trakt:'thriller'},
  western: {label:'Western',movie:37,show:37,trakt:'western'},
  fighting: {label:'Fighting',game:'Fighting'},
  platform: {label:'Platform',game:'Platform',aliases:['platformer']},
  puzzle: {label:'Puzzle',game:'Puzzle'},
  racing: {label:'Racing',game:'Racing'},
  rpg: {label:'Role-playing',game:'Role-playing (RPG)',aliases:['role-playing (rpg)','role playing','rpg']},
  shooter: {label:'Shooter',game:'Shooter'},
  simulation: {label:'Simulation',game:'Simulator',aliases:['simulator']},
  strategy: {label:'Strategy',game:'Strategy'},
  fiction: {label:'Fiction',book:'fiction'},
} satisfies Record<string, Genre>;

export type ProviderGenre = keyof typeof providerGenres;
export function getProviderGenre(key: string | null | undefined): Genre | undefined {
  return key && Object.hasOwn(providerGenres,key) ? providerGenres[key as ProviderGenre] : undefined;
}

export function providerGenreKey(name: string, kind: DynamicKind) {
  if (kind === 'album' || kind === 'comic') return;
  const text = name.trim().toLowerCase();
  return (Object.keys(providerGenres) as ProviderGenre[]).find(key => {
    const entry: Genre = providerGenres[key];
    return entry[kind] && [key, entry.label.toLowerCase(), ...(entry.aliases ?? [])].includes(text);
  });
}

export type BrowseSources = { screen: boolean; tmdb: boolean; trakt: boolean; game: boolean; comics: boolean; seerr: boolean };
export function supportsProviderRow(sources: BrowseSources, kind: DynamicKind, variant: BrowseVariant, genre?: string) {
  if (genre) {
    const entry = getProviderGenre(genre);
    if (kind === 'album' || kind === 'comic' || !entry?.[kind]) return false;
  }
  if (variant === 'provider-genre') {
    if (!genre) return false;
    return kind === 'game' ? sources.game : kind === 'book' || sources.screen;
  }
  if (kind === 'game') return sources.game && (variant === 'provider-rated' || variant === 'provider-upcoming');
  if (kind === 'comic') return sources.comics && variant === 'provider-upcoming';
  if (kind !== 'movie' && kind !== 'show') return false;
  return variant === 'provider-rated' ? sources.tmdb : (variant === 'provider-popular' || variant === 'provider-upcoming') && sources.screen;
}

export const starterGenres: Partial<Record<DynamicKind, readonly ProviderGenre[]>> = {
  movie: ['scifi','thriller','comedy'], show: ['drama','crime','comedy'],
  game: ['rpg','strategy','puzzle'], book: ['fiction','mystery','scifi'],
};
