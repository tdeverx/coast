import { mediumOptions } from '$lib/experimental';
import {page} from '$app/state';
import { onDestroy, untrack } from 'svelte';
import { useClient } from '$lib/ui/client-context';
import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
import { contentRevisionKey } from '$lib/ui/content-revision.svelte';
import type { ShelfSource, ShelfItem } from './types';
type Feed = { emptyAllMedia?:boolean; items: ShelfItem[]; hasMore: boolean; next: { before: string; beforeId: string; beforeKnown?:string } | null };
export type SocialShelfOptions = { type: 'social'; layout?: 'row' | 'grid'; initial?: Feed; category?: string; title?:string; mediums?:boolean; surface?:'activity'|'popular' };
export function createSocialSource(get: () => SocialShelfOptions): ShelfSource {
  const { api } = useClient();

 let category=$state(untrack(()=>get().category??(get().mediums?'screen':'all')));
 let loadedCategory=$state(untrack(()=>category));
 const initial = untrack(() => get().initial);
 const resource = createResource<Feed>(initial ?? { items: [], hasMore: false, next: null }, !!initial);
 async function load(_page = 1, append = false) {
  if (append && resource.busy) return;
  const requestedCategory=category;
  const query = new URLSearchParams({ category, ...(append && resource.data.next ? resource.data.next : {}) });
  await resource.load(async signal => {const result=await api<Feed>(`social/${get().surface==='popular'?'popular':'feed'}?${query}`, undefined, 'GET', { signal });if(!signal.aborted&&category===requestedCategory)loadedCategory=requestedCategory;if(!result.items.length&&get().mediums&&category!=='all'&&get().layout!=='grid'){const any=await api<Feed>(`social/${get().surface==='popular'?'popular':'feed'}?category=all`,undefined,'GET',{signal});return {...result,emptyAllMedia:!any.items.length};}return result;}, {
   merge: (previous, result) => ({ ...result, items: uniqueItems(append ? [...previous.items, ...result.items] : result.items, item => item.entryId ?? item.id) }),
  });
 }
 const suppliedCategory=$derived(get().category??(get().mediums?'screen':'all'));
 const refreshKey=$derived(JSON.stringify([contentRevisionKey(page.data,['social']),get().surface,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics]));
 let previousCategory=untrack(()=>suppliedCategory);
 let previousRefresh=untrack(()=>refreshKey);
 $effect(() => {
  const nextCategory=suppliedCategory,key=refreshKey;
  untrack(() => {
   const changed=key!==previousRefresh||nextCategory!==previousCategory;
   if(nextCategory!==previousCategory)category=nextCategory;
   previousCategory=nextCategory;previousRefresh=key;
   if(changed&&(resource.activated||resource.ready))void load();
  });
 });
 onDestroy(resource.cancel);
 return {
    get pagination() { return get().layout==='grid' ? { kind: 'cursor' as const, hasMore: resource.data.hasMore } : {kind:'local' as const}; }, get title(){return get().title??(get().surface==='popular'?'Popular with friends':'Activity');}, get href(){return get().layout==='grid'?undefined:`/for-you?section=${get().surface==='popular'?'popular':'activity'}&category=${category}`;}, get shape(){return category==='reading'?'poster' as const:'fanart' as const;}, get artworkStyle(){return category==='reading'?'primary' as const:'thumb' as const;}, artworkPriority:'episode-season-show', get resetKey(){return category;}, get filters(){return get().mediums?[{type:'segments' as const,label:get().surface==='popular'?'Popular with friends medium':'Activity medium',value:category,options:mediumOptions(page.data, ['screen','game','music','reading']),change:(value:string)=>{category=value;void load();}}]:[];}, controls: [],
  get emptyConfirmed(){return !get().mediums || resource.data.emptyAllMedia===true;},
  get items() { if(loadedCategory!==category)return []; return get().layout==='grid'?resource.data.items:resource.data.items.slice(0,20); }, get ready() { return resource.ready; }, get busy() { return resource.busy; },
  get error() { return resource.error; }, get activated() { return resource.activated; },
  get empty(){return !resource.ready||loadedCategory!==category?'Loading activity…':get().surface==='popular'?'Visible activity from friends in the last 30 days appears here.':'Your activity and shared activity from friends appear here.';}, load };
}
