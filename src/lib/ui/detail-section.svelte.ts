import { goto } from '$app/navigation';
import { detailPanelHref, detailPanelUrl, panelAddress } from '#lib/media/detail-target.js';
import {page} from '$app/state';
import {getContext,setContext,type Snippet} from 'svelte';
type Presentation={title:string;segments?:Snippet;controls?:Snippet};
type SectionHost={readonly active:boolean;readonly embedded:boolean;readonly url:URL;owns:(id:string)=>boolean;attach:(id:string,read:()=>Presentation)=>()=>void};
const key=Symbol('Detail section');
/** A section Shelf supplies its real controls to the enclosing panel chrome. */
export function provideDetailSection(active:()=>boolean,href:()=>string|undefined=()=>undefined,embedded=active){
 let owner=$state.raw<{id:string;read:()=>Presentation}>();
 const host:SectionHost={get active(){return active();},get embedded(){return embedded();},get url(){return new URL(href()??page.url.href,page.url.href);},owns(id){return owner?.id===id;},attach(id,read){
  if(owner)return ()=>{};
  const entry={id,read};owner=entry;return ()=>{if(owner===entry)owner=undefined;};
 }};
 setContext(key,host);
 return {get active(){return active();},get title(){return owner?.read().title??'';},get segments(){return owner?.read().segments;},get controls(){return owner?.read().controls;}};
}
export function useDetailSection(){return getContext<SectionHost|undefined>(key);}

/** Sources retain their own controls, while embedded views never rewrite the underlying route. */
export function useShelfLocation() {
  const host = useDetailSection();
  return {
    get url() {
      if (host?.embedded) return host.url;
      return page.url.searchParams.has('detail') ? detailPanelUrl(page.url) : page.url;
    },
    get embedded() { return !!host?.embedded; },
    replace(href: string | URL) {
      // A grid can finish refreshing underneath a modal. Keep its deep link in the browser address.
      const url = new URL(href, page.url.href);
      const detail = detailPanelHref(panelAddress(page), page.state);
      return goto(detailPanelUrl(url, detail), { shallow: true, replace: true, reset: false, state: page.state });
    }
  };
}
