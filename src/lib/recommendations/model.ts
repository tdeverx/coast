export type DynamicMedium = 'screen' | 'game' | 'music' | 'reading';
export const dynamicKinds = ['movie', 'show', 'game', 'album', 'book', 'comic'] as const;
export type DynamicKind = (typeof dynamicKinds)[number];
export function dynamicKind(value: string | null): DynamicKind | undefined {
  return (dynamicKinds as readonly string[]).includes(value ?? '') ? value as DynamicKind : undefined;
}
export type GenreReason = 'liked' | 'watched' | 'saved' | 'explore';
export const browseVariants = ['library', 'upcoming', 'provider-genre', 'provider-popular', 'provider-rated', 'provider-upcoming'] as const;
export type BrowseVariant = typeof browseVariants[number];
export function browseVariant(value: string | null): BrowseVariant | undefined {
  return browseVariants.find(variant => variant === value);
}

/** A feed definition; cards are fetched separately when its shelf becomes visible. */
export type DynamicRow = { key: string; title: string; category: DynamicMedium } & (
  | { surface: 'popular' }
  | { surface: 'discovery'; section: 'trending' | 'recent' }
  | { surface: 'recommendations'; kind?: DynamicKind; available?: boolean }
  | { surface: 'genre'; genre: string; kind: DynamicKind; reason: GenreReason; available?: boolean }
  | { surface: 'browse'; variant: BrowseVariant; genre?: string; kind: DynamicKind }
  | { surface: 'seed'; workId: string }
);
