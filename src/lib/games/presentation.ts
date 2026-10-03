import type { MediaCardPresentation, MediaHeroPresentation } from '../ui/types';
export type GameMetadata = {
  available?: boolean;
  title: string;
  overview?: string | null;
  releaseDate?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  platforms: string[];
  genres: string[];
  developers: string[];
  publishers: string[];
};
export function gameCard(
  item: GameMetadata & { id: string },
  href = `/games/${item.id}`
): MediaCardPresentation {
  return {
    id: item.id,
    kind: 'game',
    title: item.title,
    href,
    poster: item.posterPath,
    backdrop: item.backdropPath,
    year: item.releaseDate ? Number(item.releaseDate.slice(0, 4)) : null,
    available: item.available ?? false,
    captionSubtitle: item.available ? 'Owned on Steam' : item.platforms.join(' · ') || 'Game',
  };
}
export function gameFacts(item: GameMetadata) {
  return [
    ...(item.releaseDate ? [{ label: 'Released', value: item.releaseDate }] : []),
    ...(['platforms', 'genres', 'developers', 'publishers'] as const).flatMap((key) =>
      item[key].length
        ? [{ label: key[0].toUpperCase() + key.slice(1), value: item[key].join(', ') }]
        : []
    ),
  ];
}
export const gameMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export function gameHero(
  item: GameMetadata & { id: string },
  href = `/games/${item.id}`
): MediaHeroPresentation {
  return {
    ...gameCard(item, href),
    id: `game:${item.id}`,
    overview: item.overview,
    genres: item.genres,
  };
}
