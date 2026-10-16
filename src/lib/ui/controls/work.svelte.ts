import { onDestroy, untrack } from 'svelte';
import { page } from '$app/state';
import { useClient } from '../client-context';
import { contentRevisionKey } from '../content-revision.svelte';
import { createMenuResource } from './menu-resource.svelte';
import { setRelationship, type Relationship } from '../relationships';
import type { WorkActionState } from '$lib/media/work-actions';

/** Only meaningful scope changes invalidate menu data; session heartbeat replacement does not. */
export function workMenuScope(target: unknown) {
  return JSON.stringify([target, contentRevisionKey(page.data, ['tracking']),
    page.data.user?.role, page.data.user?.settings, page.data.experimentalMusic,
    page.data.experimentalGaming, page.data.experimentalBooks, page.data.experimentalComics,
    page.data.experimentalParties, page.data.experiments, page.data.playbackSharing, page.data.capabilities]);
}
const empty = (): WorkActionState => ({ reasons: [], rating: null, queued: false, game: null, reading: null });
/** Shared personal state is local; provider resolution and dialogs belong to their domains. */
export function createWorkActions(getId: () => string | undefined, context: () => unknown = () => null, playthrough: () => string | undefined = () => undefined, mutating: () => boolean = () => false) {
  const { api, change } = useClient();
  const resource = createMenuResource(empty, () => workMenuScope([getId(), context(), playthrough()]), async signal => {
    const id = getId();
    return id ? api<WorkActionState>(`collection/${id}${playthrough() ? `?playthrough=${playthrough()}` : ''}`, undefined, 'GET', { signal }) : empty();
  });
  const direct = $derived(new Set(resource.data.reasons.filter(reason => reason.origin === 'direct').map(reason => reason.relationship)));
  $effect(() => {
    const scope = workMenuScope([getId(), context(), playthrough()]);
    untrack(() => {
      scope;
      resource.sync();
      if (resource.active && !mutating()) void resource.load();
    });
  });
  onDestroy(resource.dispose);
  return {
    load: resource.load, open: resource.open, close: resource.close, refresh: resource.refresh,
    get active() { return resource.active; },
    get data() { return resource.data; },
    get busy() { return resource.busy; },
    get error() { return resource.error; },
    get relationships() { return { collected: direct.has('collected'), watchlist: direct.has('watchlist'), favourite: direct.has('favourite') }; },
    set(kind: Relationship, value: boolean) {
      const id = getId();
      return id ? setRelationship(id, kind, value, change) : Promise.resolve(false);
    },
    rate(value: number | null) { resource.patch(data => ({ ...data, rating: value })); },
  };
}
