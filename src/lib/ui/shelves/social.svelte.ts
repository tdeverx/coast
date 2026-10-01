import {untrack} from 'svelte';
import {api} from '$lib/ui/client';
import type {ShelfSource,ShelfItem} from './types';
export type SocialShelfOptions={type:'social';layout?:'row'|'grid';initial?:{items:ShelfItem[];hasMore:boolean;next:{before:string;beforeId:string}|null};category?:string};
export function createSocialSource(get:()=>SocialShelfOptions):ShelfSource {
 const initial=untrack(()=>get().initial);
 let items=$state<ShelfItem[]>(initial?.items??[]),ready=$state(!!initial),busy=$state(false),error=$state(''),hasMore=$state(initial?.hasMore??false),cursor=$state(initial?.next??null),activated=$state(false);
 async function load(_page=1,append=false) {
  if(busy)return;activated=true;busy=true;error='';
  try{const query=new URLSearchParams({category:get().category??'all',...(append&&cursor?cursor:{})});const result=await api<NonNullable<SocialShelfOptions['initial']>>(`social/feed?${query}`,undefined,'GET');items=append?[...items,...result.items.filter(i=>!items.some(current=>current.entryId===i.entryId))]:result.items;cursor=result.next;hasMore=result.hasMore;ready=true;}
  catch(cause){error=cause instanceof Error?cause.message:'Activity could not be loaded.';}finally{busy=false;}
 }
 return {title:'Friends activity',href:'/friends?view=activity',shape:'fanart',filters:[],controls:[],get items(){return items;},get ready(){return ready;},get busy(){return busy;},get error(){return error;},get activated(){return activated;},get hasMore(){return hasMore;},empty:'Activity from friends appears here when they share it.',load};
}
