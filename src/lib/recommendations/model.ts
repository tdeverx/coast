export type DynamicMedium = 'screen' | 'game' | 'music' | 'reading';
export type DynamicKind = 'movie' | 'show' | 'game' | 'album' | 'book' | 'comic';
export type GenreReason = 'liked' | 'watched' | 'saved' | 'explore';

/** A feed definition; cards are fetched separately when its shelf becomes visible. */
export type DynamicRow = { key: string; title: string; category: DynamicMedium } & (
  | { surface: 'popular' }
  | { surface: 'recommendations' }
  | { surface: 'genre'; genre: string; kind: DynamicKind; reason: GenreReason }
  | { surface: 'seed'; workId: string }
);
