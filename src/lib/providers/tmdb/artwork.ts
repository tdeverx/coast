export function tmdbArtwork(
  path: string | null | undefined,
  size: 'w342' | 'w780' | 'w1280' | 'original' = 'w780'
) {
  return path && /^\/[a-zA-Z0-9_.-]+$/.test(path)
    ? `https://image.tmdb.org/t/p/${size}${path}`
    : undefined;
}
