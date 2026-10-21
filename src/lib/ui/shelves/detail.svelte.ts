import {onDestroy,untrack} from 'svelte';
import {page as route} from '$app/state';
import {useClient} from '#lib/ui/client-context.js';
import {createResource,uniqueItems} from '#lib/ui/resource.svelte.js';
import {contentRevisionKey} from '#lib/ui/content-revision.svelte.js';
import type {ShelfItem,ShelfSource} from './types';
import type {MediaCardShape} from '#lib/ui/types.js';
export type DetailSourceOptions={type:'detail';title:string;path:string;href?:string;layout?:'row'|'grid';shape?:MediaCardShape;mediaKind?:'music'|'reading';page?:number;anchor?:boolean;availability?:boolean;available?:boolean;items?:ShelfItem[]};
type Content={items:ShelfItem[];page:number;pages:number;total:number;title?:string;href?:string;focusId?:string};
/** Detail children use the same lazy activation, cancellation and ordered append as other shelves. */
export function createDetailSource(get:()=>DetailSourceOptions):ShelfSource{
 const {api}=useClient(),resource=createResource<Content>({items:[],page:1,pages:1,total:0});
 let available=$state(untrack(()=>!!get().available));
 const scope=$derived(JSON.stringify([route.data.user?.id,get().path,get().layout,get().page,get().anchor,available,contentRevisionKey(route.data,['tracking','social'])]));
 let firstPage=$state(1);
 const local=$derived(get().items!==undefined);
 let wasLocal=untrack(()=>local),dirty=$state(false);
 let previous=untrack(()=>scope);
 async function request(number:number|undefined,direction:'replace'|'append'|'prepend'){
  if(local)return;
  const url=new URL(get().path,'http://coast/');if(number!==undefined)url.searchParams.set('page',String(number));
  if(get().availability)url.searchParams.set('available',String(available));
  const result=await resource.load(signal=>api<Content>(url.pathname.slice(1)+url.search,undefined,'GET',{signal}),{
   merge:(old,next)=>direction==='prepend'?{...old,items:uniqueItems([...next.items,...old.items],item=>item.entryId??item.id)}:
    {...next,focusId:direction==='append'?old.focusId:next.focusId,items:direction==='append'?uniqueItems([...old.items,...next.items],item=>item.entryId??item.id):next.items},
  });
  if(result){dirty=false;firstPage=direction==='prepend'?number!:direction==='replace'?result.page:firstPage;}
  return result;
 }
 function load(number=get().page??(get().anchor?undefined:1),append=false){return request(number,append?'append':'replace');}
 $effect(()=>{const next=scope;untrack(()=>{if(previous===next)return;previous=next;const active=resource.activated;firstPage=1;dirty=true;resource.replace({items:[],page:1,pages:1,total:0});if(active&&!local)void load();});});
 $effect(()=>{const selected=local;untrack(()=>{if(selected===wasLocal)return;wasLocal=selected;if(selected)resource.cancel();else if(dirty||!resource.ready||resource.error)void load();});});
 onDestroy(resource.dispose);
 return {
  get title(){return resource.data.title??get().title;},get href(){
   const href=get().layout==='grid'?undefined:get().href??resource.data.href;
   if(!href||!get().availability)return href;
   const url=new URL(href,'http://coast/');url.searchParams.set('available',String(available));return url.pathname+url.search;
  },
  get items(){return local?get().items!.filter(item=>!available||!get().availability||item.available):resource.data.items;},get busy(){return !local&&resource.busy;},get error(){return local?'':resource.error;},
  get ready(){return local||resource.ready&&resource.activated&&!dirty;},get activated(){return local||resource.activated;},
  get shape(){return get().shape??'poster';},get mediaKind(){return get().mediaKind;},
  get resetKey(){return get().anchor?`${scope}:${local}`:get().path;},
  get filters(){return get().availability?[{type:'availability' as const,label:'Available to play only',value:available?'available':'all',change:(value:string)=>{available=value==='available';}}]:[];},controls:[],
  get initialItemId(){return get().anchor&&!local?resource.data.focusId:undefined;},
  get pagination(){return local?{kind:'local' as const}:{kind:'pages' as const,page:resource.data.page,pages:resource.data.pages,firstPage,append:get().layout!=='grid',controls:get().layout==='grid'?'both' as const:'none' as const};},
  get empty(){return 'No items in this selection.';},load,
  loadPrevious:()=>firstPage>1&&!resource.busy?request(firstPage-1,'prepend'):Promise.resolve(),
 };
}
