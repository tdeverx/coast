import { onDestroy } from 'svelte';
import { useClient } from './client-context';
import { createResource, uniqueItems } from './resource.svelte';
type Friend = { userId: string; username: string; state: string };
export function createFriendsResource() {
 const { api } = useClient();
 const resource = createResource({ items: [] as Friend[], more: false, page: 0 });
 async function load(reset = false) {
  if (!reset && resource.busy) return;
  const page = reset ? 1 : resource.data.page + 1;
  await resource.load(async signal => {
   const rows = await api<Friend[]>(`social/friends?page=${page}`, undefined, 'GET', { signal });
   return { items: rows.slice(0, 60).filter(friend => friend.state === 'accepted'), more: rows.length > 60, page };
  }, { merge: (previous, next) => ({ ...next, items: uniqueItems(reset ? next.items : [...previous.items, ...next.items], item => item.userId) }) });
 }
 onDestroy(resource.cancel);
 return { get items() { return resource.data.items; }, get more() { return resource.data.more; }, get busy() { return resource.busy; }, get error() { return resource.error; }, load };
}
