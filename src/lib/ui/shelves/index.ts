import {createProgressExperimentSource,type ProgressExperimentSourceOptions} from './progress-experiment.svelte';
import {createLibraryFeedSource,type LibraryFeedOptions} from './library-feed.svelte';
import {createRecommendationSource,type RecommendationOptions} from './for-you.svelte';
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
  | RecommendationOptions
  | DiscoveryOptions
  | SocialShelfOptions
  | ({type:'journal'} & JournalOptions)
  | ({ type: 'search' } & SearchOptions)
  | ({ type: 'progress' } & ProgressSourceOptions)
  | ({ type: 'list' } & ListSourceOptions)
  | ({ type: 'credits' } & CreditsOptions)
  | ({ type: 'library' } & LibrarySourceOptions);
export function createShelfSource(get: () => ShelfConfig, refreshVisible?: () => boolean) {
  // The source type is fixed for a mounted shelf; changing features mounts a new shelf.
  switch (get().type) {
    case 'library-feed':return createLibraryFeedSource(()=>get() as LibraryFeedOptions);
    case 'progress-experiment':return createProgressExperimentSource(()=>get() as ProgressExperimentSourceOptions);
    case 'detail':return createDetailSource(()=>get() as DetailSourceOptions);
    case 'recommendation':return createRecommendationSource(()=>get() as RecommendationOptions, refreshVisible);
    case 'discovery':return createDiscoverySource(()=>get() as DiscoveryOptions, refreshVisible);
    case 'social':return createSocialSource(()=>get() as SocialShelfOptions, refreshVisible);
    case 'journal': return createJournalSource(() => get() as Extract<ShelfConfig,{type:'journal'}>);
    case 'search': return createSearchSource(() => get() as Extract<ShelfConfig, { type: 'search' }>);
    case 'progress': return createProgressSource(() => get() as Extract<ShelfConfig, { type: 'progress' }>);
    case 'list': return createListSource(() => get() as Extract<ShelfConfig, { type: 'list' }>);
    case 'credits': return createCreditsSource(() => get() as Extract<ShelfConfig, { type: 'credits' }>);
    case 'library': return createLibrarySource(() => get() as Extract<ShelfConfig, { type: 'library' }>);
  }
}
