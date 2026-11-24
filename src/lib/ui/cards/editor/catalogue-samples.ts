import type { MediaCardPresentation, MediaView } from '#lib/ui/types.js';

export type CatalogueTitle = Pick<MediaView, 'id' | 'kind' | 'title' | 'year' | 'releaseDate' | 'runtimeMinutes'
  | 'genres' | 'overview' | 'certification' | 'showTitle' | 'showId' | 'seasonId'
  | 'seasonNumber' | 'episodeNumber' | 'totalEpisodes'> & {
  posterPath?: string;
  backdropPath?: string;
};

/** Public title metadata and TMDB artwork references selected from Coast's catalogue. */
export const catalogueTitles: readonly CatalogueTitle[] = [
  {
    id: 'card-preview-andor', kind: 'show', title: 'Andor', year: 2022, releaseDate: '2022-09-21', totalEpisodes: 24,
    genres: ['Sci-Fi & Fantasy', 'Action & Adventure', 'War & Politics'], certification: '12',
    posterPath: 'khZqmwHQicTYoS7Flreb9EddFZC', backdropPath: 'ajztm40qDPqMONaSJhQ2PaNe2Xd',
  },
  {
    id: 'card-preview-andor-s01', kind: 'season', title: 'Season 1', showTitle: 'Andor', showId: 'card-preview-andor',
    seasonNumber: 1, year: 2022, releaseDate: '2022-09-21', totalEpisodes: 12, posterPath: '59SVNwLfoMnZPPB6ukW6dlPxAdI',
  },
  {
    id: 'card-preview-andor-s01e01', kind: 'episode', title: 'Kassa', showTitle: 'Andor', showId: 'card-preview-andor',
    seasonId: 'card-preview-andor-s01', seasonNumber: 1, episodeNumber: 1, year: 2022,
    releaseDate: '2022-09-21', runtimeMinutes: 42, genres: ['Action', 'Adventure', 'Science Fiction'],
    overview: 'Cassian becomes a wanted man after his search for his sister takes him to Morlana One.',
    backdropPath: 'mOL38zvzT4Xu1gcFNwzhtQfQVsc',
  },
  {
    id: 'card-preview-lord-of-the-rings', kind: 'collection', title: 'The Lord of the Rings Collection',
    totalEpisodes: 3, posterPath: 'oENY593nKRVL2PnxXsMtlh8izb4', backdropPath: 'bccR2CGTWVVSZAG0yqmy3DIvhTX',
  },
];

const albumCover = 'https://cdn.albumoftheyear.org/album/6162-random-access-memories_023310.jpg';
const artistPortrait = 'https://is1-ssl.mzstatic.com/image/thumb/AMCArtistImages221/v4/29/9e/38/299e3866-673a-4d36-376f-9274a0e45793/ami-identity-7b9f369855a542ba1bc836cd2766ca01-2025-09-01T10-34-14.349Z_cropped.png/600x600bb.jpg';
const artistHref = '/music/work/card-preview-daft-punk';
const albumCredits = [{ name: 'Daft Punk', href: artistHref }];
const sagaCover = 'https://covers.openlibrary.org/b/isbn/9781607066019-L.jpg?default=false';
const sagaCredits = [{ name: 'Brian K. Vaughan' }, { name: 'Fiona Staples' }];

export const catalogueCards = {
  album: {
    id: 'card-preview-random-access-memories', kind: 'album', title: 'Random Access Memories', year: 2013,
    href: '/music/work/card-preview-random-access-memories', workId: 'card-preview-random-access-memories',
    poster: albumCover, captionCredits: albumCredits, captionSubtitle: 'Daft Punk', available: true,
  },
  track: {
    id: 'card-preview-get-lucky', kind: 'track', title: 'Get Lucky', year: 2013, durationLabel: '6:09',
    href: '/music/work/card-preview-get-lucky', workId: 'card-preview-get-lucky', available: true,
    poster: albumCover, captionCredits: [...albumCredits, { name: 'Pharrell Williams' }, { name: 'Nile Rodgers' }],
    captionSubtitle: 'Daft Punk, Pharrell Williams, Nile Rodgers', trackingProgress: { unit: 'seconds', value: 45, total: 369 },
  },
  artist: {
    id: 'card-preview-daft-punk', kind: 'artist', title: 'Daft Punk', href: artistHref,
    workId: 'card-preview-daft-punk', poster: artistPortrait, captionSubtitle: 'Electronic', available: true,
  },
  game: {
    id: 'card-preview-hades', kind: 'game', title: 'Hades', year: 2020, captionSubtitle: 'Supergiant Games',
    href: '/media/card-preview-hades', workId: 'card-preview-hades', available: true,
    poster: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/library_600x900.jpg',
    backdrop: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/library_hero.jpg',
  },
  book: {
    id: 'card-preview-the-hobbit', kind: 'book', title: 'The Hobbit', captionSubtitle: 'J.R.R. Tolkien',
    href: '/media/card-preview-the-hobbit', workId: 'card-preview-the-hobbit', available: true,
    poster: 'https://covers.openlibrary.org/b/isbn/9780547928227-L.jpg?default=false',
  },
  comic: {
    id: 'card-preview-saga-volume-one', kind: 'comic', title: 'Saga, Vol. 1', year: 2012,
    href: '/media/card-preview-saga-volume-one', workId: 'card-preview-saga-volume-one', available: true,
    poster: sagaCover, captionCredits: sagaCredits, captionSubtitle: 'Brian K. Vaughan, Fiona Staples',
  },
  person: {
    id: 'card-preview-diego-luna', kind: 'person', title: 'Diego Luna', href: '/media/card-preview-diego-luna',
    poster: 'https://lumiere-a.akamaihd.net/v1/images/andor-int-diego-luna-tall-b_6620f9fd.jpeg?region=336%2C0%2C864%2C864',
    captionSubtitle: 'Actor',
  },
  playlist: {
    id: 'card-preview-daft-punk-essentials', kind: 'collection', title: 'Daft Punk Essentials',
    href: '/lists?view=card-preview-daft-punk-essentials', captionSubtitle: 'Apple Music Electronic',
    poster: 'https://is1-ssl.mzstatic.com/image/thumb/Features115/v4/ed/f9/01/edf90194-32cf-fe39-1b7e-bb42d0c4dea5/mza_4894750657028739591.png/600x600bb.jpg',
  },
  comicSeries: {
    id: 'card-preview-saga', kind: 'collection', title: 'Saga', href: '/media/reading-collection/card-preview-saga',
    poster: sagaCover, captionCredits: sagaCredits, captionSubtitle: 'Brian K. Vaughan, Fiona Staples',
  },
} satisfies Record<string, MediaCardPresentation>;
