import { onDestroy, untrack } from 'svelte';
import { page } from '$app/state';
import { replaceState } from '$app/navigation';
import { useClient } from '$lib/ui/client-context';
import { createResource } from '$lib/ui/resource.svelte';
import { discoverySegments, discoveryTitles, type DiscoveryContent, type DiscoverySurface, type DiscoverySection } from '$lib/discovery';
import type { ShelfSource, ShelfControl } from './types';
export type DiscoveryOptions={type:'discovery';section:DiscoverySection;initial?:DiscoveryContent;surface?:DiscoverySurface;mediums?:import('$lib/experimental').MediumFeatures;layout?:'row'|'grid'};
export function createDiscoverySource(get:()=>DiscoveryOptions):ShelfSource{
  const {api}=useClient();
  const initial=untrack(get);
  let surface=$state<DiscoverySurface>(initial.surface??'watch'),kind=$state('all'),available=$state(false);
  const resource=createResource<DiscoveryContent>(initial.initial??{items:[],failure:''},!!initial.initial);
  const cached=new Map<DiscoverySurface,DiscoveryContent>();
  resource.error=initial.initial?.failure??'';
  if(initial.initial&&!initial.initial.failure)cached.set(initial.surface??'watch',initial.initial);
  const title=$derived(discoveryTitles[get().section]);
  async function load(){
    const selected=surface;
    const previous=cached.get(selected);
    if(previous){resource.replace(previous,previous.failure);return;}
    const result=await resource.load(signal=>api<DiscoveryContent>(`discover?${new URLSearchParams({section:get().section,surface:selected})}`,undefined,'GET',{signal}),{failure:result=>result.failure});
    if(result&&!result.failure)cached.set(selected,result);
  }
  function select(value:string){
    if(value===surface)return;
    surface=value as DiscoverySurface;kind='all';
    if(get().layout==='grid')replaceState(`/discover?section=${get().section}&surface=${surface}`,page.state);
    resource.replace({items:[],failure:''});void load();
  }
  $effect(()=>{const option=get(),current=option.initial;untrack(()=>{if(current&&surface===(option.surface??'watch')){resource.replace(current,current.failure);if(!current.failure)cached.set(surface,current);}});});
  onDestroy(resource.cancel);
  return {
    pagination:{kind:'local'},
    get title(){return title;},get items(){return resource.data.items.filter(i=>(kind==='all'||i.kind===kind)&&(!available||i.available));},
    get busy(){return resource.busy;},get ready(){return resource.ready;},get error(){return resource.error;},get activated(){return resource.activated;},
    get href(){return get().layout==='grid'?undefined:`/discover?section=${get().section}&surface=${surface}`;},
    get shape(){return surface==='listen'?'square':'poster';},get mediaKind(){return surface==='listen'?'music':surface==='play'?'game':'screen';},
    get resetKey(){return `${surface}:${kind}:${available}`;},
    get filters():ShelfControl[]{return [
      {type:'segments',label:`${title} medium`,value:surface,options:discoverySegments.filter(option=>option.value==='watch'||option.value==='play'&&get().mediums?.experimentalGaming||option.value==='listen'&&get().mediums?.experimentalMusic),change:select},
      {type:'availability',label:'Available to play only',value:available?'available':'all',change:value=>{available=value==='available';}},
    ];},
    get controls():ShelfControl[]{return surface==='watch'?[{type:'media-type',label:`${title} type`,value:kind,change:value=>{kind=value;}}]:[];},
    get notice(){return resource.data.notice;},
    get empty(){return resource.busy?'Loading titles…':available?'No available titles in this selection.':surface==='listen'?'No music in this selection yet.':surface==='play'?'No games in this selection yet.':'No titles in this selection.';},
    load,
  };
}
