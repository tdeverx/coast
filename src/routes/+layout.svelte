<script lang="ts">
  import '../app.css';
  import MediaModal from '$lib/experiments/MediaModal.svelte';
  import {closeNotifications} from '$lib/notifications/client.svelte';
  import {closeFriends} from '$lib/social/panel.svelte';
  import {startPresence,userStatus} from '$lib/social/status.svelte';
  import {syncedPlayer,pollSynced,restoreSynced} from '$lib/playback/synced/client.svelte';
  import { installBrowserDiagnostics } from '$lib/ui/diagnostics';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { invalidate, onNavigate } from '$app/navigation';
  import NotificationToasts from '$lib/ui/components/NotificationToasts.svelte';
  import Header from '$lib/ui/components/Header.svelte';
  import PersistentPlayer from '$lib/ui/components/PersistentPlayer.svelte';
  import MediaHero from '$lib/ui/components/MediaHero.svelte';
  import { player, pausePlayback } from '$lib/playback/client.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  let { data, children } = $props();
  let expired = $state(false);
  let content: HTMLElement;
  const notificationOpen=$derived(!!data.user&&(page.state.notificationPopover??page.url.searchParams.get('notifications')==='true'));
  const friendsOpen=$derived(!!data.user&&(page.state.friendsPopover??page.url.searchParams.get('friends')==='true'));
  let NotificationInbox=$state<typeof import('$lib/ui/components/NotificationInbox.svelte').default>();
  let FriendsPanel=$state<typeof import('$lib/ui/components/FriendsPanel.svelte').default>();
  let notificationLoading=false,friendsLoading=false;
  $effect(()=>{if(notificationOpen&&!NotificationInbox&&!notificationLoading){notificationLoading=true;void import('$lib/ui/components/NotificationInbox.svelte').then(module=>NotificationInbox=module.default).finally(()=>notificationLoading=false);}});
  $effect(()=>{if(friendsOpen&&!FriendsPanel&&!friendsLoading){friendsLoading=true;void import('$lib/ui/components/FriendsPanel.svelte').then(module=>FriendsPanel=module.default).finally(()=>friendsLoading=false);}});
  const watching = $derived((!!data.user || page.url.pathname === '/share') && !!player.session && player.session.mediaType!=='audio' && !player.browsing);
  onNavigate(async (navigation) => {
    if (player.session && player.session.mediaType!=='audio' && !syncedPlayer.room && !player.paused) pausePlayback();
    const hero = document.querySelector<HTMLElement>('[data-hero-id]');
    if (
      !content ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      navigation.to?.url.pathname === `/media/${hero?.dataset.heroId}`
    )
      return;
    await content
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out' })
      .finished.catch(() => {});
    return () => {
      content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-in' });
    };
  });
  $effect(() => {
    if (!watching) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previous;
    };
  });
  $effect(()=>{syncedPlayer.userId=data.user?.id||'';});
  const presenceUserId=$derived(data.user?.id);
  $effect(()=>{
    userStatus.preference=data.user?.settings?.activityStatus??'automatic';
    userStatus.sharePresence=(data.user?.settings?.social?.sections?.presence??data.user?.settings?.social?.audience??'friends')!=='private';
  });
  $effect(()=>{
    if(!presenceUserId)return;
    return startPresence(()=>!!player.session&&!player.paused,()=>false);
  });
  onMount(() => {
    if(data.user&&data.experimentalParties)void restoreSynced();
    const syncTimer=setInterval(()=>{if(data.user&&data.experimentalParties)void pollSynced();},2000);
    const stopDiagnostics = data.user ? installBrowserDiagnostics() : () => {};
    const expire = () => (expired = true);
    window.addEventListener('coast:auth-expired', expire);
    let polling = false;
    const timer = setInterval(() => {
      if (data.expiresAt && Date.now() > new Date(data.expiresAt).getTime()) expired = true;
      else if (data.user && !polling && document.visibilityState === 'visible') {
        polling = true;
        void invalidate('coast:session')
          .catch(() => {})
          .finally(() => {
            polling = false;
          });
      }
    }, 60000);
    return () => {
      stopDiagnostics();
      window.removeEventListener('coast:auth-expired', expire);
      clearInterval(timer);
      clearInterval(syncTimer);
    };
  });
</script>

<svelte:head
  ><title>Coast</title><meta
    name="description"
    content="Your stories, in one place. A self-hosted media tracker and player."
  /></svelte:head
>
<div
  data-coast-glass={data.user?.settings?.liquidGlass === false ? 'off' : 'on'}
  data-width={data.user?.settings?.fullWidth === false ? 'constrained' : 'full'}
  class:player-active={!!player.session}
  class:audio-active={player.session?.mediaType === 'audio'}
  class:watching
>
  {#if data.user&&data.experiments.mediaModal}<MediaModal />{/if}<PersistentPlayer /><MediaHero mode="player" />
  {#if !watching}<a class="skip-link" href="#main-content">Skip to content</a>{/if}
  {#if (data.user || data.publicRead || data.publicProfiles) && page.url.pathname !== '/onboarding' && page.url.pathname !== '/share'}<Header
      user={data.user}
      publicBrowse={data.publicRead}
      unread={data.unreadNotifications}
      friendRequests={data.friendRequestCount}
    />{/if}
  <div class="page-shell" class:watching inert={watching} aria-hidden={watching}>
    <main bind:this={content} id="main-content" tabindex="-1">{@render children()}</main>
  </div>
  {#if notificationOpen&&NotificationInbox}<NotificationInbox open={true} initialKind={page.state.notificationKind??page.url.searchParams.get('notificationKind')??'all'} onclose={closeNotifications}/>{/if}
  {#if friendsOpen&&FriendsPanel}<FriendsPanel open={true} onclose={closeFriends}/>{/if}
  {#if data.user}<NotificationToasts notifications={data.notifications} />{/if}{#if expired}<div
      class="session-notice solid-surface"
      role="alert"
    >
      <p>Your session has expired. Your current page is still here.</p>
      <Button href={`/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`}
        >Sign in again</Button
      >
    </div>{/if}
</div>

<style>
  .page-shell {
    position: relative;
    z-index: 2;
    min-height: 100svh;
    display: flow-root;
  }
  .page-shell.watching {
    visibility: hidden;
  }
  .player-active .page-shell {
    padding-bottom: 100px;
  }
  .page-shell::before {
    /* Keep the black canvas outside the route fade and above the hero video. */
    content: '';
    position: absolute;
    inset: 0;
    background: var(--canvas);
    pointer-events: none;
  }
  .page-shell:has(:global([data-hero-id]))::before {
    top: var(--active-hero-height, var(--hero-height));
  }
  main {
    position: relative;
    z-index: 1;
  }
  .session-notice {
    position: fixed;
    z-index: 120;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    width: min(660px, calc(100% - 32px));
    border-radius: 18px;
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .session-notice p {
    font-size: var(--text-sm);
  }
  .session-notice :global(.button) {
    white-space: nowrap;
  }
  .player-active .session-notice {
    bottom: 96px;
  }
  @media (max-width: 639px) {
    .player-active .page-shell {
      padding-bottom: 156px;
    }
    .player-active .session-notice {
      bottom: 156px;
    }
  }
</style>
