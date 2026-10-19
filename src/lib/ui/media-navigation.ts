import {page} from '$app/state';
import {goto,pushState,replaceState} from '$app/navigation';
import {mediaDetailTarget} from '$lib/media/detail-target';
import {sectionTarget} from '$lib/ui/section-target';
import {player} from '$lib/playback/client.svelte';
import {captureShelfPosition} from './shelf-position';

function overlayTarget(href:string,section=false){
 return page.data.user&&!page.url.pathname.startsWith('/ui-preview')?(mediaDetailTarget(href,page.url)??((section||page.state.mediaDetailHref)?sectionTarget(href,page.url):null)):null;
}
export function openMediaDetails(href:string,section=false){
 const target=overlayTarget(href,section);if(!target)return false;
 // Detail inspection returns to browsing without pausing a personal or party stream.
 if(player.session)player.browsing=true;
 if(page.state.mediaDetailHref!==target.href){
  let parent=page.state;
  if(parent.mediaDetailHref){
   const rail=[...document.querySelectorAll<HTMLElement>('.detail-scroll [data-shelf-location]')].find(node=>node.closest('dialog')?.hasAttribute('open'));
   const href=rail?.dataset.shelfLocation;
   const position=rail?captureShelfPosition(rail,'grid'):undefined;
   if(href&&position&&sectionTarget(href,page.url)){
    parent={...parent,mediaDetailHref:href,mediaDetailShelf:{href,position}};
    replaceState(page.url,parent);
   }
  }
  pushState(page.url,{...parent,mediaDetailShelf:undefined,mediaDetailHref:target.href,mediaDetailDepth:parent.mediaDetailHref?(parent.mediaDetailDepth??1)+1:1});
 }
 return true;
}
export async function navigateMedia(href:string,options?:Parameters<typeof goto>[1]){if(!openMediaDetails(href))await goto(href,options);}
export function backMediaDetails(){if((page.state.mediaDetailDepth??1)>1)history.back();}
export function closeMediaDetails(){if(page.state.mediaDetailHref)history.go(-(page.state.mediaDetailDepth??1));}
/** One delegated listener covers anchors, Buttons, menus, heroes and future detail links. */
export function mediaDetailLinks(node:HTMLElement){
 function anchor(event:Event){
  if(event.defaultPrevented||event instanceof MouseEvent&&(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey))return;
  const link=event.composedPath().find((element):element is HTMLAnchorElement=>element instanceof HTMLAnchorElement);
  if(!link||link.hasAttribute('download')||link.target&&link.target!=='_self'||link.relList.contains('external'))return;
  if(link.closest('[data-sveltekit-reload]:not([data-sveltekit-reload="false"])'))return;
  return link;
 }
 function clicked(event:MouseEvent){
  const link=anchor(event);if(!link)return;
  if(openMediaDetails(link.href,link.hasAttribute('data-detail-section')))event.preventDefault();
 }
 function tapped(event:Event){
  const link=anchor(event);if(!link||!overlayTarget(link.href,link.hasAttribute('data-detail-section')))return;
  // The document router reads this synchronously during the same bubbling tap.
  // Restore it in a microtask so no link/node cache or policy-change cleanup is needed.
  const original=link.getAttribute('data-sveltekit-preload-data');
  link.setAttribute('data-sveltekit-preload-data','off');
  queueMicrotask(()=>{if(link.getAttribute('data-sveltekit-preload-data')!=='off')return;if(original===null)link.removeAttribute('data-sveltekit-preload-data');else link.setAttribute('data-sveltekit-preload-data',original);});
 }
 node.addEventListener('click',clicked);
 node.addEventListener('mousedown',tapped);node.addEventListener('touchstart',tapped,{passive:true});
 return {destroy(){node.removeEventListener('click',clicked);node.removeEventListener('mousedown',tapped);node.removeEventListener('touchstart',tapped);}};
}
