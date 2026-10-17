import {onDestroy,untrack} from 'svelte';
import {page as route} from '$app/state';
import {useClient} from '$lib/ui/client-context';
import {createResource,uniqueItems} from '$lib/ui/resource.svelte';
import {contentRevisionKey} from '$lib/ui/content-revision.svelte';
import type {ShelfItem,ShelfSource} from './types';
import type {MediaCardShape} from '$lib/ui/types';
export type DetailSourceOptions={type:'detail';title:string;path:string;href?:string;layout?:'row'|'grid';shape?:MediaCardShape;mediaKind?:'music'|'reading';page?:number};
type Content={items:ShelfItem[];page:number;pages:number;total:number;title?:string;href?:string};
/** Detail children use the same lazy activation, cancellation and ordered append as other shelves. */
export function createDetailSource(get:()=>DetailSourceOptions):ShelfSource{
 const {api}=useClient(),resource=createResource<Content>({items:[],page:1,pages:1,total:0});
 const scope=$derived(JSON.stringify([route.data.user?.id,get().path,get().layout,get().page,contentRevisionKey(route.data,['tracking','social'])]));
 let previous=untrack(()=>scope);
 async function load(number=get().page??1,append=false){
  const url=new URL(get().path,'http://coast/');url.searchParams.set('page',String(number));
  return resource.load(signal=>api<Content>(url.pathname.slice(1)+url.search,undefined,'GET',{signal}),{
   merge:(old,next)=>({...next,items:append?uniqueItems([...old.items,...next.items],item=>item.entryId??item.id):next.items}),
  });
 }
 $effect(()=>{const next=scope;untrack(()=>{if(previous===next)return;previous=next;const active=resource.activated;resource.replace({items:[],page:1,pages:1,total:0});if(active)void load();});});
 onDestroy(resource.dispose);
 return {
  get title(){return resource.data.title??get().title;},get href(){return get().layout==='grid'?undefined:get().href??resource.data.href;},
  get items(){return resource.data.items;},get busy(){return resource.busy;},get error(){return resource.error;},
  get ready(){return resource.ready;},get activated(){return resource.activated;},
  get shape(){return get().shape??'poster';},get mediaKind(){return get().mediaKind;},
  get resetKey(){return get().path;},filters:[],controls:[],
  get pagination(){return {kind:'pages' as const,page:resource.data.page,pages:resource.data.pages,append:get().layout!=='grid',controls:get().layout==='grid'?'both' as const:'none' as const};},
  get empty(){return 'No items in this selection.';},load,
 };
}
