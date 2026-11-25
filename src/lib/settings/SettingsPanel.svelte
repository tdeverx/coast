<script lang="ts">
  import { preloadData } from '$app/navigation';
  import { page } from '$app/state';
  import { tick, untrack } from 'svelte';
  import { reportFailure } from '#lib/ui/client-context.js';
  import { backMediaDetails, closeMediaDetails } from '#lib/ui/media-navigation.js';
  import { message } from '#lib/ui/client.js';
  import type { PageData } from '../../routes/settings/[[section]]/$types';
  import { onSettingsRefresh } from './overlay-refresh.js';
  import type { settingsTarget } from './navigation.js';

  let { target }: { target: ReturnType<typeof settingsTarget> } = $props();
  let SettingsPage = $state<typeof import('../../routes/settings/[[section]]/+page.svelte').default>();
  let view = $state.raw<{ href: string; viewer: string; data: PageData }>();
  let error = $state('');
  let request = 0;
  const href = $derived(target?.href);
  const viewer = $derived(page.data.user);
  const viewerId = $derived(viewer?.id);
  const allowed = $derived(page.data.capabilities?.settingsSidebar === true && target && viewer && (!target.admin || viewer.role === 'admin')
    && (!viewer.access?.libraryOnly || !target.section || ['account', 'appearance', 'features'].includes(target.section)));
  const open = $derived(!!target && !!allowed && view?.viewer === viewerId);

  async function load(href: string, viewer: string, navigateOnError: boolean) {
    const id = ++request;
    try {
      const [component, result] = await Promise.all([
        SettingsPage ?? import('../../routes/settings/[[section]]/+page.svelte').then(module => module.default),
        preloadData(href),
      ]);
      if (id !== request) return;
      if (result.type !== 'loaded' || result.status !== 200) {
        throw new Error(result.type === 'error' ? result.error.message : 'Settings are unavailable.');
      }
      SettingsPage = component;
      view = { href, viewer, data: result.data as PageData };
      await tick();
    } catch (cause) {
      if (id !== request) return;
      error = message(cause);
      if (navigateOnError) {
        if (view && page.state.mediaDetailDepth && page.state.mediaDetailDepth > 1) void backMediaDetails();
        else void closeMediaDetails();
      }
    }
  }

  $effect(() => {
    const currentHref = href, id = viewerId;
    error = '';
    if (!currentHref || !id) return;
    if (!allowed) {
      view = undefined;
      void closeMediaDetails();
      return;
    }
    untrack(() => { void load(currentHref, id, true); });
    return () => { request++; };
  });

  $effect(() => onSettingsRefresh(async () => {
    const currentHref = href, id = viewerId;
    if (currentHref && id && allowed) await load(currentHref, id, false);
  }));

  function releaseClosedView() {
    if (!href) view = undefined;
  }

  reportFailure(() => error);
</script>

{#if SettingsPage && view}
  <SettingsPage data={view.data} target={view.href} {open} onclose={closeMediaDetails} onclosed={releaseClosedView} />
{/if}
