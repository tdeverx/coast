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

/** Bind destination multiplicity once for a request snapshot, then format its labels. */
export function requestScopeFormatter(requests: MediaActionData['requests']) {
  const multipleDestinations = new Set(requests.map((entry) => entry.destination)).size > 1;
  return (request: MediaActionData['requests'][number]) => {
    const scope = request.seasons.length
      ? `${request.seasons.length === 1 ? 'Season' : 'Seasons'} ${request.seasons.join(', ')}`
      : request.is4k
        ? '4K version'
        : 'Standard version';
    return `${scope}${request.is4k && request.seasons.length ? ' · 4K' : ''}${multipleDestinations ? ` · ${request.destination}` : ''}`;
  };
}

/** A season can be selected when at least one eligible destination can request it. */
export function requestSeasonChoices(destinations: readonly RequestDestination[], quality: 'standard' | 'fourK', only?: number) {
  const choices = new Map<number, { number: number; selectable: boolean; requested: boolean; available: boolean }>();
  for (const destination of destinations) {
    const variant = destination.variants[quality];
    for (const season of variant?.seasons ?? []) {
      if (only !== undefined && season.number !== only) continue;
      const choice = choices.get(season.number) ?? {
        number: season.number, selectable: false, requested: false, available: false,
      };
      choice.selectable ||= !!variant?.requestable && !season.requested && !season.available;
      choice.requested ||= season.requested;
      choice.available ||= season.available;
      choices.set(season.number, choice);
    }
  }
  return [...choices.values()].sort((left, right) => left.number - right.number);
}
