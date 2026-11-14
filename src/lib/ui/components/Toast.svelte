<script lang="ts">
  import { onMount } from 'svelte';
  import { cardArtwork } from '#lib/media/artwork.js';
  import { notificationToastDuration, type ToastArtwork } from '#lib/ui/controls/notification-toasts.js';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
  import Avatar from './Avatar.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  let {
    text, description, error, kind = 'info', busy = false, category, persistent = false,
    autoDismiss = false, actionLabel, onaction, onopen, ondismiss, onpause,
    dismissLabel = 'Dismiss message', actor, media, stampId, rich = false,
  }: {
    text: string; description?: string | null; error?: string; kind?: 'info' | 'error'; busy?: boolean;
    category?: string; persistent?: boolean; autoDismiss?: boolean;
    actionLabel?: string; onaction?: () => unknown; onopen?: () => void; ondismiss?: () => void;
    onpause?: (paused: boolean) => void; dismissLabel?: string;
    actor?: { username: string; avatar: string | null }; media?: ToastArtwork; stampId?: string; rich?: boolean;
  } = $props();

  const categories = {
    'friend-accepted': { label: 'Friends', icon: 'friends' },
    recommendation: { label: 'Recommendation', icon: 'star' },
    reaction: { label: 'Activity', icon: 'heart' },
    'synced-invite': { label: 'Party invitation', icon: 'party' },
    planning: { label: 'Planning', icon: 'clock' },
    request: { label: 'Request update', icon: 'request' },
    availability: { label: 'Library', icon: 'library' },
    sync: { label: 'Sync update', icon: 'refresh' },
    'external-action': { label: 'Connected service', icon: 'server' },
    administrator: { label: 'Administrator', icon: 'shield' },
  } as const;
  const source = $derived(category ? categories[category as keyof typeof categories] : undefined);
  const icon = $derived(busy ? 'clock' : source?.icon ?? (kind === 'error' ? 'shield' : 'check'));
  const label = $derived(busy ? 'In progress' : source?.label ?? (kind === 'error' ? 'Error' : actionLabel === 'Undo' ? 'Undo' : 'Info'));
  const square = $derived(media?.kind === 'album' || media?.kind === 'track');
  const shape = $derived(square ? 'square' : 'poster');
  const artwork = $derived(rich && media && cardArtwork(media, 'primary', shape).candidates.length ? {...media, href: null} : null);
  const mediaCard = $derived(artwork ? import('./MediaCard.svelte') : undefined);

  function placeStamp(key: string) {
    // Revisiting the same toast keeps its stamps in place.
    let seed = 2166136261;
    for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    seed >>>= 0;
    const tilt = (seed & 128 ? -1 : 1) * (4 + ((seed >>> 8) % 4));
    return {x: `${seed % 5 - 2}px`, y: `${(seed >>> 16) % 5 - 2}px`, tilt: `${tilt}deg`};
  }
  const avatarPlacement = $derived(placeStamp(`${stampId ?? text}:avatar`));
  const mediaPlacement = $derived(placeStamp(`${stampId ?? text}:media`));
  let hovered = $state(false), focused = $state(false), foreground = $state(true);
  const paused = $derived(hovered || focused || !foreground);
  const timed = $derived(!persistent && !busy && (autoDismiss || !!onpause));

  function material(node: HTMLElement, enabled: boolean) {
    let glass: ReturnType<typeof liquidGlass> | undefined;
    function update(useGlass: boolean) {
      if (useGlass) glass ??= liquidGlass(node, {variant: 'glassDark', renderer: 'css'});
      else { glass?.destroy(); glass = undefined; }
    }
    update(enabled);
    return {update, destroy: () => glass?.destroy()};
  }

  onMount(() => {
    if (!autoDismiss && !onpause) return;
    const visibility = () => foreground = document.visibilityState === 'visible';
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  });
  $effect(() => {
    const update = onpause;
    if (!paused) return;
    update?.(true);
    return () => update?.(false);
  });
  $effect(() => {
    const dismiss = ondismiss;
    if (!autoDismiss || persistent || busy || paused || !dismiss) return;
    const timer = setTimeout(dismiss, notificationToastDuration);
    return () => clearTimeout(timer);
  });
</script>

{#snippet copy()}
  <span class="toast-title">{text}</span>
  {#if description}<span class="toast-detail">{description}</span>{/if}
  {#if error}<span class="toast-detail text-danger">{error}</span>{/if}
{/snippet}

{#snippet dismissButton()}
  {#if ondismiss}<Button size="icon" icon="close" iconSize={16} label={dismissLabel} class="toast-dismiss" disabled={busy} onclick={ondismiss} />{/if}
{/snippet}

{#snippet actions()}
  {#if onaction || rich && (onopen || persistent && !busy || timed)}
    <div class="toast-actions">
      {#if onaction || onopen}
        <Button emphasis="subtle" class="toast-action" disabled={busy} onclick={() => { if (onaction) void onaction(); else onopen?.(); }}>{actionLabel ?? (onopen ? 'View' : 'Retry')}</Button>
      {/if}
      {#if rich && persistent && !busy}
        <span class="toast-persistent" role="img" aria-label="Stays visible until dismissed"><Icon name="bookmark" size={14} /></span>
      {:else if rich && timed}
        <span class="toast-timer" role="img" aria-label="Automatically dismisses">
          {#if !paused}<span></span>{/if}
        </span>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="toast" class:glass={rich} class:solid-surface={!rich} class:failed={kind === 'error' || category === 'external-action'}
  class:important={persistent || busy} class:local={!category} class:linked={!!onopen}
  use:material={rich}
  role="group" aria-busy={busy || undefined}
  onpointerenter={event => { if (event.pointerType === 'mouse') hovered = true; }}
  onpointerleave={() => hovered = false}
  onfocusin={() => focused = true}
  onfocusout={event => focused = event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)}
  style:--toast-duration={`${notificationToastDuration}ms`}>
  {#if rich}
    <div class="toast-head">
      <span class="toast-source"><Icon name={icon} size={14} />{label}</span>
      {@render dismissButton()}
    </div>
    <div class="toast-copy" role={kind === 'error' ? 'alert' : 'status'}>{@render copy()}</div>
    {@render actions()}
  {:else}
    <div class="toast-standard-copy">
      <div role={kind === 'error' ? 'alert' : 'status'}>
        {#if onopen}<button class="toast-copy toast-open" onclick={onopen}>{@render copy()}</button>
        {:else}<div class="toast-copy">{@render copy()}</div>{/if}
      </div>
      {@render actions()}
    </div>
    {@render dismissButton()}
  {/if}
  {#if rich && actor}
    <span class="toast-avatar" aria-hidden="true" style:--stamp-x={avatarPlacement.x} style:--stamp-y={avatarPlacement.y} style:--stamp-tilt={avatarPlacement.tilt}>
      <Avatar name={actor.username} src={actor.avatar} size={44} />
    </span>
  {/if}
  {#if artwork && mediaCard}
    <div class="toast-artwork" aria-hidden="true" style:--stamp-x={mediaPlacement.x} style:--stamp-y={mediaPlacement.y} style:--stamp-tilt={mediaPlacement.tilt}>
      {#await mediaCard then {default: MediaCard}}<MediaCard item={artwork} {shape} artworkOnly />{:catch}{/await}
    </div>
  {/if}
</div>

<style>
  .toast {
    --toast-accent: var(--accent);
    min-inline-size: 0;
    border-radius: var(--toast-radius, 18px);
    padding: 16px;
    animation: toast-arrive var(--motion) var(--ease) both;
    pointer-events: auto;
  }
  .toast.solid-surface { display: flex; align-items: flex-start; gap: 10px; border-radius: 16px; }
  .toast-standard-copy { flex: 1; min-width: 0; }
  .toast-open { text-align: start; color: inherit; }
  .toast.solid-surface .toast-title { font-size: var(--text-sm); }
  .toast.local { --toast-accent: var(--success); }
  .toast.important { --toast-accent: var(--rating); }
  .toast.failed { --toast-accent: var(--danger); }
  @keyframes toast-arrive {
    from { opacity: 0; transform: translateY(6px) scale(.985); }
    to { opacity: 1; transform: none; }
  }
  .toast-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 24px; margin-block-end: 4px; }
  .toast-source { display: inline-flex; align-items: center; gap: 6px; color: var(--toast-accent); font-size: var(--text-sm); font-weight: var(--weight-semibold); line-height: var(--leading-tight); }
  .toast-source :global(svg) { flex: none; }
  .toast-copy { display: grid; gap: 3px; overflow-wrap: anywhere; }
  .toast-title { color: var(--ink); font-size: var(--text-md); font-weight: var(--weight-semibold); line-height: var(--leading-tight); }
  .toast.glass .toast-title { letter-spacing: var(--tracking-tight); }
  .toast-detail { color: var(--muted); font-size: var(--text-sm); line-height: var(--leading-normal); }
  .toast.linked .toast-detail { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
  .toast-detail.text-danger { color: var(--danger); }
  .toast-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-block-start: 8px; }
  .toast.glass :global(.toast-action) {
    min-height: var(--control-compact-height);
    border-radius: 999px;
    background: color-mix(in srgb, var(--toast-accent) 12%, var(--surface));
    color: var(--toast-accent);
  }
  .toast.glass :global(.toast-action:hover:not(:disabled)) { background: color-mix(in srgb, var(--toast-accent) 23%, var(--surface)); color: var(--ink); }
  .toast :global(.toast-dismiss) { flex: none; inline-size: 24px; block-size: 24px; min-inline-size: 0; min-block-size: 0; position: relative; }
  .toast-persistent { display: inline-flex; color: var(--muted); }
  .toast-timer { display: block; inline-size: 32px; block-size: 2px; border-radius: 999px; background: var(--line); }
  .toast-timer > span {
    display: block;
    block-size: 100%;
    border-radius: inherit;
    background: var(--toast-accent);
    transform-origin: left;
    animation: toast-expiry var(--toast-duration) linear forwards;
  }
  @keyframes toast-expiry { to { transform: scaleX(0); } }
  .toast-avatar, .toast-artwork {
    position: absolute;
    z-index: 4;
    pointer-events: none;
    transform: translate(var(--stamp-x), var(--stamp-y)) rotate(var(--stamp-tilt));
  }
  .toast-avatar {
    inset-block-start: -9px;
    inset-inline-start: -17px;
    border-radius: 50%;
    box-shadow: var(--elevation-raised);
    outline: 2px solid var(--surface);
  }
  .toast-artwork {
    inset-block-end: -9px;
    inset-inline-end: -17px;
    inline-size: 58px;
  }
  .toast-artwork :global(.art) { border-radius: 8px; box-shadow: var(--elevation-raised); }
  @media (max-width: 380px) {
    .toast-artwork { inline-size: 53px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast, .toast-timer > span { animation: none; }
  }
  @media (pointer: coarse) {
    .toast :global(.toast-dismiss)::before { content: ''; position: absolute; inset: -10px; }
  }
</style>
