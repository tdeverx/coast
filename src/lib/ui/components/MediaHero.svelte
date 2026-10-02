<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { blackFadeGradient } from '$lib/ui/materials/black-fade';
  import type { MediaView } from '$lib/ui/types';
  import { createHeroPresentation, screenItem, type HeroItem } from '$lib/ui/heroes/presentation.svelte';
  import { createHeroPlayback } from '$lib/ui/heroes/playback.svelte';
  import { setHeroMuted } from '$lib/playback/client.svelte';
  import { usePlayback } from '$lib/playback/context.svelte';
  import MediaActions from './MediaActions.svelte';
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';

  const { heroPlayer, preview } = usePlayback();

  let {
    mode = 'content',
    item,
    collection,
    parents = [],
    items = [],
    context = 'details',
    next = null,
    requestable = false,
    actions,
  }: {
    mode?: 'content' | 'player';
    item?: HeroItem;
    collection?: { items: MediaView[]; selection: string; busy?: boolean };
    actions?: Snippet;
    parents?: MediaView[];
    items?: HeroItem[];
    context?: 'discover' | 'details' | 'home';
    next?: MediaView | null;
    requestable?: boolean;
  } = $props();
  // These roles have different lifetimes: the root owns playback, routes own content.
  const playback = untrack(() => mode === 'player' ? createHeroPlayback() : undefined);
  const hero = untrack(() => mode === 'content' ? createHeroPresentation(() => ({ item, items, parents, collection })) : undefined);
</script>

{#if playback}
<div class="hero-player" class:visible={playback.visible} style={playback.surfaceStyle} aria-hidden="true">
  <video bind:this={playback.video} data-player="hero" muted={heroPlayer.muted} playsinline preload="metadata" tabindex="-1"
    class:positioned={!!playback.videoStyle} style={playback.videoStyle}
    onloadedmetadata={playback.loadedMetadata}
    onplaying={() => (heroPlayer.playing = true)}
    onpause={() => (heroPlayer.playing = false)}
    onended={() => { heroPlayer.playing = false; heroPlayer.paused = true; }}
    onerror={playback.failed}
  ></video>
</div>



{:else if hero && hero.active && hero.presentation}<section
  class="hero"
  class:fading={hero.fading}
  bind:this={hero.host}
  data-hero-id={hero.active.id}
  aria-label={hero.active.title}
  onfocusin={() => {
    hero.controlFocused = true;
    hero.noteActivity();
  }}
  onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      hero.controlFocused = false;
      hero.noteActivity();
    }
  }}
  style:--hero-fade={blackFadeGradient('bottom')}
>
  <div class="art" class:video-visible={hero.showingTrailer}>
    {#key hero.active.id}{#if hero.active.backdrop && !hero.backdropFailed}<img
          src={hero.active.backdrop}
          alt=""
          fetchpriority="high"
          onerror={() => (hero.backdropFailed = true)}
        />{:else if hero.active.poster && !hero.posterFailed}<img
          class="poster-art"
          src={hero.active.poster}
          alt=""
          onerror={() => (hero.posterFailed = true)}
        />{/if}{/key}
  </div>
  <div class="gradient" class:dimmed={hero.chromeDimmed} aria-hidden="true"></div>
  <div class="content hero-inner" class:dimmed={hero.chromeDimmed}>
    <div class="hero-copy">
      <h1 class:sr-only={hero.titleLogo && !hero.logoFailed}>{hero.presentation.title}</h1>
      {#if hero.titleLogo && !hero.logoFailed}<div class="title-artwork">
          <img class="title-logo" src={hero.titleLogo} alt="" onerror={() => (hero.logoFailed = true)} />
        </div>{/if}
      {#if parents.length}<nav class="genres hero-path" aria-label="Show, season and episode">
          {#each parents as parent}<a href={`/media/${parent.id}`}
              >{parent.kind === 'show' ? 'Show' : parent.title}</a
            ><span aria-hidden="true">›</span>{/each}<span aria-current="page">{hero.active.title}</span>
        </nav>{:else if hero.active.genres?.length}<div class="genres">
          {#each hero.active.genres.slice(0, 4) as genre}{#if screenItem(hero.active)}<a
                href={`/library?scope=all&genre=${encodeURIComponent(genre)}`}>{genre}</a
              >{:else}<span>{genre}</span>{/if}{/each}
        </div>{/if}
      <div class="metadata">
        {#if hero.active.kind === 'episode'}<span
            >S{String(hero.active.seasonNumber ?? 0).padStart(2, '0')}E{String(
              hero.active.episodeNumber ?? 0
            ).padStart(2, '0')}</span
          >{/if}
        {#if !screenItem(hero.active)}<span>{hero.active.captionSubtitle}</span>{/if}
        {#if hero.active.year}<span>{hero.active.year}</span>{/if}
        {#if hero.active.certification}<span>{hero.active.certification}</span>{/if}
        {#if hero.active.runtimeMinutes}<span>{hero.active.runtimeMinutes} min</span>{/if}
      </div>
      {#if hero.active.overview}<p class="overview">{hero.active.overview}</p>{/if}
    </div>
    <div class="hero-action-row">
      {#if actions}{@render actions()}
      {:else if screenItem(hero.active)}<MediaActions
          item={hero.active}
          {context}
          {next}
          {requestable}
          hero
        />
      {:else}<Button href={hero.active.href} variant="hero">View {hero.active.kind}</Button>{/if}
      {#if items.length > 1 || hero.hasTrailer}<div class="hero-pagination">
          {#if hero.hasTrailer}<button
              class="icon-button"
              aria-label={heroPlayer.playing ? 'Pause trailer' : 'Play trailer'}
              onclick={() => (heroPlayer.paused = !heroPlayer.paused)}
              ><Icon name={heroPlayer.playing ? 'pause' : 'play'} size={18} /></button
            ><button
              class="icon-button"
              aria-label={heroPlayer.muted ? 'Unmute trailer' : 'Mute trailer'}
              onclick={() => preview ? heroPlayer.muted = !heroPlayer.muted : setHeroMuted(!heroPlayer.muted)}
              ><Icon name={heroPlayer.muted ? 'muted' : 'volume'} size={18} /></button
            >{/if}{#if items.length > 1}<span
              >{String(hero.current + 1).padStart(2, '0')}<i>/</i>{String(items.length).padStart(
                2,
                '0'
              )}</span
            ><button
              class="icon-button"
              aria-label="Previous featured title"
              onclick={() => hero.step(-1)}><Icon name="left" size={18} /></button
            ><button class="icon-button" aria-label="Next featured title" onclick={() => hero.step(1)}
              ><Icon name="right" size={18} /></button
            >{/if}
        </div>{/if}
    </div>
  </div>
</section>{/if}

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
    background: var(--surface);
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
    font-size: var(--text-hero);
    line-height: var(--leading-solid);
    letter-spacing: var(--tracking-tight);
    font-weight: var(--weight-bold);
    text-wrap: balance;
  }
  .metadata {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    column-gap: 20px;
    row-gap: 8px;
    color: color-mix(in srgb, var(--white) 90%, transparent);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
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
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    color: color-mix(in srgb, var(--white) 90%, transparent);
  }
  .overview {
    font-size: var(--text-md);
    line-height: var(--leading-relaxed);
    color: color-mix(in srgb, var(--white) 75%, transparent);
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
    font-size: var(--text-sm);
    letter-spacing: var(--tracking-wide);
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
      font-size: var(--text-hero-mobile);
    }
    .hero-pagination > span {
      display: none;
    }
    .gradient::after {
      height: 112px;
    }
    .metadata,
    .genres {
      font-size: var(--text-md);
    }
    .title-artwork {
      height: 144px;
      max-width: 100%;
    }
    .overview {
      font-size: var(--text-md);
      line-clamp: 3;
      -webkit-line-clamp: 3;
    }
  }

  .hero-player { position: fixed; z-index: 1; overflow: hidden; pointer-events: none; visibility: hidden; }
  .hero-player.visible { visibility: visible; }
  video { position: absolute; width: 100%; height: 100%; object-fit: cover; }
  video.positioned { max-width: none; object-fit: fill; }

</style>
