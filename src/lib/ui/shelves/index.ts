import { createJournalSource, type JournalOptions } from './journal.svelte';
import { createSearchSource, type SearchOptions } from './search.svelte';
import { createProgressSource, type ProgressSourceOptions } from './progress.svelte';
import { createListSource, type ListSourceOptions } from './list.svelte';
import { createCreditsSource, type CreditsOptions } from './credits.svelte';
import { createLibrarySource, type LibrarySourceOptions } from './library.svelte';
export type ShelfConfig =
  | ({type:'journal'} & JournalOptions)
  | ({ type: 'search' } & SearchOptions)
  | ({ type: 'progress' } & ProgressSourceOptions)
  | ({ type: 'list' } & ListSourceOptions)
  | ({ type: 'credits' } & CreditsOptions)
  | ({ type: 'library' } & LibrarySourceOptions);
export function createShelfSource(get: () => ShelfConfig) {
  // The source type is fixed for a mounted shelf; changing features mounts a new shelf.
  switch (get().type) {
    case 'journal': return createJournalSource(() => get() as Extract<ShelfConfig,{type:'journal'}>);
    case 'search': return createSearchSource(() => get() as Extract<ShelfConfig, { type: 'search' }>);
    case 'progress': return createProgressSource(() => get() as Extract<ShelfConfig, { type: 'progress' }>);
    case 'list': return createListSource(() => get() as Extract<ShelfConfig, { type: 'list' }>);
    case 'credits': return createCreditsSource(() => get() as Extract<ShelfConfig, { type: 'credits' }>);
    case 'library': return createLibrarySource(() => get() as Extract<ShelfConfig, { type: 'library' }>);
  }
}
