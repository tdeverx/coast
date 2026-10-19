<script lang="ts">
  import { reportFailure, reportImportFailure } from '$lib/ui/client-context';
  import '../app.css';
  import { reader, closeReading } from '$lib/reading/client.svelte';
  import { createResource } from '$lib/ui/resource.svelte';
  const readerImport=createResource<typeof import('$lib/reading/Reader.svelte').default|undefined>(undefined);
  const Reader=$derived(readerImport.data);
  function loadReader(){if(data.user&&reader.visible&&!readerImport.busy)return readerImport.load(async()=> (await import('$lib/reading/Reader.svelte')).default);}
  $effect(()=>{const viewer=data.user?.id;if(!viewer||!reader.visible)return;untrack(()=>{if(!readerImport.data)void loadReader();});return()=>readerImport.cancel();});
  reportImportFailure(()=>data.user&&reader.visible&&readerImport.error?'The reader could not load. Reload the page to try again.':'');
  import {closeNotifications} from '$lib/ui/panels/notifications.svelte';
  import {closeFriends} from '$lib/ui/panels/friends.svelte';
  import {closeStreams} from '$lib/ui/panels/streams.svelte';
  import {startPresence,userStatus} from '$lib/social/status.svelte';
  import {playbackVisible} from '$lib/playback/visibility';
  import {syncedPlayer,pollSynced,restoreSynced,leaveSynced} from '$lib/playback/synced/client.svelte';
  import { refreshRouteDependencies } from '$lib/ui/client';
  import { installBrowserDiagnostics } from '$lib/ui/diagnostics';
  import { onMount, onDestroy, untrack } from 'svelte';
  import { page } from '$app/state';
  import { onNavigate,replaceState } from '$app/navigation';
  import {mediaDetailLinks} from '$lib/ui/media-navigation';
  import NotificationToasts from '$lib/ui/components/NotificationToasts.svelte';
  import Header from '$lib/ui/components/Header.svelte';
  import PersistentPlayer from '$lib/ui/components/PersistentPlayer.svelte';
  import MediaHero from '$lib/ui/components/MediaHero.svelte';
  import { player, pausePlayback, stopPlayback } from '$lib/playback/client.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  let { data, children } = $props();
  let expired = $state(false);
  let content: HTMLElement;
  const notificationOpen=$derived(!!data.user&&(page.state.notificationPopover??page.url.searchParams.get('notifications')==='true'));
  const friendsOpen=$derived(!!data.user&&data.capabilities.social&&(page.state.friendsPopover??page.url.searchParams.get('friends')==='true'));
  const notificationImport=createResource<typeof import('$lib/ui/components/NotificationInbox.svelte').default|undefined>(undefined);
  const friendsImport=createResource<typeof import('$lib/ui/components/FriendsPanel.svelte').default|undefined>(undefined);
  const NotificationInbox=$derived(notificationImport.data),FriendsPanel=$derived(friendsImport.data);
  const streamsOpen=$derived(data.user?.role==='admin'&&(page.state.streamsPopover??page.url.searchParams.get('streams')==='true'));
  const streamsImport=createResource<typeof import('$lib/ui/components/StreamsPanel.svelte').default|undefined>(undefined);
  const StreamsPanel=$derived(streamsImport.data);
  function loadStreams(){if(streamsOpen&&!streamsImport.busy)return streamsImport.load(async()=> (await import('$lib/ui/components/StreamsPanel.svelte')).default);}
  $effect(()=>{const viewer=data.user?.id;if(!viewer||!streamsOpen)return;untrack(()=>{if(!streamsImport.data)void loadStreams();});return()=>streamsImport.cancel();});
  reportImportFailure(()=>streamsOpen&&streamsImport.error?'Active streams could not load. Reload the page to try again.':'');
  const detailImport=createResource<typeof import('$lib/media/DetailPanel.svelte').default|undefined>(undefined);
  const MediaDetailPanel=$derived(detailImport.data);
  function loadDetails(){if(data.user&&page.state.mediaDetailHref&&!detailImport.busy)return detailImport.load(async()=> (await import('$lib/media/DetailPanel.svelte')).default);}
  $effect(()=>{if(!data.user&&page.state.mediaDetailHref)replaceState(page.url,{...page.state,mediaDetailHref:undefined,mediaDetailDepth:undefined});});
  $effect(()=>{const viewer=data.user?.id;if(!viewer||!page.state.mediaDetailHref)return;untrack(()=>{if(!detailImport.data)void loadDetails();});return()=>detailImport.cancel();});
  reportImportFailure(()=>data.user&&page.state.mediaDetailHref&&detailImport.error?'Title details could not load. Reload the page to try again.':'');
  function loadNotifications(){if(notificationOpen&&!notificationImport.busy)return notificationImport.load(async()=> (await import('$lib/ui/components/NotificationInbox.svelte')).default);}
  function loadFriends(){if(friendsOpen&&!friendsImport.busy)return friendsImport.load(async()=> (await import('$lib/ui/components/FriendsPanel.svelte')).default);}
  $effect(()=>{const viewer=data.user?.id;if(!viewer||!notificationOpen)return;untrack(()=>{if(!notificationImport.data)void loadNotifications();});return()=>notificationImport.cancel();});
  $effect(()=>{const viewer=data.user?.id;if(!viewer||!friendsOpen)return;untrack(()=>{if(!friendsImport.data)void loadFriends();});return()=>friendsImport.cancel();});
  reportImportFailure(()=>notificationOpen&&notificationImport.error?'Notifications could not load. Reload the page to try again.':'');
  reportImportFailure(()=>friendsOpen&&friendsImport.error?'Friends could not load. Reload the page to try again.':'');
  onDestroy(()=>{for(const resource of [readerImport,streamsImport,detailImport,notificationImport,friendsImport])resource.dispose();});
  const watching = $derived((!!data.user || page.url.pathname === '/share') && playbackVisible(player));
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
  const presenceEnabled=$derived(data.capabilities.presence), partiesEnabled=$derived(data.capabilities.parties);
  $effect(()=>{
    userStatus.preference=data.user?.settings?.activityStatus??'automatic';
    userStatus.sharePresence=(data.user?.settings?.social?.sections?.presence??data.user?.settings?.social?.audience??'friends')!=='private';
  });
  $effect(()=>{
    if(!presenceUserId||!presenceEnabled)return;
    return startPresence(()=>!!player.session&&!player.paused,()=>false);
  });
  $effect(()=>{
    if(!presenceUserId||!partiesEnabled)return;
    void restoreSynced();
  });
  $effect(()=>{
    if(!presenceUserId||!partiesEnabled||!syncedPlayer.room?.id)return;
    const syncTimer=setInterval(()=>void pollSynced(),2000);
    return ()=>clearInterval(syncTimer);
  });
  $effect(()=>{
    if((player.session||player.loading)&&(!data.capabilities.playback||player.session&&!(player.session.mediaType==='audio'?data.capabilities.music:data.capabilities.screen)||player.loading&&!(player.preparationMediaType==='audio'?data.capabilities.music:data.capabilities.screen)))void stopPlayback();
    if((reader.session||reader.loading)&&(!data.capabilities.reader||reader.session&&!data.capabilities[reader.session.kind]))void closeReading(true,false);
    if(syncedPlayer.room&&!data.capabilities.parties)void leaveSynced(true);
  });
  onMount(() => {
    const stopDiagnostics = data.user ? installBrowserDiagnostics() : () => {};
    const expire = () => (expired = true);
    window.addEventListener('coast:auth-expired', expire);
    let polling = false;
    const timer = setInterval(() => {
      if (data.expiresAt && Date.now() > new Date(data.expiresAt).getTime()) expired = true;
      else if (data.user && !polling && document.visibilityState === 'visible') {
        polling = true;
        void refreshRouteDependencies(['session'])
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

    };
  });
  reportFailure(()=>syncedPlayer.notice);
</script>

<svelte:head
  ><title>Coast</title><meta
    name="description"
    content="Your stories, in one place. A self-hosted media tracker and player."
  /></svelte:head
>
<div
  use:mediaDetailLinks
  data-coast-glass={data.user?.settings?.liquidGlass === false ? 'off' : 'on'}
  data-width={data.user?.settings?.fullWidth === false ? 'constrained' : 'full'}
  class:player-active={!!player.session}
  class:audio-active={player.session?.mediaType === 'audio'}
  class:watching
>
  {#if data.user&&Reader}<Reader />{/if}
  {#if data.user&&MediaDetailPanel}<MediaDetailPanel />{/if}<PersistentPlayer /><MediaHero mode="player" />
  {#if !watching}<a class="skip-link" href="#main-content">Skip to content</a>{/if}
  {#if (data.user || data.publicRead || data.publicProfiles) && page.url.pathname !== '/onboarding' && page.url.pathname !== '/share'}<Header
      user={data.user}
      publicBrowse={data.publicRead}
      unread={data.unreadNotifications}
      friendRequests={data.friendRequestCount}
    />{/if}
  <div class="page-shell" class:watching inert={watching||reader.visible} aria-hidden={watching||reader.visible}>
    <main bind:this={content} id="main-content" tabindex="-1">{@render children()}</main>
  </div>
  {#if notificationOpen&&NotificationInbox}<NotificationInbox open={true} initialKind={page.state.notificationKind??page.url.searchParams.get('notificationKind')??'all'} onclose={closeNotifications}/>{/if}
  {#if friendsOpen&&FriendsPanel}<FriendsPanel open={true} onclose={closeFriends}/>{/if}
  {#if streamsOpen&&StreamsPanel}<StreamsPanel open={true} onclose={closeStreams}/>{/if}
  {#key data.user?.id}<NotificationToasts notifications={data.user ? data.notifications : []} initialFailure={typeof page.form?.error==='string'?page.form.error:undefined} />{/key}{#if expired}<div
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
    /* Descendant image visibility cannot override a composited hidden page. */
    opacity: 0;
    pointer-events: none;
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
