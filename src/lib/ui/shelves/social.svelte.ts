import {page} from '$app/state';
import { onDestroy, untrack } from 'svelte';
import { useClient } from '$lib/ui/client-context';
import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
import type { ShelfSource, ShelfItem } from './types';
type Feed = { emptyAllMedia?:boolean; items: ShelfItem[]; hasMore: boolean; next: { before: string; beforeId: string; beforeKnown?:string } | null };
export type SocialShelfOptions = { type: 'social'; layout?: 'row' | 'grid'; initial?: Feed; category?: string; mediums?:boolean; surface?:'activity'|'popular' };
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
 $effect(() => { get().category; untrack(() => { category=get().category??(get().mediums?'screen':'all'); if (resource.activated) void load(); }); });
 onDestroy(resource.cancel);
 return {
    get pagination() { return get().layout==='grid' ? { kind: 'cursor' as const, hasMore: resource.data.hasMore } : {kind:'local' as const}; }, get title(){return get().surface==='popular'?'Popular with friends':'Activity';}, get href(){return get().surface==='popular'?undefined:`/for-you?section=activity&category=${category}`;}, shape: 'fanart', artworkStyle:'thumb', artworkPriority:'episode-season-show', get resetKey(){return category;}, get filters(){return get().mediums?[{type:'segments' as const,label:get().surface==='popular'?'Popular with friends medium':'Activity medium',value:category,options:[{value:'screen',label:'Watching'},...(page.data.experimentalFeatures?[{value:'game',label:'Playing'},{value:'music',label:'Listening'}]:[])],change:(value:string)=>{category=value;void load();}}]:[];}, controls: [],
  get emptyConfirmed(){return !get().mediums || resource.data.emptyAllMedia===true;},
  get items() { if(loadedCategory!==category)return []; return get().layout==='grid'?resource.data.items:resource.data.items.slice(0,20); }, get ready() { return resource.ready; }, get busy() { return resource.busy; },
  get error() { return resource.error; }, get activated() { return resource.activated; },
  get empty(){return !resource.ready||loadedCategory!==category?'Loading activity…':get().surface==='popular'?'Visible activity from friends in the last 30 days appears here.':'Your activity and shared activity from friends appear here.';}, load };
}
