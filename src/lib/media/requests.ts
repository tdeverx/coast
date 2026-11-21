import type { MediaActionData } from './actions';

export type RequestDestination = {
  id: string;
  name: string;
  variants: { standard: RequestVariant | null; fourK: RequestVariant | null };
};
export type RequestVariant = {
  serverId: number | null;
  requestable: boolean;
  available: boolean;
  requested: boolean;
  seasons: RequestSeason[];
};

const seasonBlockReasons = ['Partially available', 'Processing', 'Pending', 'Blocked', 'Unavailable'] as const;
export type RequestSeasonBlockReason = typeof seasonBlockReasons[number];
type RequestSeason = { number: number; requested: boolean; mine: boolean; available: boolean; blockedReason?: RequestSeasonBlockReason };
type SeasonStatus = Pick<RequestSeason, 'available' | 'requested' | 'blockedReason'>;

export function requestSeasonStatus(season: SeasonStatus) {
  if (season.available) return 'Available';
  if (season.requested) return 'Requested';
  return season.blockedReason;
}

export function canRequestSeason(variant: RequestVariant | null | undefined, season: SeasonStatus) {
  return !!variant?.requestable && !requestSeasonStatus(season);
}

/** Availability captions share the season checklist's precedence across destinations. */
export function requestQualityStatus(destinations: readonly RequestDestination[], quality: 'standard' | 'fourK') {
  const variants = destinations.flatMap(destination => destination.variants[quality] ?? []);
  if (variants.some(variant => variant.requestable)) return '';
  if (variants.some(variant => variant.available)) return 'Available';
  if (variants.some(variant => variant.requested)) return 'Requested';
  return 'Unavailable';
}

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
  const choices = new Map<number, SeasonStatus & { number: number; selectable: boolean }>();
  for (const destination of destinations) {
    const variant = destination.variants[quality];
    for (const season of variant?.seasons ?? []) {
      if (only !== undefined && season.number !== only) continue;
      const choice = choices.get(season.number) ?? {
        number: season.number, selectable: false, requested: false, available: false,
      };
      choice.selectable ||= canRequestSeason(variant, season);
      choice.requested ||= season.requested;
      choice.available ||= season.available;
      if (season.blockedReason && (!choice.blockedReason || seasonBlockReasons.indexOf(season.blockedReason) < seasonBlockReasons.indexOf(choice.blockedReason)))
        choice.blockedReason = season.blockedReason;
      choices.set(season.number, choice);
    }
  }
  return [...choices.values()].sort((left, right) => left.number - right.number);
}
