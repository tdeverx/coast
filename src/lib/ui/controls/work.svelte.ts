import { onDestroy } from 'svelte';
import { useClient } from '../client-context';
import { createResource } from '../resource.svelte';
import { setRelationship, type Relationship } from '../relationships';
export type WorkState = {
  reasons: { relationship: string; origin: string }[];
  rating: number | null; queued: boolean;
  lists: { id: string; name: string; playlist: boolean; entryId: string | null }[];
};
const empty = (): WorkState => ({ reasons: [], rating: null, queued: false, lists: [] });
/** Shared personal work state, with concrete tracking left to its medium. */
export function createWorkActions(getId: () => string | undefined) {
  const { api, change } = useClient();
  const resource = createResource<WorkState>(empty());
  const direct = $derived(new Set(resource.data.reasons.filter(reason => reason.origin === 'direct').map(reason => reason.relationship)));
  onDestroy(resource.cancel);
  return {
    get data() { return resource.data; },
    get error() { return resource.error; },
    get relationships() { return { collected: direct.has('collected'), watchlist: direct.has('watchlist'), favourite: direct.has('favourite') }; },
    reset() { resource.replace(empty()); },
    load(id = getId()) { return id ? resource.load(signal => api<WorkState>(`collection/${id}`, undefined, 'GET', { signal })) : Promise.resolve(undefined); },
    set(kind: Relationship, value: boolean) { const id = getId(); return id ? setRelationship(id, kind, value, change) : Promise.resolve(false); },
    rate(value: number | null) { resource.replace({ ...resource.data, rating: value }); },
  };
}
