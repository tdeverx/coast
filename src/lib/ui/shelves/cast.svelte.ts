import type { ReadonlyURL } from '$app/state';
import { page } from '$app/state';
import { untrack } from 'svelte';
import type { CastMember } from '#lib/providers/contracts.js';

type CastOptions = {
  people: CastMember[];
  crew?: CastMember[];
  busy?: boolean;
  href?: string;
  layout?: 'row' | 'grid';
  url?:ReadonlyURL;
};

/** Credit selection supplies items and controls to the shared Shelf. */
export function createCastSelection(getOptions: () => CastOptions) {
  const options = $derived(getOptions());
  let selection = $state(untrack(() =>
    options.layout === 'grid' && (options.url??page.url).searchParams.get('credits') === 'crew' ? 'crew' : 'cast'
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
