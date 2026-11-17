import { getContext, onDestroy, setContext } from 'svelte';
import { createResource } from '../resource.svelte';

export type MenuConditions = Partial<Record<
  'available' | 'pending' | 'position' | 'versions' | 'playback' | 'reader' | 'presence' | 'checkIn'
  | 'screen' | 'music' | 'game' | 'book' | 'comic'
  | 'rewatch' | 'paused' | 'airDate' | 'requests' | 'fourK' | 'existingRequest' | 'sharing' | 'planning'
  | 'social' | 'admin' | 'collection' | 'genre' | 'status' | 'source' | 'readyCheck' | 'partyAudio'
  | 'copyable' | 'partyInvite' | 'friendActivity' | 'compare'
  | 'collectionView' | 'manualCheckIn' | 'completed' | 'dropped' | 'playthrough' | 'subtitles' | 'controlPlayback' | 'editQueue'
  | 'selectedControllers' | 'acceptInvites' | 'integrationEnabled' | 'jobFailed' | 'jobRunning' | 'benchmark'
  | 'connectionFailure' | 'permissionFailure' | 'metadataFailure' | 'unread' | 'libraryOnly' | 'artwork' | 'metadataSource', boolean>>;
type MenuPreview = {
  conditions: MenuConditions;
  claimInline: (label: string) => boolean;
  mountInline: (node: HTMLElement) => { destroy: () => void };
  wrapsMenu: (title: string) => boolean;
  profileBackground: (workId: string | undefined, actual: boolean) => boolean;
  setProfileBackground: (workId: string | null) => void;
};
const menuPreview = Symbol('menu preview');

export function provideMenuPreview(value: { conditions: MenuConditions; inline: string; target: () => HTMLElement | undefined; wrappers: readonly string[] }) {
  let claimed = false;
  const background=createResource<string|null|undefined>(undefined);
  onDestroy(background.dispose);
  setContext<MenuPreview>(menuPreview, {
    get conditions() { return value.conditions; },
    wrapsMenu: title => value.wrappers.includes(title),
    profileBackground: (workId,actual)=>background.data===undefined?actual:background.data===workId,
    setProfileBackground: workId=>background.replace(workId),
    mountInline(node) {
      const original = document.createComment('menu preview owner');
      const previousPixel = node.style.getPropertyValue('--menu-device-pixel');
      const updatePixel = () => node.style.setProperty('--menu-device-pixel', `${1 / (window.devicePixelRatio || 1)}px`);
      node.before(original);
      value.target()?.append(node);
      updatePixel();
      window.addEventListener('resize', updatePixel);
      return { destroy() {
        window.removeEventListener('resize', updatePixel);
        if (previousPixel) node.style.setProperty('--menu-device-pixel', previousPixel);
        else node.style.removeProperty('--menu-device-pixel');
        original.replaceWith(node);
      } };
    },
    claimInline(label) {
      if (claimed || !value.inline || value.inline !== '*' && !label.startsWith(value.inline)) return false;
      claimed = true;
      return true;
    },
  });
}

export function useMenuPreview(): MenuPreview | undefined {
  return getContext(menuPreview);
}

/** Preview overrides are consumed only below the fixture client scope. */
export function menuCondition(id: keyof MenuConditions, actual: boolean, preview: boolean, fixture: MenuPreview | undefined) {
  return preview && fixture?.conditions[id] !== undefined ? !!fixture.conditions[id] : actual;
}
