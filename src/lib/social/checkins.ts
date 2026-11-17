export type ActiveCheckin = { id: string; workId: string; mode: 'timed' | 'manual'; expiresAt: string };
export type CheckinEpisode = { id: string; title: string; seasonNumber: number; episodeNumber: number };
export type CheckinEpisodePage = { items: CheckinEpisode[]; hasMore: boolean };
export type CheckinTrackPage = { items: { id: string; title: string }[]; hasMore: boolean; activeCheckin: ActiveCheckin | null };

export const episodeCheckinScope = (kind: string) => kind === 'show' || kind === 'season';
export function supportsCheckin(kind:string) {
  return ['movie', 'episode', 'collection', 'game', 'book', 'comic', 'track', 'album'].includes(kind) || episodeCheckinScope(kind);
}

export function checkinEpisodeLabel(episode: CheckinEpisode) {
  const number = (value: number) => String(value).padStart(2, '0');
  return `S${number(episode.seasonNumber)}E${number(episode.episodeNumber)} · ${episode.title}`;
}
