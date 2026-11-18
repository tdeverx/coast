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
import { createShelfRefresh } from './refresh.svelte.js';
type Feed = { scope?:string; emptyAllMedia?:boolean; items: ShelfItem[]; hasMore: boolean; next: { before: string; beforeId: string; beforeKnown?:string;beforeRelationship?:string } | null };
export type SocialShelfOptions = Partial<ActivityFilters> & { type: 'social'; layout?: 'row' | 'grid'; initial?: Feed; category?: string; title?:string; mediums?:boolean; surface?:'activity'|'popular';workId?:string;artistId?:string;readingGroupId?:string;href?:string;relationship?:WorkFriendFilter;relationshipKind?:string };
export function createSocialSource(get: () => SocialShelfOptions, refreshVisible?: () => boolean): ShelfSource {
  const { api, preview } = useClient(),location=useShelfLocation();

 let category=$state(untrack(()=>get().category??(get().mediums?'screen':'all')));
 let relationship=$state(untrack(()=>get().relationship??'all'));
 let audience=$state(untrack(()=>get().audience??'all')),mediaKind=$state(untrack(()=>get().mediaKind??'all')),period=$state(untrack(()=>get().period??'all')),activityType=$state(untrack(()=>get().activityType??'all'));
 const filtersEnabled=$derived(get().audience!==undefined&&get().surface!=='popular');
 function resetFilters(){return selectFilters({audience:'all',mediaKind:'all',period:'all',activityType:'all'});}
 const targetKey=()=>JSON.stringify([page.data.user?.id,page.data.capabilities,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics,category,get().surface,get().workId,get().artistId,get().readingGroupId,get().relationship!==undefined?relationship:undefined,audience,mediaKind,period,activityType]);
 const initial = untrack(() => get().initial);
 const resource = createResource<Feed>(initial ? {...initial,scope:untrack(targetKey)} : { items: [], hasMore: false, next: null }, !!initial);
 const refresh = createShelfRefresh(() => load(), refreshVisible);
 async function load(_page = 1, append = false) {
  if (append && resource.busy) return;
  refresh.clear();
  if(page.data.capabilities?.social===false){resource.replace({items:[],hasMore:false,next:null});return;}
  if(category!=='all'&&!categoryEnabled(mediaConfig,category)){
    if(get().category&&!get().mediums){resource.replace({items:[],hasMore:false,next:null});return;}
    const next=mediumOptionsForViewer[0]?.value;
    if(!next){resource.replace({items:[],hasMore:false,next:null});return;}
    category=next;
    if(filtersEnabled)({mediaKind,activityType}=compatibleFilters(next));
  }
  if(resource.data.scope!==targetKey())append=false;
  const requestedWork=targetKey(),scoped=!!(get().workId||get().artistId||get().readingGroupId);
  const query = new URLSearchParams({ category,...(filtersEnabled?{audience,mediaKind,period,activityType}:{}), ...(get().relationship!==undefined?{relationship}:{}),...(get().workId?{workId:get().workId!}:{}),...(get().artistId?{artistId:get().artistId!}:{}),...(get().readingGroupId?{readingGroupId:get().readingGroupId!}:{}), ...(append && resource.data.next ? resource.data.next : {}) });
  await resource.load(async signal => {const result=await api<Feed>(`social/${get().surface==='popular'?'popular':'feed'}?${query}`, undefined, 'GET', { signal });signal.throwIfAborted();if(!append&&!result.items.length&&!scoped&&!filtersEnabled&&get().mediums&&category!=='all'&&get().layout!=='grid'){const any=await api<Feed>(`social/${get().surface==='popular'?'popular':'feed'}?category=all`,undefined,'GET',{signal});return {...result,scope:requestedWork,emptyAllMedia:!any.items.length};}return {...result,scope:requestedWork};}, {
   merge: (previous, result) => ({ ...result, items: uniqueItems(append ? [...previous.items, ...result.items] : result.items, item => item.entryId ?? item.id) }),
  });
 }
 const suppliedCategory=$derived(get().category??(get().mediums?'screen':'all'));
 const scopeKey=$derived(JSON.stringify([page.data.user?.id,get().surface,get().workId,get().artistId,get().readingGroupId,get().relationship,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics,page.data.capabilities]));
 const refreshKey=$derived(contentRevisionKey(page.data,['social']));
 let previousRelationship=untrack(()=>get().relationship);
 let previousCategory=untrack(()=>suppliedCategory);
 let previousRefresh=untrack(()=>refreshKey);
 let previousScope=untrack(()=>scopeKey);
 const suppliedFilters=()=>JSON.stringify([get().audience,get().mediaKind,get().period,get().activityType]);
 let previousFilters=untrack(suppliedFilters);
 $effect(() => {
  const nextCategory=suppliedCategory,key=refreshKey,scope=scopeKey,requestedRelationship=get().relationship,filters=suppliedFilters();
  untrack(() => {
   const scopeChanged=scope!==previousScope||nextCategory!==previousCategory||requestedRelationship!==previousRelationship||filters!==previousFilters;
   if(filters!==previousFilters){audience=get().audience??'all';mediaKind=get().mediaKind??'all';period=get().period??'all';activityType=get().activityType??'all';previousFilters=filters;}
   if(requestedRelationship!==previousRelationship)relationship=requestedRelationship??'all';
   previousRelationship=requestedRelationship;
   if(nextCategory!==previousCategory)category=nextCategory;
   previousCategory=nextCategory;
   if((scopeChanged||key!==previousRefresh)&&(resource.activated||resource.ready)){
    if(scopeChanged&&refreshVisible)resource.replace({items:[],hasMore:false,next:null});
    refresh.invalidate();
   }
   previousScope=scope;previousRefresh=key;
  });
 });
 function selectFilters(patch:Partial<ActivityFilters>,nextCategory=category){
  const mediumChanged=nextCategory!==category;
  if(!mediumChanged&&Object.entries(patch).every(([key,value])=>({audience,mediaKind,period,activityType})[key as keyof ActivityFilters]===value))return;
  category=nextCategory;
  audience=patch.audience??audience;mediaKind=patch.mediaKind??mediaKind;period=patch.period??period;activityType=patch.activityType??activityType;
  if(get().layout==='grid'&&!location.embedded&&!preview){
   const url=new URL(location.url.href);for(const [key,value] of Object.entries({audience,mediaKind,period,activityType}))url.searchParams.set(key,value);
   if(mediumChanged){url.searchParams.set('view',actionFromCategory(category));url.searchParams.delete('category');}
   for(const key of ['before','beforeId','beforeKnown','beforeRelationship','page'])url.searchParams.delete(key);
   resource.cancel();return goto(url,{replace:true,reset:false,state:page.state});
  }
  return load();
 }
 const mediaConfig=$derived({...page.data,features:page.data.capabilities});
 const mediumOptionsForViewer=$derived(mediumOptions(mediaConfig));
 function mediaOptions(medium:string){
  return mediaTypeOptions(mediaConfig).filter(option=>option.value==='all'||medium==='all'||(medium==='screen'?['movie','show'].includes(option.value):medium==='reading'?['book','comic'].includes(option.value):medium==='music'?['album','track'].includes(option.value):option.value==='game'));
 }
 const typeOptions=$derived(mediaOptions(category));
 function compatibleFilters(medium:string):Pick<ActivityFilters,'mediaKind'|'activityType'>{
  return {
   mediaKind:mediaOptions(medium).some(option=>option.value===mediaKind)?mediaKind:'all',
   activityType:activityTypeOptions(medium).some(option=>option.value===activityType)?activityType:'all',
  };
 }
 function selectMedium(value:string){
  if(value===category||!mediumOptionsForViewer.some(option=>option.value===value))return;
  if(!filtersEnabled){category=value;void load();return;}
  void selectFilters(compatibleFilters(value),value);
 }
 onDestroy(resource.dispose);
 return {
    get pagination() { return { kind: 'cursor' as const, hasMore: resource.data.hasMore }; }, get title(){return get().title??(get().surface==='popular'?'Popular with friends':'Activity');}, get href(){if(get().layout==='grid')return undefined;const href=get().href??(get().workId?`/media/${get().workId}?section=activity`:`/for-you?section=${get().surface==='popular'?'popular':'activity'}&view=${actionFromCategory(category)}`);if(get().relationship===undefined&&!filtersEnabled)return href;const url=new URL(href,page.url.href);if(get().relationship!==undefined)url.searchParams.set('relationship',relationship);if(filtersEnabled)for(const [key,value] of Object.entries({audience,mediaKind,period,activityType}))url.searchParams.set(key,value);return url.pathname+url.search;}, get shape(){return category==='music'?'square' as const:category==='reading'||category==='game'?'poster' as const:'fanart' as const;}, get artworkStyle(){return category==='reading'||category==='music'||category==='game'?'primary' as const:'thumb' as const;}, artworkPriority:'episode-season-show', get resetKey(){return `${category}:${targetKey()}`;},
  get filters():ShelfControl[]{
   if(!filtersEnabled&&get().relationship!==undefined)return [{type:'segments',label:'Activity selection',value:relationship,options:workFriendOptions(get().relationshipKind),change:value=>{relationship=value as WorkFriendFilter;void load();}}];
   if(!get().mediums||!mediumOptionsForViewer.length)return [];
   return [{type:'segments',label:get().surface==='popular'?'Popular with friends medium':'Activity medium',value:category,options:mediumOptionsForViewer,change:selectMedium}];
  },
  get controls():ShelfControl[]{return !filtersEnabled?[]:[{type:'select',section:'activity',label:'Audience',value:audience,options:activityAudienceOptions,change:value=>selectFilters({audience:value as ActivityFilters['audience']})},...(typeOptions.length>2?[{type:'select' as const,label:category==='reading'?'Reading type':'Media type',value:mediaKind,options:typeOptions,change:(value:string)=>selectFilters({mediaKind:value as ActivityFilters['mediaKind']})}]:[]),{type:'select',section:'activity',label:'Activity type',value:activityType,options:activityTypeOptions(category),change:value=>selectFilters({activityType:value as ActivityFilters['activityType']})},{type:'select',section:'activity',label:'Time period',value:period,options:[{value:'all',label:'All time'},{value:'month',label:'Past month'},{value:'year',label:'Past year'}],change:value=>selectFilters({period:value as ActivityFilters['period']})}];},
  get filterReset(){return filtersEnabled?{disabled:audience==='all'&&mediaKind==='all'&&period==='all'&&activityType==='all',run:resetFilters}:undefined;},
  get emptyConfirmed(){return !filtersEnabled&&(!get().mediums || resource.data.emptyAllMedia===true);},
  get items() { if(resource.data.scope!==targetKey())return []; return resource.data.items; }, get ready() { return resource.ready; }, get busy() { return resource.busy; },
  get error() { return resource.error; }, get activated() { return resource.activated; },
  get empty(){
   if(!resource.ready||resource.busy)return 'Loading activity…';
   if(get().surface==='popular')return 'Visible activity from friends in the last 30 days appears here.';
   if(filtersEnabled&&audience==='you')return 'Your recent activity appears here.';
   if(filtersEnabled&&audience==='friends')return 'Activity shared by friends appears here.';
   return 'Your activity and shared activity from friends appear here.';
  }, load };
}
