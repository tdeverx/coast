import {actionFromCategory} from '#lib/actions.js';
import { mediumOptions, categoryEnabled } from '#lib/experimental.js';
import {activityAudienceOptions,activityTypeOptions,workFriendOptions,type WorkFriendFilter,type ActivityFilters} from '#lib/social/model.js';
import {page} from '$app/state';
import {goto} from '$app/navigation';
import {useShelfLocation} from '#lib/ui/detail-section.svelte.js';
import {mediaTypeOptions} from '#lib/ui/filter-options.js';
import { onDestroy, untrack } from 'svelte';
import { useClient } from '#lib/ui/client-context.js';
import { createResource, uniqueItems } from '#lib/ui/resource.svelte.js';
import { contentRevisionKey } from '#lib/ui/content-revision.svelte.js';
import type { ShelfSource, ShelfItem, ShelfControl } from './types';
type Feed = { scope?:string; emptyAllMedia?:boolean; items: ShelfItem[]; hasMore: boolean; next: { before: string; beforeId: string; beforeKnown?:string;beforeRelationship?:string } | null };
export type SocialShelfOptions = Partial<ActivityFilters> & { type: 'social'; layout?: 'row' | 'grid'; initial?: Feed; category?: string; title?:string; mediums?:boolean; surface?:'activity'|'popular';workId?:string;artistId?:string;readingGroupId?:string;href?:string;relationship?:WorkFriendFilter;relationshipKind?:string };
export function createSocialSource(get: () => SocialShelfOptions): ShelfSource {
  const { api, preview } = useClient(),location=useShelfLocation();

 let category=$state(untrack(()=>get().category??(get().mediums?'screen':'all')));
 let relationship=$state(untrack(()=>get().relationship??'all'));
 let audience=$state(untrack(()=>get().audience??'all')),mediaKind=$state(untrack(()=>get().mediaKind??'all')),period=$state(untrack(()=>get().period??'all')),activityType=$state(untrack(()=>get().activityType??'all'));
 const filtersEnabled=$derived(get().audience!==undefined&&get().surface!=='popular');
 const targetKey=()=>JSON.stringify([page.data.user?.id,page.data.capabilities,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics,category,get().surface,get().workId,get().artistId,get().readingGroupId,get().relationship!==undefined?relationship:undefined,audience,mediaKind,period,activityType]);
 const initial = untrack(() => get().initial);
 const resource = createResource<Feed>(initial ? {...initial,scope:untrack(targetKey)} : { items: [], hasMore: false, next: null }, !!initial);
 async function load(_page = 1, append = false) {
  if(page.data.capabilities?.social===false){resource.replace({items:[],hasMore:false,next:null});return;}
  if(category!=='all'&&!categoryEnabled({...page.data,features:page.data.capabilities},category)){
    if(get().category){resource.replace({items:[],hasMore:false,next:null});return;}
    const next=mediumOptions({...page.data,features:page.data.capabilities})[0]?.value;
    if(!next){resource.replace({items:[],hasMore:false,next:null});return;}
    category=next;
  }
  if (append && resource.busy) return;
  if(resource.data.scope!==targetKey())append=false;
  const requestedWork=targetKey(),scoped=!!(get().workId||get().artistId||get().readingGroupId);
  const query = new URLSearchParams({ category,...(filtersEnabled?{audience,mediaKind,period,activityType}:{}), ...(get().relationship!==undefined?{relationship}:{}),...(get().workId?{workId:get().workId!}:{}),...(get().artistId?{artistId:get().artistId!}:{}),...(get().readingGroupId?{readingGroupId:get().readingGroupId!}:{}), ...(append && resource.data.next ? resource.data.next : {}) });
  await resource.load(async signal => {const result=await api<Feed>(`social/${get().surface==='popular'?'popular':'feed'}?${query}`, undefined, 'GET', { signal });signal.throwIfAborted();if(!append&&!result.items.length&&!scoped&&get().mediums&&category!=='all'&&get().layout!=='grid'){const any=await api<Feed>(`social/${get().surface==='popular'?'popular':'feed'}?category=all`,undefined,'GET',{signal});return {...result,scope:requestedWork,emptyAllMedia:!any.items.length};}return {...result,scope:requestedWork};}, {
   merge: (previous, result) => ({ ...result, items: uniqueItems(append ? [...previous.items, ...result.items] : result.items, item => item.entryId ?? item.id) }),
  });
 }
 const suppliedCategory=$derived(get().category??(get().mediums?'screen':'all'));
 const refreshKey=$derived(JSON.stringify([page.data.user?.id,contentRevisionKey(page.data,['social']),get().surface,get().workId,get().artistId,get().readingGroupId,get().relationship,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics,page.data.capabilities]));
 let previousRelationship=untrack(()=>get().relationship);
 let previousCategory=untrack(()=>suppliedCategory);
 let previousRefresh=untrack(()=>refreshKey);
 const suppliedFilters=()=>JSON.stringify([get().audience,get().mediaKind,get().period,get().activityType]);
 let previousFilters=untrack(suppliedFilters);
 $effect(() => {
  const nextCategory=suppliedCategory,key=refreshKey,requestedRelationship=get().relationship,filters=suppliedFilters();
  untrack(() => {
   const changed=key!==previousRefresh||nextCategory!==previousCategory||requestedRelationship!==previousRelationship||filters!==previousFilters;
   if(filters!==previousFilters){audience=get().audience??'all';mediaKind=get().mediaKind??'all';period=get().period??'all';activityType=get().activityType??'all';previousFilters=filters;}
   if(requestedRelationship!==previousRelationship)relationship=requestedRelationship??'all';
   previousRelationship=requestedRelationship;
   if(nextCategory!==previousCategory)category=nextCategory;
   previousCategory=nextCategory;previousRefresh=key;
   if(changed&&(resource.activated||resource.ready))void load();
  });
 });
 function selectFilters(patch:Partial<ActivityFilters>){
  if(Object.entries(patch).every(([key,value])=>({audience,mediaKind,period,activityType})[key as keyof ActivityFilters]===value))return;
  audience=patch.audience??audience;mediaKind=patch.mediaKind??mediaKind;period=patch.period??period;activityType=patch.activityType??activityType;
  if(get().layout==='grid'&&!location.embedded&&!preview){
   const url=new URL(location.url.href);for(const [key,value] of Object.entries({audience,mediaKind,period,activityType}))url.searchParams.set(key,value);
   for(const key of ['before','beforeId','beforeKnown','beforeRelationship','page'])url.searchParams.delete(key);
   resource.cancel();void goto(url,{replace:true,reset:false,state:page.state});return;
  }
  void load();
 }
 const typeOptions=$derived(mediaTypeOptions({...page.data,features:page.data.capabilities}).filter(option=>option.value==='all'||category==='all'||(category==='screen'?['movie','show'].includes(option.value):category==='reading'?['book','comic'].includes(option.value):category==='music'?['album','track'].includes(option.value):option.value==='game')));
 onDestroy(resource.dispose);
 return {
    get pagination() { return { kind: 'cursor' as const, hasMore: resource.data.hasMore }; }, get title(){return get().title??(get().surface==='popular'?'Popular with friends':'Activity');}, get href(){if(get().layout==='grid')return undefined;const href=get().href??(get().workId?`/media/${get().workId}?section=activity`:`/for-you?section=${get().surface==='popular'?'popular':'activity'}&view=${actionFromCategory(category)}`);if(get().relationship===undefined&&!filtersEnabled)return href;const url=new URL(href,page.url.href);if(get().relationship!==undefined)url.searchParams.set('relationship',relationship);if(filtersEnabled)for(const [key,value] of Object.entries({audience,mediaKind,period,activityType}))url.searchParams.set(key,value);return url.pathname+url.search;}, get shape(){return category==='music'?'square' as const:category==='reading'||category==='game'?'poster' as const:'fanart' as const;}, get artworkStyle(){return category==='reading'||category==='music'||category==='game'?'primary' as const:'thumb' as const;}, artworkPriority:'episode-season-show', get resetKey(){return `${category}:${targetKey()}`;}, get filters():ShelfControl[]{if(filtersEnabled)return [];return get().relationship!==undefined?[{type:'segments' as const,label:'Activity selection',value:relationship,options:workFriendOptions(get().relationshipKind),change:(value:string)=>{relationship=value as WorkFriendFilter;void load();}}]:get().mediums?[{type:'segments' as const,label:get().surface==='popular'?'Popular with friends medium':'Activity medium',value:category,options:mediumOptions({...page.data,features:page.data.capabilities}, ['screen','game','music','reading']),change:(value:string)=>{category=value;void load();}}]:[];}, get controls():ShelfControl[]{return !filtersEnabled?[]:[{type:'select',label:'Audience',value:audience,options:activityAudienceOptions,change:value=>selectFilters({audience:value as ActivityFilters['audience']})},...(typeOptions.length>2?[{type:'select' as const,label:category==='reading'?'Reading type':'Media type',value:mediaKind,options:typeOptions,change:(value:string)=>selectFilters({mediaKind:value as ActivityFilters['mediaKind']})}]:[]),{type:'select',label:'Activity type',value:activityType,options:activityTypeOptions(category),change:value=>selectFilters({activityType:value as ActivityFilters['activityType']})},{type:'select',label:'Time period',value:period,options:[{value:'all',label:'All time'},{value:'month',label:'Past month'},{value:'year',label:'Past year'}],change:value=>selectFilters({period:value as ActivityFilters['period']})}];},
  get emptyConfirmed(){return !filtersEnabled&&(!get().mediums || resource.data.emptyAllMedia===true);},
  get items() { if(resource.data.scope!==targetKey())return []; return resource.data.items; }, get ready() { return resource.ready; }, get busy() { return resource.busy; },
  get error() { return resource.error; }, get activated() { return resource.activated; },
  get empty(){return !resource.ready||resource.busy?'Loading activity…':get().surface==='popular'?'Visible activity from friends in the last 30 days appears here.':filtersEnabled?audience==='you'?'Your recent activity appears here.':'Activity shared by friends appears here.':'Your activity and shared activity from friends appear here.';}, load };
}
