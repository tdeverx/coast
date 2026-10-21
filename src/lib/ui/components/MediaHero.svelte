<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import { blackFadeGradient } from '#lib/ui/materials/black-fade.js';
  import type { MediaView } from '#lib/ui/types.js';
  import { createHeroPresentation, screenItem, type HeroItem } from '#lib/ui/heroes/presentation.svelte.js';
  import { createHeroPlayback } from '#lib/ui/heroes/playback.svelte.js';
  import { setHeroMuted } from '#lib/playback/client.svelte.js';
  import { usePlayback } from '#lib/playback/context.svelte.js';
  import WorkMenu from './WorkMenu.svelte';
  import Button from './Button.svelte';

  const { heroPlayer, preview } = usePlayback();

  let {
    item,
    collection,
    parents = [],
    items = [],
    context = 'details',
    next = null,
    requestable = false,
    actions,editionName,alignment='left',
  }: {
    editionName?:string;alignment?:'left'|'center'|'adaptive';
    item?: HeroItem;
    collection?: { items: HeroItem[]; selection: string; busy?: boolean };
    actions?: Snippet;
    parents?: MediaView[];
    items?: HeroItem[];
    context?: 'discover' | 'details' | 'home';
    next?: MediaView | null;
    requestable?: boolean;
  } = $props();
  const hero = untrack(() => createHeroPresentation(() => ({ item, items, parents, collection })));
  const playback = untrack(() => createHeroPlayback(() => ({id:hero.active?.id,active:(hero.phase==='artwork'||hero.phase==='trailer')&&hero.attached,size:hero.size})));
</script>

{#if hero.active && hero.presentation}<section
  class="hero"
  data-alignment={alignment}
  class:fading={hero.fading}
  bind:this={hero.host}
  data-hero-id={hero.active.id}
  data-hero-phase={hero.phase}
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
  style:--hero-fade={blackFadeGradient('bottom','var(--detail-background, #000)')}
>
  <div class="hero-video" class:visible={playback.visible && heroPlayer.ready} aria-hidden="true">
    <video bind:this={playback.video} data-player="hero" muted={heroPlayer.muted} playsinline preload="auto" tabindex="-1"
      class:positioned={!!playback.videoStyle} style={playback.videoStyle}
      onloadedmetadata={playback.loadedMetadata}
      onresize={playback.loadedMetadata}
      onplaying={playback.playing}
      onpause={playback.paused}
      onended={playback.ended}
      onerror={playback.failed}
    ></video>
  </div>
  <div class="art" class:video-visible={hero.showingTrailer && !hero.paused}>
    {#key hero.active.id}<div class="artwork" transition:fade={{duration:hero.transitionDuration}}>{#if hero.active.backdrop && !hero.backdropFailed}<img
          src={hero.active.backdrop}
          alt=""
          fetchpriority="high"
          onerror={() => (hero.backdropFailed = true)}
        />{:else if hero.active.poster && !hero.posterFailed}<img
          class="poster-art"
          src={hero.active.poster}
          alt=""
          onerror={() => (hero.posterFailed = true)}
        />{/if}</div>{/key}
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
        {#if hero.active.durationLabel}<span>{hero.active.durationLabel}</span>{:else if hero.active.runtimeMinutes}<span>{hero.active.runtimeMinutes} min</span>{/if}
      </div>
      {#if hero.active.overview}<p class="overview">{hero.active.overview}</p>{/if}
    </div>
    <div class="hero-action-row">
      <div class="hero-item-actions">{#if actions}{@render actions()}
      {:else}{#key hero.active.id}{#if screenItem(hero.active)}<WorkMenu
          item={hero.active}
          {editionName}
          {context}
          next={hero.active.id===(items[0]?.id??item?.id)?next:null}
          {requestable}
          hero
        />
      {:else}<WorkMenu item={hero.active} hero showTrigger />{/if}{/key}{/if}</div>
      <div class="hero-pagination page-navigation">
          {#if items.length > 1}<Button size="icon"
              label="Previous featured title"
              onclick={() => hero.step(-1)} icon="left" iconSize={20} />{/if}
          <Button size="icon"
              label={`${hero.paused ? 'Play' : 'Pause'} ${hero.phase === 'trailer' ? 'trailer' : 'hero'}`}
              onclick={hero.togglePlayback}
              icon={hero.paused ? 'play' : 'pause'} iconSize={20} /><Button size="icon"
              label={heroPlayer.muted ? 'Unmute trailer' : 'Mute trailer'}
              onclick={() => preview ? heroPlayer.muted = !heroPlayer.muted : setHeroMuted(!heroPlayer.muted)}
              icon={heroPlayer.muted ? 'muted' : 'volume'} iconSize={20} />
          {#if items.length > 1}<Button size="icon"
              label="Next featured title"
              onclick={() => hero.step(1)} icon="right" iconSize={20} />{/if}
        </div>
    </div>
  </div>
</section>{/if}

<style>
  .hero-copy,
  .hero-item-actions {
    transition: opacity var(--fast) var(--ease);
  }
  .fading .hero-copy,
  .fading .hero-item-actions {
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
  .hero[data-alignment='center'],.hero[data-alignment='adaptive'] {--hero-center:1;--hero-copy-align:center;}
  .hero[data-alignment='adaptive'] {--hero-center:calc(1 - var(--detail-expansion,1));--hero-copy-align:var(--detail-hero-text-align,left);}
  .hero:not([data-alignment='left']) .hero-copy {width:100%;margin-inline-start:calc((100% - min(100%,768px)) * 0.5 * var(--hero-center));text-align:var(--hero-copy-align);}
  .hero:not([data-alignment='left']) :is(h1:not(.sr-only),.title-artwork,.genres,.metadata,.overview,.hero-action-row) {position:relative;max-width:100%;left:calc(50% * var(--hero-center));transform:translateX(calc(-50% * var(--hero-center)));}
  .hero:not([data-alignment='left']) :is(h1:not(.sr-only),.genres,.metadata,.hero-action-row) {width:fit-content;}
  .hero:not([data-alignment='left']) .title-artwork {width:min(544px,100%);justify-content:var(--hero-copy-align);}
  .hero:not([data-alignment='left']) .title-logo {object-position:calc(50% * var(--hero-center)) bottom;}
  .hero:not([data-alignment='left']) .overview {width:min(672px,100%);}
  .hero:not([data-alignment='left']) :is(.genres,.metadata,.hero-action-row) {justify-content:var(--hero-copy-align);}
  .art {
    position: absolute;
    inset: 0;
    z-index: -2;
    overflow: hidden;
    background: var(--surface);
    transition: opacity var(--cinematic);
  }
  .art.video-visible {
    opacity: 0;
  }
  .artwork {position:absolute;inset:0;}
  .art img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
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
  .hero-item-actions {display:flex;align-items:center;gap:12px;}
  .hero-pagination {
    margin-left: auto;
  }
  @media (min-width: 640px) and (max-width: 1023px) {
    .hero-inner {
      padding-bottom: 40px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hero-copy,
    .hero-item-actions,
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

  .hero-video { position: absolute; inset: 0; z-index: -3; overflow: hidden; pointer-events: none; visibility: hidden; }
  .hero-video.visible { visibility: visible; }
  video { position: absolute; width: 100%; height: 100%; object-fit: cover; }
  video.positioned { max-width: none; object-fit: fill; }

</style>
