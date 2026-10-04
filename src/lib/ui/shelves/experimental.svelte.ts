import type {GenreReason} from '$lib/experiments/row-ranking';
import {genreRowTitle,recommendationRowTitle,type DynamicKind} from '$lib/experiments/row-titles';
import { mediumOptions } from '$lib/experimental';
import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import { onDestroy, untrack } from 'svelte';
import { useClient } from '$lib/ui/client-context';
import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
import { contentRevisionKey } from '$lib/ui/content-revision.svelte';
import type { ShelfSource, ShelfItem, ShelfControl } from './types';
export type ExperimentalOptions = {type:'experimental';feature:'row'|'recommendations'|'upcoming';category?:'screen'|'game'|'music';genre?:string;kind?:DynamicKind;reason?:GenreReason;workId?:string;title?:string;seed?:string;layout?:'row'|'grid'};
export function createExperimentalSource(get:()=>ExperimentalOptions):ShelfSource {
 const {api}=useClient();
 const orderSeed=untrack(()=>get().seed??page.url.searchParams.get('seed')??Math.random().toString(36).slice(2));
 let category=$state(get().category??(get().layout==='grid'?page.url.searchParams.get('category')??'screen':'screen'));
 let available=$state(get().feature!=='upcoming'&&get().layout==='grid'&&page.url.searchParams.get('available')==='true');
 const resource=createResource({items:[] as ShelfItem[],total:0,page:1,pages:1,title:undefined as string|undefined},false);
 async function load(number?:number,append=false) {
  number??=get().layout==='grid'?Number(page.url.searchParams.get('page')??1):1;
  if(append)number=resource.data.page+1;
  if(get().layout==='grid'){const url=new URL(page.url);url.searchParams.set('category',category);if(get().feature==='upcoming')url.searchParams.delete('available');else url.searchParams.set('available',String(available));url.searchParams.set('page',String(number));replaceState(url,page.state);}
  const params=new URLSearchParams({category,available:String(available),page:String(number)});
  if(get().feature==='upcoming')params.set('view','releases');
  if(get().genre)params.set('genre',get().genre!);
  if(get().workId)params.set('work',get().workId!);
  if(get().kind)params.set('kind',get().kind!);
  if(get().reason)params.set('reason',get().reason!);
  if(get().feature!=='upcoming')params.set('seed',orderSeed);
  const result=await resource.load(signal=>api<typeof resource.data>(`${get().feature==='upcoming'?'planning':'experiments/'+get().feature}?${params}`,undefined,'GET',{signal}),{
   merge:append?(old,next)=>({...next,items:uniqueItems([...old.items,...next.items],item=>'workId' in item?item.workId??item.id:item.id)}):undefined
  });
  if(result&&get().layout==='grid'){const url=new URL(page.url);url.searchParams.set('page',String(result.page));replaceState(url,page.state);}
  return result;
 }
 const refreshKey=$derived(JSON.stringify([
  contentRevisionKey(page.data,get().feature==='upcoming'?['tracking','planning']:['tracking','social']),
  page.data.experimentalMusic,page.data.experimentalGaming,
  get().feature==='upcoming'&&page.data.experiments.planning,
  get().feature,get().genre,get().kind,get().reason,get().workId,get().category,
 ]));
 $effect(()=>{refreshKey;untrack(()=>{if(resource.activated)void load();});});
 onDestroy(resource.cancel);
 const selectMedium=(value:string)=>{category=value;void load(1);};
 return {
  get title(){return get().title??resource.data.title??(get().feature==='upcoming'?'Upcoming':get().feature==='row'&&get().genre?genreRowTitle(category as 'screen'|'game'|'music',get().genre!,get().kind,get().reason,orderSeed):recommendationRowTitle(category as 'screen'|'game'|'music',orderSeed));},
  get href(){
   if(get().layout==='grid')return undefined;
   const params=new URLSearchParams({section:get().feature==='row'?'dynamic':get().feature,category});
   if(get().genre)params.set('genre',get().genre!);
   if(get().workId)params.set('work',get().workId!);
   if(get().kind)params.set('kind',get().kind!);
  if(get().reason)params.set('reason',get().reason!);
   if(get().feature!=='upcoming')params.set('seed',orderSeed);
   if(get().feature!=='upcoming')params.set('available',String(available));
   return `/for-you?${params}`;
  },
  get notice(){return undefined;},
  get items(){return resource.data.items;},get busy(){return resource.busy;},get ready(){return resource.ready;},get error(){return resource.error;},get activated(){return resource.activated;},get emptyConfirmed(){return resource.ready&&!resource.data.items.length;},
  get resetKey(){return `${category}:${get().kind??'all'}:${available}`;},
  get mediaKind(){return category==='all'?'screen':category as 'screen'|'game'|'music';},
  get shape(){return category==='music'?'square' as const:'fanart' as const;},get artworkStyle(){return 'thumb' as const;},
  get pagination(){return {kind:'pages' as const,page:resource.data.page,pages:resource.data.pages,append:get().layout!=='grid',controls:(get().layout==='grid'?'both':'header') as 'both'|'header'};},
  get controls(){return [];},
  get filters():ShelfControl[]{return [
   ...(get().feature==='row'||get().feature==='recommendations'&&get().category!==undefined&&get().layout!=='grid'?[]:[{type:'segments' as const,label:`${get().feature} medium`,value:category,options:mediumOptions(page.data),change:selectMedium}]),
   ...(get().feature!=='upcoming'?[{type:'availability' as const,label:'Available',value:available?'available':'all',change:(value:string)=>{available=value==='available';void load(1);}}]:[])
  ];},load
 };
}
