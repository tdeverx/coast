import {page} from '$app/state';
import {getContext,setContext,type Snippet} from 'svelte';
type Presentation={title:string;segments?:Snippet;controls?:Snippet};
type SectionHost={readonly active:boolean;readonly url:URL;owns:(id:string)=>boolean;attach:(id:string,read:()=>Presentation)=>()=>void};
const key=Symbol('Detail section');
/** A section Shelf supplies its real controls to the enclosing panel chrome. */
export function provideDetailSection(active:()=>boolean,href:()=>string|undefined=()=>undefined){
 let owner=$state.raw<{id:string;read:()=>Presentation}>();
 const host:SectionHost={get active(){return active();},get url(){return new URL(href()??page.url.href,page.url.href);},owns(id){return owner?.id===id;},attach(id,read){
  if(owner)return ()=>{};
  const entry={id,read};owner=entry;return ()=>{if(owner===entry)owner=undefined;};
 }};
 setContext(key,host);
 return {get active(){return active();},get title(){return owner?.read().title??'';},get segments(){return owner?.read().segments;},get controls(){return owner?.read().controls;}};
}
export function useDetailSection(){return getContext<SectionHost|undefined>(key);}

/** Sources retain their own controls, while embedded views never rewrite the underlying route. */
export function useShelfLocation(){const host=useDetailSection();return {get url(){return host?.active?host.url:page.url;},get embedded(){return !!host?.active;}};}
