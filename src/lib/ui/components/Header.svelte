<script lang="ts">
  import {userStatus,chooseStatus,sharePresence} from '$lib/social/status.svelte';
  import {preferenceLabels,statusPreferences,statusLabels} from '$lib/social/status';
  import {useClient} from '$lib/ui/client-context';
  const {preview,api}=useClient();
  let streamCount=$state<number|null>(null);
  $effect(()=>{
    if(preview||user?.role!=='admin'){streamCount=null;return;}
    const controller=new AbortController();let busy=false;
    async function readCount(){if(busy||document.hidden)return;busy=true;try{const result=await api<{active:number|null}>('providers/streams/count',undefined,'GET',{signal:controller.signal});if(!controller.signal.aborted)streamCount=result.active;}catch{if(!controller.signal.aborted)streamCount=null;}finally{busy=false;}}
    void readCount();const timer=setInterval(()=>void readCount(),15000);
    return ()=>{clearInterval(timer);controller.abort();};
  });
  import {openNotifications} from '$lib/notifications/client.svelte';
  import {openFriends} from '$lib/social/panel.svelte';
  import {openStreams} from '$lib/providers/streams-panel.svelte';
  import Avatar from './Avatar.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import { profilePath } from '$lib/profile/url';
  import { page } from '$app/state';
  import Icon from './Icon.svelte';
  import Brand from './Brand.svelte';

  import { player } from '$lib/playback/client.svelte';
  import { slidingPill } from '$lib/ui/materials/sliding-pill';
  import { liquidGlass } from '$lib/ui/materials/glass';
  let { user, unread = 0, friendRequests = 0, publicBrowse = true }: { user: { username: string; role: string; settings?:import('$lib/server/db/schema').UserSettings } | null; unread?: number; friendRequests?:number; publicBrowse?:boolean } =
    $props();
  const nav = $derived(user ? [
    { label: 'For You', href: '/for-you', icon:'home' as const },
    { label: 'Library', href: '/library',icon:'library' as const },
    { label: 'Discover', href: '/discover',icon:'discover' as const },
    { label: 'Search', href: '/search',icon:'search' as const },
  ] : publicBrowse ? [{label:'Discover',href:'/discover',icon:'discover' as const},{label:'Search',href:'/search',icon:'search' as const}] : []);
</script>

<header
  class:chrome-hidden={!!player.session && player.session.mediaType!=='audio' && !player.paused && !player.controlsVisible}
  inert={!!player.session && player.session.mediaType!=='audio' && !player.paused && !player.controlsVisible}
>
  <div class="header-inner content">
    <a class="brand-home" href={user?'/for-you':publicBrowse?'/discover':'/login'} aria-label="Coast home"><Brand compact size={44} /></a>
    {#if nav.length}
    <nav
      use:liquidGlass
      use:slidingPill
      class="glass segmented-control"
      aria-label="Primary navigation"
    >
      {#each nav as item}<a
          href={item.href}
          class:active={page.url.pathname === item.href || (item.href === '/library' && page.url.pathname.startsWith('/games'))}
          aria-current={page.url.pathname === item.href || (item.href === '/library' && page.url.pathname.startsWith('/games')) ? 'page' : undefined}
          aria-label={item.label}><span class="nav-icon"><Icon name={item.icon} size={24}/></span><span class="nav-label">{item.label}</span></a
        >{/each}
    </nav>
    {/if}
    <div class="account">
      {#if user}
      {#if user.role==='admin'}<button type="button" id="streams-trigger" class="icon-button notification" aria-label={streamCount===null?'Active streams':`Active streams, ${streamCount} active`} onclick={()=>{if(!preview)openStreams();}}><Icon name="server" size={21}/>{#if streamCount!==null&&streamCount>0}<span class="friend-count">{streamCount>99?'99+':streamCount}</span>{/if}</button>{/if}
      <button type="button" id="friends-trigger" class="icon-button notification" aria-label={friendRequests?`Friends, ${friendRequests} incoming requests`:"Friends"} onclick={()=>{if(!preview)openFriends();}}><Icon name="friends" size={21}/>{#if friendRequests}<span class="friend-count">{friendRequests>99?'99+':friendRequests}</span>{/if}</button>
      <button type="button"
        id="notification-trigger"
        class="icon-button notification"
        onclick={()=>{if(!preview)openNotifications();}}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        ><Icon name="bell" size={21} />{#if unread}<i></i>{/if}</button
      ><Button menu label="Account menu"
        >{#snippet trigger()}<span class="avatar"><Avatar name={user.username} src={user.settings?.profile?.avatar} label="Your profile" size={28} status={userStatus.status} class="header-icon" /></span
          >{/snippet}{#snippet children()}
          <Button menu label="Activity status">
            {#snippet trigger()}{#if userStatus.status!=='offline'}<span class="status-dot" data-status={userStatus.status} aria-hidden="true"></span>{/if}<span class="menu-action-label">{userStatus.preference==='automatic'?statusLabels[userStatus.status]:preferenceLabels[userStatus.preference]}</span><span class="menu-chevron"><Icon name="right" /></span>{/snippet}
            {#snippet children()}
              {#each statusPreferences as preference}<Button item selection="radio" checked={userStatus.preference===preference} disabled={userStatus.busy} onclick={()=>void chooseStatus(preference)}><span class="status-choice"><span class="status-dot" data-status={preference==='automatic'?'online':preference==='invisible'?'offline':preference} aria-hidden="true"></span>{preferenceLabels[preference]}</span></Button>{/each}
              <div class="menu-divider" role="separator"></div>
              <Button item checked={userStatus.sharePresence} disabled={userStatus.busy} onclick={()=>void sharePresence(!userStatus.sharePresence)}>Share activity</Button>
              {#if userStatus.error}<p class="status-help error" role="alert">{userStatus.error}</p>{/if}
            {/snippet}
          </Button>
          <div class="menu-divider" role="separator"></div>
          <Button item icon="user" href={profilePath(user.username)}>Profile</Button>
          <Button item icon="list" href="/lists">Your lists</Button>
          <Button item icon="request" href="/requests">Requests</Button>
          {#if page.data.experiments.planning}<Button item icon="list" href="/planning">Planning · experimental</Button>{/if}
          <div class="menu-divider" role="separator"></div>
          <Button item icon="settings" href="/settings">Settings</Button>
          {#if user.role === 'admin'}<Button item icon="shield" href="/settings/admin"
              >Admin</Button>{/if}
          <div class="menu-divider" role="separator"></div>
          <form method="POST" action="/logout">
            <button type="submit" class="menu-row menu-row-danger" role="menuitem" data-menu-keep-open
              ><Icon name="logout" /><span class="menu-action-label">Sign out</span></button
            >
          </form>{/snippet}</Button
      >
      {:else}<Button href="/login">Sign in</Button>{/if}
    </div>
  </div>
</header>

<style>
  .status-choice {display:inline-flex;align-items:center;gap:8px;}
  .status-help {padding:8px 12px;margin:0;font-size:var(--text-sm);color:var(--muted);max-width:240px;}
  header {
    position: fixed;
    inset: 0 0 auto;
    z-index: 80;
    background: linear-gradient(color-mix(in srgb, var(--canvas) calc(119 / 255 * 100%), transparent), transparent);
    pointer-events: none;
  }
  .header-inner {
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-inline: 24px;
  }
  .header-inner > * {
    pointer-events: auto;
  }
  .brand-home {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
  }
  header {
    transition:
      opacity var(--motion) var(--ease),
      visibility var(--motion);
  }
  header.chrome-hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }
  nav {
    position: absolute;
    left: 50%;
    translate: -50% 0;
  }
  .nav-icon{display:none;}
  nav a {
    gap: 8px;
    padding-inline: 18px;
    white-space: nowrap;
  }
  .account {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .avatar :global(.header-icon) { background:transparent; font:inherit; }
  .avatar {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }
  .notification {
    position: relative;
  }
  .friend-count{position:absolute;top:0;right:0;min-width:16px;height:16px;display:grid;place-items:center;padding-inline:3px;border-radius:8px;background:var(--accent);color:var(--canvas);font-size:var(--text-sm);font-weight:var(--weight-semibold);}
  .notification i {
    position: absolute;
    top: 9px;
    right: 9px;
    width: 5px;
    height: 5px;
    background: var(--accent);
    border-radius: 50%;
  }
  @media (max-width: 639px) {
    .header-inner {
      padding-inline: 20px;
    }
    nav {
      position: fixed;
      inset: auto 12px calc(env(safe-area-inset-bottom) + 12px);
      translate: none;
    }
    .nav-label{display:none;}
    .nav-icon{display:flex;}
    .nav-icon :global(svg path),.nav-icon :global(svg circle),.nav-icon :global(svg rect){stroke-width:2.5;}
    nav a {
      height:52px;
      flex: 1;
      min-width: 0;
      padding-inline: 12px;
    }
  }
</style>
