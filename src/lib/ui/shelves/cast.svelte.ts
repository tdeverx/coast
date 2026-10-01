import { page } from '$app/state';
import { untrack } from 'svelte';
import type { CastMember } from '$lib/providers/contracts';

type CastOptions = {
  people: CastMember[];
  crew?: CastMember[];
  busy?: boolean;
  href?: string;
  layout?: 'row' | 'grid';
};

/** Credit selection supplies items and controls to the shared Shelf. */
export function createCastSelection(getOptions: () => CastOptions) {
  const options = $derived(getOptions());
  let selection = $state(untrack(() =>
    options.layout === 'grid' && page.url.searchParams.get('credits') === 'crew' ? 'crew' : 'cast'
  ));
  const people = $derived(selection === 'cast' ? options.people : (options.crew ?? []));
  return {
    get selection() { return selection; },
    set selection(value: string) { selection = value; },
    get people() { return people; },
    get busy() { return selection === 'crew' && !!options.busy; },
    get href() { return options.href ? `${options.href}&credits=${selection}` : undefined; },
  };
}
