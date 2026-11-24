import type { ComponentProps } from 'svelte';
import { requestFeedCard } from '#lib/library-feed.js';
import { playbackTime } from '#lib/playback/time.js';
import type { MediaActionData } from '#lib/media/actions.js';
import type { ApiTransport } from '#lib/ui/client.js';
import type { JournalEntry } from '#lib/profile/journal.js';
import { activityAction } from '#lib/social/model.js';
import { journalCards } from '#lib/ui/shelves/journal-cards.js';
import type { MediaCardArtwork, MediaCardShape, MediaView } from '#lib/ui/types.js';
import type MediaCard from '#lib/ui/components/MediaCard.svelte';
import { catalogueCards, catalogueTitles, type CatalogueTitle } from './catalogue-samples';

type CardProps = ComponentProps<typeof MediaCard>;
type CardItem = CardProps['item'];
export type CardKind = CardItem['kind'];

export type CardExample = {
  key?: string;
  previewLabel?: string;
  item: CardItem;
  shape?: MediaCardShape;
  artworkStyle?: MediaCardArtwork;
  match?: number;
  props?: Pick<CardProps, 'artworkOnly' | 'activityProgress' | 'showArtworkMenu' | 'showCaption' | 'showPrimaryAction' | 'showWorkMetadata'>;
  body?: string;
  footer?: string;
  date?: string;
  trailingDate?: string;
  menu?: 'avatar' | 'party' | 'shared-link' | 'stream';
  watchedAction?: boolean;
};

const poster = (path: string) => `https://image.tmdb.org/t/p/w342/${path}.jpg`;
const backdrop = (path: string) => `https://image.tmdb.org/t/p/w780/${path}.jpg`;
export const bbfc = 'https://www.bbfc.co.uk/';
const screenDefaults = {
  available: true, progress: 0, duration: 0, watched: false, playCount: 0,
  watchlist: false, favourite: false, collected: false, dropped: false, rating: null,
} satisfies Omit<MediaView, 'id' | 'kind' | 'title'>;

const movies: (CardExample & { item: MediaView })[] = [
  {
    item: {
      ...screenDefaults, id: 'card-preview-interstellar', kind: 'movie', title: 'Interstellar', year: 2014,
      certification: '12', runtimeMinutes: 169,
      certificationHref: bbfc + 'release/interstellar-q29sbgvjdglvbjpwwc0zode4nzi',
      duration: 10140, progress: 6300, rating: 5,
      poster: poster('gEU2QniE6E77NI6lCU6MxlNBvIx'),
      backdrop: backdrop('xJHokMbljvjADYdit5fK5VQsXEG'),
    },
    match: 96,
  },
  {
    item: {
      ...screenDefaults, id: 'card-preview-blade-runner', kind: 'movie', title: 'Blade Runner 2049', year: 2017,
      certification: '15', runtimeMinutes: 163,
      certificationHref: bbfc + 'release/blade-runner-2049-q29sbgvjdglvbjpwwc0zotyymtm',
      duration: 9780, watched: true,
      poster: poster('gajva2L0rPYkEWjzgFlBXCAVBE5'),
      backdrop: backdrop('ilRyazdMJwN05exqhwK4tMKBYZs'),
    },
    match: 80,
  },
  {
    item: {
      ...screenDefaults, id: 'card-preview-dune', kind: 'movie', title: 'Dune: Part Two', year: 2024,
      certification: '12', runtimeMinutes: 166,
      certificationHref: bbfc + 'release/dune-part-two-q29sbgvjdglvbjpwwc0xmdezmtm2',
      duration: 9960,
      poster: poster('1pdfLvkbY9ohJlCjQH2CZjjYVvJ'),
      backdrop: backdrop('oBIQDKcqNxKckjugtmzpIIOgoc4'),
    },
    match: 62,
  },
];

export const previewStates = [
  { id: 'catalogue', label: 'Default', icon: 'library' },
  { id: 'none', label: 'Artwork only', icon: 'image' },
  { id: 'activity', label: 'Activity', icon: 'broadcast' },
  { id: 'request', label: 'Request', icon: 'request' },
  { id: 'session', label: 'Session', icon: 'party' },
] as const;

export type CardState = typeof previewStates[number]['id'];

export const sessionOptions = [
  { id: 'live', label: 'Live stream', icon: 'broadcast' },
  { id: 'grouped', label: 'Grouped stream', icon: 'party' },
  { id: 'ended', label: 'Ended stream', icon: 'history' },
  { id: 'shared-link', label: 'Shared link', icon: 'link' },
] as const;
export const avatarOptions = [
  { id: 'none', label: 'None' },
  { id: 'avatar', label: 'Edit profile avatar' },
  { id: 'party', label: 'Party participant' },
] as const;

export type AvatarMenu = typeof avatarOptions[number]['id'];
export type SessionMode = typeof sessionOptions[number]['id'];
type StreamState = Exclude<SessionMode, 'shared-link'>;

const actor = { username: 'Maya', status: 'online' as const };
const today = '2026-10-01';

export function cardPreviewTransport(item: () => CardItem): ApiTransport {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const { pathname } = new URL(request?.url ?? input.toString(), 'http://preview.invalid');
    const method = init?.method ?? request?.method ?? 'GET';
    const card = item();
    if (method === 'GET' && pathname.startsWith('/api/v1/')) {
      if (pathname.endsWith('/actions') && 'progress' in card) {
        const data: MediaActionData = {
          item: card, wholeWork: card, releaseDate: card.releaseDate ?? null,
          hasReleaseDate: !!(card.releaseDate || card.year), progressTargetIds: [card.id], hasPersonalOverrides: false,
          activeCheckinId: null, ownRewatchStartedAt: null, rewatchTargetIds: [card.id], targets: [card],
          requestTarget: card, requestsEnabled: !card.available, refreshTarget: null,
          playable: card.available ? card : null, editions: [], requests: [],
        };
        return Response.json(data);
      }
      if (/\/collection\/[^/]+$/.test(pathname)) {
        return Response.json({ reasons: [], rating: card.rating ?? null, queued: false, game: null, reading: null });
      }
      if (/(?:\/lists|\/history|\/friends|\/playthroughs)$/.test(pathname)) {
        return Response.json({ items: [], page: 1, pages: 1, total: 0 });
      }
      if (pathname.endsWith('/options') && pathname.includes('/requests/')) return Response.json({ destinations: [] });
    }
    return Response.json({ error: 'This action only previews the control.' }, { status: 409 });
  };
}
function activityMetadata(item: CardItem): CardItem {
  const show = 'showId' in item && item.kind === 'episode' ? item : undefined;
  const showTitle = show?.showTitle;
  const kind = item.kind === 'book' || item.kind === 'comic' ? 'reading-completed'
    : item.kind === 'album' || item.kind === 'track' || item.kind === 'artist' ? 'listen'
    : item.kind === 'game' ? 'play'
    : item.kind === 'person' ? 'reaction' : item.kind === 'collection' ? 'collect' : 'watch';
  return {
    ...item,
    captionActor: actor,
    captionTitle: showTitle ?? item.title,
    captionTitleHref: showTitle && show?.showId ? `/media/${show.showId}` : undefined,
    captionActivity: {
      id: item.id, occurredAt: `${today}T19:00:00Z`, dateKnown: true, kind,
      action: activityAction(kind), detail: showTitle ? item.title : undefined,
    },
  };
}
const requestStates = ['pending', 'available', 'declined'] as const;
const containerExamples: CardExample[] = [
  {
    item: catalogueCards.playlist,
    previewLabel: 'Playlist',
    shape: 'square',
    props: { showPrimaryAction: false, showArtworkMenu: false },
  },
  {
    item: catalogueCards.comicSeries,
    previewLabel: 'Comic series',
    shape: 'poster',
    props: { showPrimaryAction: false, showArtworkMenu: false },
  },
];

function journalExamples(example: CardExample): CardExample[] {
  const { item } = example;
  const watchedAt = `${today}T18:00:00Z`;
  if (!('progress' in item) || (item.kind !== 'movie' && item.kind !== 'episode')) {
    return [{ ...example, item: activityMetadata(item), match: undefined, trailingDate: watchedAt }];
  }
  const entry: JournalEntry = { ...item, eventId: `${item.id}-watch`, watchedAt, source: 'manual', rewatched: false, watched: true, progress: 0 };
  if (item.kind === 'movie') return [{ ...example, item: entry, match: undefined }];

  const season = String(item.seasonNumber ?? 0).padStart(2, '0');
  const number = String(item.episodeNumber ?? 0).padStart(2, '0');
  const episodeEntry: JournalEntry = {
    ...entry,
    captionTitle: item.showTitle ?? item.title,
    captionTitleHref: item.showId ? `/media/${item.showId}` : undefined,
    captionSubtitleHref: `/media/${item.id}`,
    captionSubtitle: `S${season}E${number} · ${item.title}`,
  };
  const latest = { ...episodeEntry, eventId: `${item.id}-run`, watchedAt: `${today}T20:00:00Z` };
  const earlier = { ...episodeEntry, eventId: `${item.id}-previous`, watchedAt: `${today}T19:00:00Z` };
  return journalCards([[episodeEntry], [latest, earlier]]).map(card => ({ ...example, key: card.key, item: card.item, match: undefined }));
}

function streamExample(item: CardItem, streamState: StreamState): CardExample {
  const work = 'progress' in item ? item : undefined;
  const episodeCode = work?.kind === 'episode' && work.seasonNumber != null && work.episodeNumber != null
    ? ` S${String(work.seasonNumber).padStart(2, '0')}E${String(work.episodeNumber).padStart(2, '0')}`
    : '';
  const grouped = streamState === 'grouped';
  const status = { live: 'Playing', grouped: 'Shared stream', ended: 'Ended' }[streamState];
  const duration = work?.duration || 2700;
  const trailingDate = streamState === 'ended' ? `${today}T19:45:00Z` : undefined;
  return {
    key: streamState,
    item: { ...item, captionTitle: item.title, captionActor: actor, captionSubtitle: status + episodeCode,
      captionDate: trailingDate, source: 'Jellyfin' },
    shape: 'fanart', artworkStyle: item.artwork?.thumb ? 'thumb' : 'backdrop',
    props: { showPrimaryAction: false, activityProgress: grouped ? null : 2 / 3 },
    body: grouped ? 'Jellyfin · Direct play' : 'Jellyfin · Coast · Direct play',
    footer: grouped ? undefined : `${playbackTime(duration * 2 / 3)} / ${playbackTime(duration)}`,
    trailingDate,
    menu: grouped ? 'stream' : undefined,
  };
}

function catalogueArtwork(title?: CatalogueTitle) {
  if (!title) return;
  const primary = title.posterPath ? poster(title.posterPath) : undefined;
  const wide = title.backdropPath ? backdrop(title.backdropPath) : undefined;
  return { primary, backdrop: wide, thumb: title.kind === 'episode' ? wide : undefined };
}

function catalogueExample(title: CatalogueTitle): CardExample {
  const { posterPath, backdropPath, ...metadata } = title;
  const { id, kind, showId, seasonId, seasonNumber, totalEpisodes, runtimeMinutes, certification } = metadata;
  const seriesId = kind === 'show' ? id : showId;
  const artwork = catalogueArtwork(title);
  const artworkSources = seriesId ? {
    show: catalogueArtwork(catalogueTitles.find(entry => entry.id === seriesId)),
    season: catalogueArtwork(catalogueTitles.find(entry => seasonId ? entry.id === seasonId : entry.kind === 'season' &&
      entry.showId === seriesId && (seasonNumber === undefined || entry.seasonNumber === seasonNumber))),
    episode: catalogueArtwork(catalogueTitles.find(entry => entry.kind === 'episode' && entry.showId === seriesId &&
      (seasonNumber === undefined || entry.seasonNumber === seasonNumber))),
  } : undefined;
  return {
    match: 92,
    previewLabel: kind === 'collection' ? 'Box set' : undefined,
    item: {
      ...screenDefaults, ...metadata,
      certificationHref: certification ? `${bbfc}rating/${certification}` : undefined,
      poster: artwork?.primary, backdrop: artwork?.backdrop, artwork, artworkSources,
      completedEpisodes: totalEpisodes ? totalEpisodes - 2 : undefined,
      duration: (runtimeMinutes ?? 0) * 60,
    },
  };
}

function defaultExamplesFor(kind: CardKind): CardExample[] {
  if (kind === 'movie') return movies;
  if (kind === 'person') return [{ item: catalogueCards.person }, { item: catalogueCards.artist, previewLabel: 'Artist', match: 82 }];
  if (kind === 'game' || kind === 'album' || kind === 'track' || kind === 'artist' || kind === 'book' || kind === 'comic') {
    return [{ item: catalogueCards[kind], match: 82 }];
  }
  const catalogue = catalogueTitles.filter(title => title.kind === kind).map(catalogueExample);
  return kind === 'collection' ? [...catalogue, ...containerExamples] : catalogue;
}

function artworkOnlyExample(example: CardExample, avatarMenu: AvatarMenu): CardExample {
  const { item } = example;
  if (item.kind !== 'person' || avatarMenu === 'none') {
    return { ...example, props: { ...example.props, artworkOnly: true } };
  }
  return {
    ...example,
    item: avatarMenu === 'party' ? { ...item, kind: 'person', href: '/profile/Maya' } : { ...item, href: null },
    props: { showCaption: false, showPrimaryAction: avatarMenu === 'avatar' },
    menu: avatarMenu,
  };
}

function requestExample(example: CardExample, state: typeof requestStates[number]): CardExample {
  const { item } = example;
  const id = `card-preview-request-${item.id}-${state}`;
  const request = requestFeedCard(movies[0].item, { id, state, destination: 'Jellyfin', createdAt: today }, actor);
  const available = state === 'available';
  return {
    ...example,
    previewLabel: request.captionStatus?.label,
    match: undefined,
    item: {
      ...item, available, entryId: id,
      ...('progress' in item ? { canOpen: available, playbackPending: false } : {}),
      captionActor: request.captionActor, captionSubtitle: request.captionSubtitle,
      captionDate: request.captionDate, captionStatus: request.captionStatus,
    },
  };
}

function sharedLinkExamples(examples: CardExample[]): CardExample[] {
  return ['Website', 'VRChat'].map((platform, index) => {
    const { item } = examples[index % examples.length];
    return {
      key: platform,
      previewLabel: platform,
      item: { ...item, captionSubtitle: platform, rating: null }, shape: 'fanart',
      artworkStyle: item.artwork?.thumb ? 'thumb' : 'backdrop', menu: 'shared-link',
      props: { showPrimaryAction: false, showWorkMetadata: false, activityProgress: null },
      body: 'No active viewers', footer: 'Expires', date: `${today}T20:00:00Z`,
    };
  });
}

export function examplesFor(kind: CardKind,
  { state = 'catalogue', avatarMenu = 'none', sessionMode = 'live', journalLayout = false }: {
    state?: CardState; avatarMenu?: AvatarMenu; sessionMode?: SessionMode; journalLayout?: boolean;
  } = {}
): CardExample[] {
  const examples = defaultExamplesFor(kind);
  if (state === 'session') {
    if (sessionMode === 'shared-link') return sharedLinkExamples(examples);
    return examples.map(({ item, previewLabel }) => ({
      ...streamExample(item, sessionMode), previewLabel,
    }));
  }
  if (state === 'none') return examples.map(example => artworkOnlyExample(example, avatarMenu));
  if (state === 'activity') {
    return journalLayout ? examples.flatMap(journalExamples)
      : examples.map(example => ({ ...example, match: undefined, item: activityMetadata(example.item) }));
  }
  if (state === 'request') {
    return requestStates.map((status, index) => requestExample(examples[index % examples.length], status));
  }
  if (kind === 'episode') {
    return examples.map(example => {
      const { item } = example;
      return 'progress' in item ? {
        ...example, watchedAction: true, body: item.overview ?? undefined, date: item.releaseDate ?? undefined,
      } : example;
    });
  }
  return examples;
}
