import type { MediaView, MediaCardPresentation } from '$lib/ui/types';
import { PAGE_SIZE } from '$lib/server/queries/pagination';

/** Explicit DTOs prevent a browser read model from leaking new internal fields. */
export function publicWork(item:MediaView|MediaCardPresentation,personal=false) {
  const work={id:('workId' in item?item.workId:undefined)??item.id,kind:item.kind,title:item.title,year:item.year??null};
  if(!personal)return work;
  return {...work,available:item.available??false,...('progress' in item?{
    positionSeconds:item.progress,durationSeconds:item.duration,watched:item.watched,
    playCount:item.playCount,collected:item.collected,watchlist:item.watchlist,
    favourite:item.favourite,dropped:item.dropped,rating:item.rating,
  }:{})};
}
export function publicPage(items:unknown[],input:{page:number;pages:number;total:number},url:URL) {
  const link=(page:number)=>{const next=new URL(url);next.searchParams.set('page',String(page));return next.pathname+next.search;};
  return {items,pagination:{...input,pageSize:PAGE_SIZE,next:input.page<input.pages?link(input.page+1):null,previous:input.page>1?link(input.page-1):null}};
}
