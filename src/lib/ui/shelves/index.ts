import {createProgressExperimentSource,type ProgressExperimentSourceOptions} from './progress-experiment.svelte';
import {createLibraryFeedSource,type LibraryFeedOptions} from './library-feed.svelte';
import {createForYouSource,type ForYouOptions} from './for-you.svelte';
import {createDiscoverySource,type DiscoveryOptions} from './discovery.svelte';
import {createSocialSource,type SocialShelfOptions} from './social.svelte';
import { createJournalSource, type JournalOptions } from './journal.svelte';
import { createSearchSource, type SearchOptions } from './search.svelte';
import { createProgressSource, type ProgressSourceOptions } from './progress.svelte';
import { createListSource, type ListSourceOptions } from './list.svelte';
import { createCreditsSource, type CreditsOptions } from './credits.svelte';
import { createLibrarySource, type LibrarySourceOptions } from './library.svelte';
import {createDetailSource,type DetailSourceOptions} from './detail.svelte';
export type ShelfConfig =
  | LibraryFeedOptions
  | ProgressExperimentSourceOptions
  | DetailSourceOptions
  | ForYouOptions
  | DiscoveryOptions
  | SocialShelfOptions
  | ({type:'journal'} & JournalOptions)
  | ({ type: 'search' } & SearchOptions)
  | ({ type: 'progress' } & ProgressSourceOptions)
  | ({ type: 'list' } & ListSourceOptions)
  | ({ type: 'credits' } & CreditsOptions)
  | ({ type: 'library' } & LibrarySourceOptions);
export function createShelfSource(get: () => ShelfConfig) {
  // The source type is fixed for a mounted shelf; changing features mounts a new shelf.
  switch (get().type) {
    case 'library-feed':return createLibraryFeedSource(()=>get() as LibraryFeedOptions);
    case 'progress-experiment':return createProgressExperimentSource(()=>get() as ProgressExperimentSourceOptions);
    case 'detail':return createDetailSource(()=>get() as DetailSourceOptions);
    case 'for-you':return createForYouSource(()=>get() as ForYouOptions);
    case 'discovery':return createDiscoverySource(()=>get() as DiscoveryOptions);
    case 'social':return createSocialSource(()=>get() as SocialShelfOptions);
    case 'journal': return createJournalSource(() => get() as Extract<ShelfConfig,{type:'journal'}>);
    case 'search': return createSearchSource(() => get() as Extract<ShelfConfig, { type: 'search' }>);
    case 'progress': return createProgressSource(() => get() as Extract<ShelfConfig, { type: 'progress' }>);
    case 'list': return createListSource(() => get() as Extract<ShelfConfig, { type: 'list' }>);
    case 'credits': return createCreditsSource(() => get() as Extract<ShelfConfig, { type: 'credits' }>);
    case 'library': return createLibrarySource(() => get() as Extract<ShelfConfig, { type: 'library' }>);
  }
}
