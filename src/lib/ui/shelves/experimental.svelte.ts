import { page } from '$app/state';
import { onDestroy, untrack } from 'svelte';
import { useClient } from '$lib/ui/client-context';
import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
import type { ShelfSource, ShelfItem, ShelfControl } from './types';
export type ExperimentalOptions = {type:'experimental';feature:'row'|'recommendations'|'upcoming';category?:'screen'|'game'|'music';genre?:string;title?:string;layout?:'row'|'grid'};
export function createExperimentalSource(get:()=>ExperimentalOptions):ShelfSource {
 const {api}=useClient();
 let category=$state(get().category??(get().layout==='grid'?page.url.searchParams.get('category')??'screen':'screen'));
 let available=$state(false);
 const resource=createResource({items:[] as ShelfItem[],total:0,page:1,pages:1},false);
 async function load(number=1,append=false) {
  if(append)number=resource.data.page+1;
  const params=new URLSearchParams({category,available:String(available),page:String(number)});
  if(get().feature==='upcoming')params.set('view','releases');
  if(get().genre)params.set('genre',get().genre!);
  return resource.load(signal=>api<typeof resource.data>(`${get().feature==='upcoming'?'planning':'experiments/'+get().feature}?${params}`,undefined,'GET',{signal}),{
   merge:append?(old,next)=>({...next,items:uniqueItems([...old.items,...next.items],item=>'workId' in item?item.workId??item.id:item.id)}):undefined
  });
 }
 $effect(()=>{page.data;untrack(()=>{if(resource.activated)void load();});});
 onDestroy(resource.cancel);
 const selectMedium=(value:string)=>{category=value;void load();};
 return {
  get title(){return get().title??(get().feature==='upcoming'?'Upcoming':'Suggested for you');},
  get href(){return get().feature==='upcoming'&&get().layout!=='grid'?`/for-you?section=upcoming&category=${category}`:undefined;},
  get notice(){return get().feature==='row'?undefined:'Experimental · first pass';},
  get items(){return resource.data.items;},get busy(){return resource.busy;},get ready(){return resource.ready;},get error(){return resource.error;},get activated(){return resource.activated;},get emptyConfirmed(){return get().feature==='row'?resource.ready&&!resource.data.items.length:false;},
  get resetKey(){return `${category}:${available}`;},
  get mediaKind(){return category==='all'?'screen':category as 'screen'|'game'|'music';},
  get shape(){return category==='music'?'square' as const:'fanart' as const;},get artworkStyle(){return 'thumb' as const;},
  get pagination(){return {kind:'pages' as const,page:resource.data.page,pages:resource.data.pages,append:get().layout!=='grid',controls:'header' as const};},
  get controls(){return [];},
  get filters():ShelfControl[]{return get().feature==='row'?[]:[
   {type:'segments',label:`${get().feature} medium`,value:category,options:[{value:'screen',label:'Watching'},...(page.data.experimentalFeatures?[{value:'game',label:'Playing'},{value:'music',label:'Listening'}]:[])],change:selectMedium},
   ...(get().feature==='recommendations'?[{type:'availability' as const,label:'Available',value:available?'available':'all',change:(value:string)=>{available=value==='available';void load();}}]:[])
  ];},load
 };
}
