import { untrack } from 'svelte';

/** Feed shelves coalesce revisions until they are near the viewport. Explicit
 * loads still run immediately and cover any pending refresh. */
export function createShelfRefresh(load: () => unknown, visible?: () => boolean) {
  let stale = $state(false);
  if (visible) $effect(() => {
    if (stale && visible()) untrack(load);
  });
  return {
    invalidate() {
      if (visible) stale = true;
      else void load();
    },
    clear() {
      stale = false;
    },
  };
}
