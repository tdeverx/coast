import { page } from '$app/state';
import { goto } from '$app/navigation';
import { detailPanelHref, detailPanelUrl, mediaDetailTarget, panelAddress } from '#lib/media/detail-target.js';
import { sectionTarget } from '#lib/ui/section-target.js';
import { player } from '#lib/playback/client.svelte.js';
import { captureShelfPosition } from './shelf-position';
import { actionFeedback } from './action-feedback.svelte';
import { message } from './client';

let opening: Promise<void> = Promise.resolve();
let closingState: App.PageState | undefined;

export function inviteProfileTarget(href: string | undefined) {
  if (!href || !['/invite','/register','/ui-preview/login'].includes(page.url.pathname) ||
      !(page.data.publicProfiles || page.data.publicRead)) return null;
  const target = mediaDetailTarget(href,page.url);
  return target?.kind === 'profile' ? target : null;
}

function overlayTarget(href: string, section = false) {
  const target = page.data.user && !page.url.pathname.startsWith('/ui-preview')
    ? mediaDetailTarget(href,page.url) ?? (section || detailPanelHref(panelAddress(page),page.state) ? sectionTarget(href,page.url) : null)
    : inviteProfileTarget(href);
  if (target && 'kind' in target) {
    if (target.kind === 'profile' && page.data.user?.access?.libraryOnly) return null;
    if (target.kind === 'personalise' && page.data.capabilities?.cardLayouts !== true) return null;
  }
  return target;
}
export function openMediaDetails(href:string,section=false,replace=false){
 const target=overlayTarget(href,section);if(!target)return false;
  if (player.session) player.browsing = true;
  const address = detailPanelUrl(panelAddress(page)).href, viewer = page.data.user?.id;
  const isCurrent = () => detailPanelUrl(panelAddress(page)).href === address && page.data.user?.id === viewer;
  // Native shallow goto is asynchronous. Keep a saved parent entry ahead of its
  // child and compute each queued click from the last committed panel state.
  opening = opening.then(async () => {
    if (!isCurrent()) return;
    const parentHref = detailPanelHref(panelAddress(page),page.state);
  if (parentHref !== target.href) {
    let parent = page.state;

    const fromLink = parent.mediaDetailFromLink ?? (!!parentHref && !parent.mediaDetailHref);
    const replaceCurrent = replace && !!parentHref;
    if (parentHref && !replaceCurrent) {
      const rail = [
        ...document.querySelectorAll<HTMLElement>('.detail-scroll [data-shelf-location]')
      ].find((node) => node.closest('dialog')?.hasAttribute('open'));

      const href = rail?.dataset.shelfLocation;
      const position = rail ? captureShelfPosition(rail, 'grid') : undefined;

      if (href && position && sectionTarget(href,page.url)) {
        parent = {
          ...parent,
          mediaDetailHref: href,
          mediaDetailFromLink: fromLink,
          mediaDetailShelf: { href, position }
        };

        if (!isCurrent()) return;
        await goto(detailPanelUrl(panelAddress(page), href), { shallow: true, reset: false, replace: true, state: parent });
      }
    }

    if (!isCurrent()) return;
    await goto(detailPanelUrl(panelAddress(page), target.href), {
      shallow: true, reset: false, replace: replaceCurrent,
      state: {
        ...parent,
        mediaDetailShelf: undefined,
        mediaDetailHref: target.href,
        mediaDetailFromLink: fromLink,
        mediaDetailDepth: replaceCurrent ? parent.mediaDetailDepth ?? 1 : parentHref ? (parent.mediaDetailDepth ?? 1) + 1 : 1
      }
    });
  }

  }).catch(cause => actionFeedback.failure(message(cause)));
  return true;
}
export async function navigateMedia(href:string,options?:Parameters<typeof goto>[1]){if(openMediaDetails(href,false,options?.replace))await opening;else await goto(href,options);}
export async function backMediaDetails(){await opening;if((page.state.mediaDetailDepth??1)>1)history.back();}
export async function closeMediaDetails() {
  await opening;
  const state = page.state;
  if (!detailPanelHref(panelAddress(page),state) || state === closingState) return;
  // The dialog remains modal until the history entry changes. Several close
  // gestures during that traversal still belong to the same entry.
  closingState = state;
  if (state.mediaDetailDepth && !state.mediaDetailFromLink) history.go(-state.mediaDetailDepth);
  else await goto(detailPanelUrl(panelAddress(page)), {
    shallow: true, reset: false, replace: true,
    state: { ...state, mediaDetailHref: undefined, mediaDetailDepth: undefined,
      mediaDetailFromLink: undefined, mediaDetailShelf: undefined },
  });
}
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
  link.setAttribute('data-sveltekit-preload-data','false');
  queueMicrotask(()=>{if(link.getAttribute('data-sveltekit-preload-data')!=='false')return;if(original===null)link.removeAttribute('data-sveltekit-preload-data');else link.setAttribute('data-sveltekit-preload-data',original);});
  }

  node.addEventListener('click', clicked);
  node.addEventListener('mousedown', tapped);
  node.addEventListener('touchstart', tapped, { passive: true });

  return {
    destroy() {
      node.removeEventListener('click', clicked);
      node.removeEventListener('mousedown', tapped);
      node.removeEventListener('touchstart', tapped);
    }
  };
}
