import { mediumOptions, categoryEnabled } from '$lib/experimental';
import {workFriendOptions,type WorkFriendFilter} from '$lib/social/model';
import {page} from '$app/state';
import { onDestroy, untrack } from 'svelte';
import { useClient } from '$lib/ui/client-context';
import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
import { contentRevisionKey } from '$lib/ui/content-revision.svelte';
import type { ShelfSource, ShelfItem } from './types';
type Feed = { emptyAllMedia?:boolean; items: ShelfItem[]; hasMore: boolean; next: { before: string; beforeId: string; beforeKnown?:string;beforeRelationship?:string } | null };
export type SocialShelfOptions = { type: 'social'; layout?: 'row' | 'grid'; initial?: Feed; category?: string; title?:string; mediums?:boolean; surface?:'activity'|'popular';workId?:string;artistId?:string;readingGroupId?:string;href?:string;relationship?:WorkFriendFilter;relationshipKind?:string };
export function createSocialSource(get: () => SocialShelfOptions): ShelfSource {
  const { api } = useClient();

 let category=$state(untrack(()=>get().category??(get().mediums?'screen':'all')));
 let loadedCategory=$state(untrack(()=>category));
 let relationship=$state(untrack(()=>get().relationship??'all'));
 const targetKey=()=>JSON.stringify([get().workId,get().artistId,get().readingGroupId,get().relationship!==undefined?relationship:undefined]);
 let loadedWork=$state(untrack(targetKey));
 const initial = untrack(() => get().initial);
 const resource = createResource<Feed>(initial ?? { items: [], hasMore: false, next: null }, !!initial);
 async function load(_page = 1, append = false) {
  if(page.data.capabilities?.social===false){resource.replace({items:[],hasMore:false,next:null});return;}
  if(category!=='all'&&!categoryEnabled({...page.data,features:page.data.capabilities},category)){
    const next=mediumOptions({...page.data,features:page.data.capabilities})[0]?.value;
    if(!next){resource.replace({items:[],hasMore:false,next:null});return;}
    category=next;
  }
  if (append && resource.busy) return;
  if(loadedWork!==targetKey())append=false;
  const requestedCategory=category,requestedWork=targetKey(),scoped=!!(get().workId||get().artistId||get().readingGroupId);
  const query = new URLSearchParams({ category, ...(get().relationship!==undefined?{relationship}:{}),...(get().workId?{workId:get().workId!}:{}),...(get().artistId?{artistId:get().artistId!}:{}),...(get().readingGroupId?{readingGroupId:get().readingGroupId!}:{}), ...(append && resource.data.next ? resource.data.next : {}) });
  await resource.load(async signal => {const result=await api<Feed>(`social/${get().surface==='popular'?'popular':'feed'}?${query}`, undefined, 'GET', { signal });if(!signal.aborted&&category===requestedCategory) {loadedCategory=requestedCategory;loadedWork=requestedWork;}if(!result.items.length&&!scoped&&get().mediums&&category!=='all'&&get().layout!=='grid'){const any=await api<Feed>(`social/${get().surface==='popular'?'popular':'feed'}?category=all`,undefined,'GET',{signal});return {...result,emptyAllMedia:!any.items.length};}return result;}, {
   merge: (previous, result) => ({ ...result, items: uniqueItems(append ? [...previous.items, ...result.items] : result.items, item => item.entryId ?? item.id) }),
  });
 }
 const suppliedCategory=$derived(get().category??(get().mediums?'screen':'all'));
 const refreshKey=$derived(JSON.stringify([contentRevisionKey(page.data,['social']),get().surface,get().workId,get().artistId,get().readingGroupId,get().relationship,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics,page.data.capabilities]));
 let previousRelationship=untrack(()=>get().relationship);
 let previousCategory=untrack(()=>suppliedCategory);
 let previousRefresh=untrack(()=>refreshKey);
 $effect(() => {
  const nextCategory=suppliedCategory,key=refreshKey,requestedRelationship=get().relationship;
  untrack(() => {
   const changed=key!==previousRefresh||nextCategory!==previousCategory||requestedRelationship!==previousRelationship;
   if(requestedRelationship!==previousRelationship)relationship=requestedRelationship??'all';
   previousRelationship=requestedRelationship;
   if(nextCategory!==previousCategory)category=nextCategory;
   previousCategory=nextCategory;previousRefresh=key;
   if(changed&&(resource.activated||resource.ready))void load();
  });
 });
 onDestroy(resource.dispose);
 return {
    get pagination() { return get().layout==='grid' ? { kind: 'cursor' as const, hasMore: resource.data.hasMore } : {kind:'local' as const}; }, get title(){return get().title??(get().surface==='popular'?'Popular with friends':'Activity');}, get href(){if(get().layout==='grid')return undefined;const href=get().href??(get().workId?`/media/${get().workId}?section=activity`:`/for-you?section=${get().surface==='popular'?'popular':'activity'}&category=${category}`);if(get().relationship===undefined)return href;const url=new URL(href,page.url);url.searchParams.set('relationship',relationship);return url.pathname+url.search;}, get shape(){return category==='reading'?'poster' as const:'fanart' as const;}, get artworkStyle(){return category==='reading'?'primary' as const:'thumb' as const;}, artworkPriority:'episode-season-show', get resetKey(){return `${category}:${targetKey()}`;}, get filters(){return get().relationship!==undefined?[{type:'segments' as const,label:'Activity selection',value:relationship,options:workFriendOptions(get().relationshipKind),change:(value:string)=>{relationship=value as WorkFriendFilter;void load();}}]:get().mediums?[{type:'segments' as const,label:get().surface==='popular'?'Popular with friends medium':'Activity medium',value:category,options:mediumOptions({...page.data,features:page.data.capabilities}, ['screen','game','music','reading']),change:(value:string)=>{category=value;void load();}}]:[];}, controls: [],
  get emptyConfirmed(){return !get().mediums || resource.data.emptyAllMedia===true;},
  get items() { if(loadedCategory!==category||loadedWork!==targetKey())return []; return get().layout==='grid'?resource.data.items:resource.data.items.slice(0,20); }, get ready() { return resource.ready; }, get busy() { return resource.busy; },
  get error() { return resource.error; }, get activated() { return resource.activated; },
  get empty(){return !resource.ready||loadedCategory!==category?'Loading activity…':get().surface==='popular'?'Visible activity from friends in the last 30 days appears here.':'Your activity and shared activity from friends appear here.';}, load };
}
