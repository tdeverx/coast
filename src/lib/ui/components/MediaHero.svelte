<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import { blackFadeGradient } from '$lib/ui/materials/black-fade';
  import { api } from '$lib/ui/client';
  import type { MediaView, MediaHeroPresentation } from '$lib/ui/types';
  import { heroPlayer, presentTrailer, setHeroMuted } from '$lib/playback/client.svelte';
  import MediaActions from './MediaActions.svelte';
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';
  type HeroItem = MediaView | MediaHeroPresentation;
  function screenItem(item: HeroItem): item is MediaView {
    return 'available' in item;
  }
  let {
    item,
    parents = [],
    items = [],
    context = 'details',
    next = null,
    requestable = false,
    actions,
  }: {
    item: HeroItem;
    actions?: Snippet;
    parents?: MediaView[];
    items?: HeroItem[];
    context?: 'discover' | 'details' | 'home';
    next?: MediaView | null;
    requestable?: boolean;
  } = $props();
  let current = $state(0),
    host: HTMLElement,
    backdropFailed = $state(false),
    posterFailed = $state(false),
    logoFailed = $state(false),
    fading = $state(false),
    gestureLocked = false,
    gestureDistance = 0,
    gestureTimer: ReturnType<typeof setTimeout>;
  const active = $derived(items.length ? items[current % items.length] : item);
  const presentation = $derived(parents.find((parent) => parent.kind === 'show') ?? active);
  const titleLogo = $derived(active.logo ?? presentation.logo);
  const hasTrailer = $derived(heroPlayer.id === active.id && !!heroPlayer.url);
  const showingTrailer = $derived(
    hasTrailer && heroPlayer.playing && heroPlayer.ready && heroPlayer.visible
  );
  let mouseIdle = $state(false);
  let controlFocused = $state(false);
  let idleTimer: ReturnType<typeof setTimeout>;
  const chromeDimmed = $derived(showingTrailer && mouseIdle && !controlFocused);
  function noteActivity(event?: PointerEvent) {
    if (event && event.pointerType !== 'mouse') return;
    clearTimeout(idleTimer);
    mouseIdle = false;
    idleTimer = setTimeout(() => (mouseIdle = true), 2200);
  }
  async function step(by: number) {
    if (fading || items.length < 2) return;
    fading = true;
    await new Promise((resolve) => setTimeout(resolve, 160));
    current = (current + by + items.length) % items.length;
    backdropFailed = false;
    posterFailed = false;
    logoFailed = false;
    fading = false;
  }
  function wheel(e: WheelEvent) {
    if (items.length < 2 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    e.preventDefault();
    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => {
      gestureLocked = false;
      gestureDistance = 0;
    }, 220);
    if (gestureLocked) return;
    gestureDistance += e.deltaX;
    if (Math.abs(gestureDistance) < 45) return;
    gestureLocked = true;
    void step(gestureDistance > 0 ? 1 : -1);
  }
  $effect(() => {
    const title = active;
    backdropFailed = false;
    posterFailed = false;
    logoFailed = false;
    if (!host || !screenItem(title) || (!title.available && !title.trailer)) return;
    let visible = true,
      cancelled = false,
      delayPassed = false,
      attaching = false;
    const existing = untrack(() => (heroPlayer.id === title.id ? heroPlayer.url : null));
    const attach = async () => {
      if (
        cancelled ||
        attaching ||
        !visible ||
        document.hidden ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        return;
      attaching = true;
      const url =
        existing ||
        title.trailer ||
        (
          await api<{ url: string | null }>(`media/${title.id}/trailer`, undefined, 'GET').catch(
            () => ({ url: null })
          )
        ).url;
      attaching = false;
      if (url && !cancelled && visible) presentTrailer(title.id, url, host.getBoundingClientRect());
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        if (heroPlayer.id === title.id) heroPlayer.visible = visible;
        if (visible && delayPassed) void attach();
      },
      { threshold: 0.3 }
    );
    observer.observe(host);
    const timer = setTimeout(
      () => {
        delayPassed = true;
        void attach();
      },
      existing ? 0 : 3000
    );
    const reposition = () => {
      if (heroPlayer.id === title.id) heroPlayer.rect = host.getBoundingClientRect();
    };
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
      requestAnimationFrame(() => {
        if (heroPlayer.id === title.id && !document.querySelector(`[data-hero-id="${title.id}"]`))
          heroPlayer.visible = false;
      });
    };
  });
  onMount(() => {
    host.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('pointermove', noteActivity);
    noteActivity();
    const shell = host.closest<HTMLElement>('.page-shell');
    const resize = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      shell?.style.setProperty('--active-hero-height', `${rect.height}px`);
      if (heroPlayer.id === active.id) heroPlayer.rect = rect;
    });
    resize.observe(host);
    return () => {
      host.removeEventListener('wheel', wheel);
      document.removeEventListener('pointermove', noteActivity);
      clearTimeout(idleTimer);
      clearTimeout(gestureTimer);
      resize.disconnect();
      shell?.style.removeProperty('--active-hero-height');
    };
  });
</script>

<section
  class="hero"
  class:fading
  bind:this={host}
  data-hero-id={active.id}
  aria-label={active.title}
  onfocusin={() => {
    controlFocused = true;
    noteActivity();
  }}
  onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      controlFocused = false;
      noteActivity();
    }
  }}
  style:--hero-fade={blackFadeGradient('bottom')}
>
  <div class="art" class:video-visible={showingTrailer}>
    {#key active.id}{#if active.backdrop && !backdropFailed}<img
          src={active.backdrop}
          alt=""
          fetchpriority="high"
          onerror={() => (backdropFailed = true)}
        />{:else if active.poster && !posterFailed}<img
          class="poster-art"
          src={active.poster}
          alt=""
          onerror={() => (posterFailed = true)}
        />{/if}{/key}
  </div>
  <div class="gradient" class:dimmed={chromeDimmed} aria-hidden="true"></div>
  <div class="content hero-inner" class:dimmed={chromeDimmed}>
    <div class="hero-copy">
      <h1 class:sr-only={titleLogo && !logoFailed}>{presentation.title}</h1>
      {#if titleLogo && !logoFailed}<div class="title-artwork">
          <img class="title-logo" src={titleLogo} alt="" onerror={() => (logoFailed = true)} />
        </div>{/if}
      {#if parents.length}<nav class="genres hero-path" aria-label="Show, season and episode">
          {#each parents as parent}<a href={`/media/${parent.id}`}
              >{parent.kind === 'show' ? 'Show' : parent.title}</a
            ><span aria-hidden="true">›</span>{/each}<span aria-current="page">{active.title}</span>
        </nav>{:else if active.genres?.length}<div class="genres">
          {#each active.genres.slice(0, 4) as genre}{#if screenItem(active)}<a
                href={`/library?scope=all&genre=${encodeURIComponent(genre)}`}>{genre}</a
              >{:else}<span>{genre}</span>{/if}{/each}
        </div>{/if}
      <div class="metadata">
        {#if active.kind === 'episode'}<span
            >S{String(active.seasonNumber ?? 0).padStart(2, '0')}E{String(
              active.episodeNumber ?? 0
            ).padStart(2, '0')}</span
          >{/if}
        {#if !screenItem(active)}<span>{active.captionSubtitle}</span>{/if}
        {#if active.year}<span>{active.year}</span>{/if}
        {#if active.certification}<span>{active.certification}</span>{/if}
        {#if active.runtimeMinutes}<span>{active.runtimeMinutes} min</span>{/if}
      </div>
      {#if active.overview}<p class="overview">{active.overview}</p>{/if}
    </div>
    <div class="hero-action-row">
      {#if actions}{@render actions()}
      {:else if screenItem(active)}<MediaActions
          item={active}
          {context}
          {next}
          {requestable}
          hero
        />
      {:else}<Button href={active.href} variant="hero">View {active.kind}</Button>{/if}
      {#if items.length > 1 || hasTrailer}<div class="hero-pagination">
          {#if hasTrailer}<button
              class="icon-button"
              aria-label={heroPlayer.playing ? 'Pause trailer' : 'Play trailer'}
              onclick={() => (heroPlayer.paused = !heroPlayer.paused)}
              ><Icon name={heroPlayer.playing ? 'pause' : 'play'} size={18} /></button
            ><button
              class="icon-button"
              aria-label={heroPlayer.muted ? 'Unmute trailer' : 'Mute trailer'}
              onclick={() => setHeroMuted(!heroPlayer.muted)}
              ><Icon name={heroPlayer.muted ? 'muted' : 'volume'} size={18} /></button
            >{/if}{#if items.length > 1}<span
              >{String(current + 1).padStart(2, '0')}<i>/</i>{String(items.length).padStart(
                2,
                '0'
              )}</span
            ><button
              class="icon-button"
              aria-label="Previous featured title"
              onclick={() => step(-1)}><Icon name="left" size={18} /></button
            ><button class="icon-button" aria-label="Next featured title" onclick={() => step(1)}
              ><Icon name="right" size={18} /></button
            >{/if}
        </div>{/if}
    </div>
  </div>
</section>

<style>
  .hero-copy,
  .art {
    transition: opacity var(--fast) var(--ease);
  }
  .fading .hero-copy,
  .fading .art {
    opacity: 0;
  }
  .title-artwork {
    height: 176px;
    max-width: 544px;
    display: flex;
    align-items: flex-end;
  }
  .title-logo {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    object-position: left bottom;
  }
  .hero {
    min-height: var(--hero-height);
    position: relative;
    isolation: isolate;
    background: transparent;
  }
  .art {
    position: absolute;
    inset: 0;
    z-index: -3;
    overflow: hidden;
    background: #111722;
    transition: opacity var(--cinematic);
  }
  .art.video-visible {
    opacity: 0;
  }
  .art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    animation: appear var(--cinematic) var(--ease);
  }
  .art img.poster-art {
    object-position: center 35%;
    filter: blur(18px);
    opacity: 0.4;
    transform: scale(1.07);
  }
  .gradient {
    position: absolute;
    inset: 0;
    z-index: -1;
  }
  .gradient::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--hero-fade);
    transition: opacity var(--cinematic) var(--ease);
  }
  .gradient.dimmed::before {
    opacity: 0;
  }
  .hero-inner.dimmed {
    opacity: 0.5;
  }
  .gradient::after {
    content: '';
    position: absolute;
    inset: auto 0 0;
    height: 144px;
    background: var(--hero-fade);
  }
  .hero-inner {
    transition: opacity var(--cinematic) var(--ease);
    min-height: var(--hero-height);
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding-inline: var(--hero-gutter);
    padding-bottom: 48px;
    padding-top: 112px;
  }
  .hero-copy {
    max-width: 768px;
  }
  .hero h1 {
    font-size: 58px;
    line-height: 1;
    letter-spacing: -0.025em;
    font-weight: 800;
    text-wrap: balance;
  }
  .metadata {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    column-gap: 20px;
    row-gap: 8px;
    color: rgb(255 255 255 / 90%);
    font-size: 16px;
    font-weight: 700;
    margin-top: 10px;
  }
  .genres a:hover {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .hero-path {
    flex-wrap: wrap;
  }
  .genres {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    margin-top: 28px;
    font-size: 16px;
    font-weight: 700;
    color: rgb(255 255 255 / 90%);
  }
  .overview {
    font-size: 16px;
    line-height: 1.625;
    color: rgb(255 255 255 / 75%);
    max-width: 672px;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-top: 12px;
  }
  .hero-action-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    width: 100%;
    margin-top: 28px;
  }
  .hero-pagination {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .hero-pagination > span {
    font-size: 9px;
    letter-spacing: 0.08em;
    margin-right: 12px;
  }
  .hero-pagination i {
    font-style: normal;
    padding: 0 12px;
    color: var(--quiet);
  }
  @media (min-width: 640px) and (max-width: 1023px) {
    .hero-inner {
      padding-bottom: 40px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hero-copy,
    .hero-inner,
    .gradient::before,
    .art {
      transition: none;
    }
    .art img {
      animation: none;
    }
  }
  @media (max-width: 639px) {
    .hero-inner {
      padding-bottom: 32px;
      padding-top: 112px;
    }
    .hero-copy {
      max-width: 100%;
    }
    .hero h1 {
      font-size: 34px;
    }
    .hero-pagination > span {
      display: none;
    }
    .gradient::after {
      height: 112px;
    }
    .metadata,
    .genres {
      font-size: 14px;
    }
    .title-artwork {
      height: 144px;
      max-width: 100%;
    }
    .overview {
      font-size: 14px;
      line-clamp: 3;
      -webkit-line-clamp: 3;
    }
  }
</style>
