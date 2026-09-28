<script lang="ts">
  import { profilePath } from '$lib/profile/url';
  import { page } from '$app/state';
  import Icon from './Icon.svelte';
  import Brand from './Brand.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  import { player } from '$lib/playback/client.svelte';
  import { slidingPill } from '$lib/ui/materials/sliding-pill';
  import { liquidGlass } from '$lib/ui/materials/glass';
  let { user, unread = 0 }: { user: { username: string; role: string }; unread?: number } =
    $props();
  const nav: { label: string; href: string }[] = [
    { label: 'For You', href: '/for-you' },
    { label: 'Library', href: '/library' },
    { label: 'Discover', href: '/discover' },
    { label: 'Search', href: '/search' },
  ];
</script>

<a class="skip" href="#main-content">Skip to content</a>
<header
  class:chrome-hidden={!!player.session && !player.paused && !player.controlsVisible}
  inert={!!player.session && !player.paused && !player.controlsVisible}
>
  <div class="header-inner content">
    <a class="brand-home" href="/for-you" aria-label="Coast home"><Brand compact size={44} /></a>
    <nav
      use:liquidGlass
      use:slidingPill
      class="glass segmented-control"
      aria-label="Primary navigation"
    >
      {#each nav as item}<a
          href={item.href}
          class:active={page.url.pathname === item.href}
          aria-current={page.url.pathname === item.href ? 'page' : undefined}
          aria-label={item.label}><span>{item.label}</span></a
        >{/each}
    </nav>
    <div class="account">
      <a
        class="icon-button notification"
        href="/notifications"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        ><Icon name="bell" size={21} />{#if unread}<i></i>{/if}</a
      ><ContextMenu label="Account menu"
        >{#snippet trigger()}<span class="avatar">{user.username.slice(0, 1).toUpperCase()}</span
          >{/snippet}{#snippet children()}
          <MenuAction icon="user" href={profilePath(user.username)}>Your profile</MenuAction>
          <MenuAction icon="list" href="/lists">Your lists</MenuAction>
          <MenuAction icon="request" href="/requests">Requests</MenuAction>
          <div class="menu-divider" role="separator"></div>
          <MenuAction icon="settings" href="/settings">Settings</MenuAction>
          {#if user.role === 'admin'}<MenuAction icon="shield" href="/settings/admin"
              >Admin</MenuAction
            >{/if}
          <div class="menu-divider" role="separator"></div>
          <form method="POST" action="/logout">
            <button class="menu-row menu-row-danger" role="menuitem"
              ><Icon name="logout" /><span class="menu-action-label">Sign out</span></button
            >
          </form>{/snippet}</ContextMenu
      >
    </div>
  </div>
</header>

<style>
  header {
    position: fixed;
    inset: 0 0 auto;
    z-index: 80;
    background: linear-gradient(#0007, transparent);
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
    transform: translateX(-50%);
  }
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
  .avatar {
    font-size: 12px;
    font-weight: 650;
  }
  .notification {
    position: relative;
  }
  .notification i {
    position: absolute;
    top: 9px;
    right: 9px;
    width: 5px;
    height: 5px;
    background: var(--accent);
    border-radius: 50%;
  }
  .skip {
    position: fixed;
    top: -60px;
    left: 20px;
    z-index: 300;
    background: var(--ink);
    color: var(--canvas);
    padding: 12px;
    border-radius: 8px;
  }
  .skip:focus {
    top: 10px;
  }
  @media (max-width: 639px) {
    .header-inner {
      padding-inline: 20px;
    }
    nav {
      position: fixed;
      inset: auto 12px calc(env(safe-area-inset-bottom) + 12px);
      transform: none;
    }
    nav a {
      flex: 1;
      min-width: 0;
      padding-inline: 12px;
    }
  }
</style>
