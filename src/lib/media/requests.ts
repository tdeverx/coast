import type { MediaActionData } from './actions';

export type RequestDestination = {
  id: string;
  name: string;
  variants: { standard: RequestVariant | null; fourK: RequestVariant | null };
};
export type RequestVariant = {
  serverId: number | null;
  requestable: boolean;
  seasons: { number: number; requested: boolean; mine: boolean; available: boolean }[];
};

export function requestScope(
  request: MediaActionData['requests'][number],
  requests: MediaActionData['requests']
) {
  const scope = request.seasons.length
    ? `${request.seasons.length === 1 ? 'Season' : 'Seasons'} ${request.seasons.join(', ')}`
    : request.is4k
      ? '4K version'
      : 'Standard version';
  return `${scope}${request.is4k && request.seasons.length ? ' · 4K' : ''}${new Set(requests.map((entry) => entry.destination)).size > 1 ? ` · ${request.destination}` : ''}`;
}
