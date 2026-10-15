export type DynamicMedium = 'screen' | 'game' | 'music' | 'reading';
export const dynamicKinds = ['movie', 'show', 'game', 'album', 'book', 'comic'] as const;
export type DynamicKind = (typeof dynamicKinds)[number];
export function dynamicKind(value: string | null): DynamicKind | undefined {
  return (dynamicKinds as readonly string[]).includes(value ?? '') ? value as DynamicKind : undefined;
}
export type GenreReason = 'liked' | 'watched' | 'saved' | 'explore';

/** A feed definition; cards are fetched separately when its shelf becomes visible. */
export type DynamicRow = { key: string; title: string; category: DynamicMedium } & (
  | { surface: 'popular' }
  | { surface: 'recommendations' }
  | { surface: 'genre'; genre: string; kind: DynamicKind; reason: GenreReason }
  | { surface: 'seed'; workId: string }
);
