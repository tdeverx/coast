<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import { blackFadeGradient } from '#lib/ui/materials/black-fade.js';
  import type { MediaView } from '#lib/ui/types.js';
  import { createHeroPresentation, screenItem, type HeroItem } from '#lib/ui/heroes/presentation.svelte.js';
  import { createHeroPlayback } from '#lib/ui/heroes/playback.svelte.js';
  import { setHeroMuted } from '#lib/playback/client.svelte.js';
  import { usePlayback } from '#lib/playback/context.svelte.js';
  import { provideRetention } from '#lib/ui/retention.js';
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
    identity, logoCard, titleField, overviewField, moveBackground, segments, size = 'standard',
  }: {
    editionName?:string;alignment?:'left'|'center'|'adaptive';
    item?: HeroItem;
    identity?: { id: string; title: string; subtitle?: string; description?: string; backdrop?: string | null; poster?: string | null; position?: number; positionX?: number };
    logoCard?: Snippet;
    titleField?: Snippet;
    overviewField?: Snippet;
    moveBackground?: (position: { x: number; y: number }) => void;
    segments?: Snippet;
    size?: 'standard' | 'compact';
    collection?: { items: HeroItem[]; selection: string; busy?: boolean };
    actions?: Snippet;
    parents?: MediaView[];
    items?: HeroItem[];
    context?: 'discover' | 'details' | 'home';
    next?: MediaView | null;
    requestable?: boolean;
  } = $props();
  const hero = untrack(() => createHeroPresentation(() => identity ? {} : { item, items, parents, collection }));
  provideRetention(hero.retain);
  const playback = untrack(() => createHeroPlayback(() => ({id:hero.active?.id,active:(hero.phase==='artwork'||hero.phase==='trailer')&&hero.attached,size:hero.size})));
  const backdrop = $derived(identity ? identity.backdrop : hero.active?.backdrop);
  const poster = $derived(identity ? identity.poster === backdrop ? undefined : identity.poster : hero.active?.poster);
  const titleLogo = $derived(identity || logoCard || hero.logoFailed ? undefined : hero.titleLogo);
  const overview = $derived(identity ? identity.description : hero.active?.overview);
  let backdropFailed = $state(false), posterFailed = $state(false);
  $effect(() => { backdrop; backdropFailed = false; });
  $effect(() => { poster; posterFailed = false; });
  let backgroundImage = $state<HTMLImageElement>();
  let drag = $state<{
    id: number; startX: number; startY: number; x: number; y: number; rangeX: number; rangeY: number;
  }>();
  const canDrag = $derived(!!(moveBackground && ((backdrop && !backdropFailed) || (poster && !posterFailed))));
  const clampPosition = (value: number) => Math.min(100, Math.max(0, value));

  function startDrag(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || !identity || !backgroundImage?.naturalWidth) return;
    const { clientWidth, clientHeight, naturalWidth, naturalHeight } = backgroundImage;
    const scale = Math.max(clientWidth / naturalWidth, clientHeight / naturalHeight);
    const rangeX = Math.max(0, naturalWidth * scale - clientWidth);
    const rangeY = Math.max(0, naturalHeight * scale - clientHeight);
    if (rangeX < 1 && rangeY < 1) return;
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: identity.positionX ?? 50, y: identity.position ?? 50, rangeX, rangeY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function dragBackground(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    const { startX, startY, x, y, rangeX, rangeY } = drag;
    moveBackground?.({
      x: rangeX >= 1 ? clampPosition(x + 100 * (startX - event.clientX) / rangeX) : x,
      y: rangeY >= 1 ? clampPosition(y + 100 * (startY - event.clientY) / rangeY) : y,
    });
  }
</script>

{#if identity || hero.active && hero.presentation}<section
  class="hero"
  class:compact={size === 'compact'}
  class:background-positionable={canDrag}
  data-alignment={alignment}
  class:fading={hero.fading}
  bind:this={hero.host}
  data-hero-id={identity?.id ?? hero.active?.id}
  data-hero-phase={identity ? undefined : hero.phase}
  aria-label={identity?.title ?? hero.active?.title}
  onfocusin={() => {
    if (identity) return;
    hero.controlFocused = true;
    hero.noteActivity();
  }}
  onfocusout={(event) => {
    if (identity) return;
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      hero.controlFocused = false;
      hero.noteActivity();
    }
  }}
  style:--hero-fade={blackFadeGradient('bottom','var(--detail-background, #000)')}
>
  {#if !identity}<div class="hero-video" class:visible={playback.visible && heroPlayer.ready} aria-hidden="true">
    <video bind:this={playback.video} data-player="hero" muted={heroPlayer.muted} playsinline preload="auto" tabindex="-1"
      class:positioned={!!playback.videoStyle} style={playback.videoStyle}
      onloadedmetadata={playback.loadedMetadata}
      onresize={playback.loadedMetadata}
      onplaying={playback.playing}
      onpause={playback.paused}
      onended={playback.ended}
      onerror={playback.failed}
    ></video>
  </div>{/if}
  <div class="art" class:video-visible={hero.showingTrailer && !hero.paused}>
    {#key identity?.id ?? hero.active?.id}<div class="artwork" transition:fade={{duration:hero.transitionDuration}}>{#if backdrop && !backdropFailed}<img
          src={backdrop}
          bind:this={backgroundImage}
          alt=""
          fetchpriority="high"
          style:object-position={identity ? `${identity.positionX ?? 50}% ${identity.position ?? 50}%` : undefined}
          onerror={() => (backdropFailed = true)}
        />{:else if poster && !posterFailed}<img
          class:poster-art={!identity}
          src={poster}
          bind:this={backgroundImage}
          alt=""
          style:object-position={identity ? `${identity.positionX ?? 50}% ${identity.position ?? 50}%` : undefined}
          onerror={() => (posterFailed = true)}
        />{/if}</div>{/key}
  </div>
  <div class="gradient" class:dimmed={hero.chromeDimmed} aria-hidden="true"></div>
  {#if canDrag}<div class="background-drag" class:grabbing={!!drag} aria-hidden="true"
    onpointerdown={startDrag} onpointermove={dragBackground} onlostpointercapture={() => drag = undefined}></div>{/if}
  <div class="content hero-inner" class:dimmed={hero.chromeDimmed}>
    <div class="hero-copy" class:editable-copy={!!overviewField}>
      {#if logoCard || titleLogo}<div class="title-artwork" class:logo-card={!!logoCard}>
        {#if logoCard}{@render logoCard()}
        {:else}<img class="title-logo" src={titleLogo} alt="" onerror={() => (hero.logoFailed = true)} />{/if}
      </div>{/if}
      {#if titleField}
        <div class="title-field">
          <h1>{identity?.title ?? hero.presentation?.title}</h1>
          <div class="edit-field">{@render titleField()}</div>
        </div>
      {:else}<h1 class:sr-only={!identity && (logoCard || titleLogo)}>{identity?.title ?? hero.presentation?.title}</h1>{/if}
      {#if identity}
        {#if identity.subtitle}<div class="genres"><span>{identity.subtitle}</span></div>{/if}
      {:else if hero.active && hero.presentation}
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
      {/if}
      {#if overviewField}
        <div class="overview-field" class:empty={!overview}>
          {#if overview}<p class="overview" aria-hidden="true">{overview}</p>{/if}
          <div class="edit-field">{@render overviewField()}</div>
        </div>
      {:else if overview}<p class="overview">{overview}</p>{/if}
    </div>
    {#if actions || segments || hero.active}
    <div class="hero-action-row">
      <div class="hero-item-actions" class:with-segments={!!segments}>
      {@render segments?.()}
      {#if actions}{@render actions()}
      {:else if hero.active}{#key hero.active.id}{#if screenItem(hero.active)}<WorkMenu
          item={hero.active}
          {editionName}
          {context}
          next={hero.active.id===(items[0]?.id??item?.id)?next:null}
          {requestable}
          hero
        />
      {:else}<WorkMenu item={hero.active} hero showTrigger />{/if}{/key}{/if}</div>
      {#if !identity}<div class="hero-pagination page-navigation">
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
        </div>{/if}
    </div>
    {/if}
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
    height: var(--hero-artwork-height);
    max-width: 544px;
    display: flex;
    align-items: flex-end;
  }
  .title-logo {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: scale-down;
    object-position: left bottom;
  }
  .hero {
    --hero-artwork-height: 176px;
    min-height: var(--hero-height);
    position: relative;
    isolation: isolate;
    background: transparent;
  }
  .hero[data-alignment='center'],.hero[data-alignment='adaptive'] {--hero-center:1;--hero-copy-align:center;}
  .hero[data-alignment='adaptive'] {--hero-center:calc(1 - var(--detail-expansion,1));--hero-copy-align:var(--detail-hero-text-align,left);}
  .hero:not([data-alignment='left']) .hero-copy {width:100%;margin-inline-start:calc((100% - min(100%,768px)) * 0.5 * var(--hero-center));text-align:var(--hero-copy-align);}
  .hero:not([data-alignment='left']) :is(h1:not(.sr-only),.logo-card,.genres,.metadata,.overview,.hero-action-row) {position:relative;max-width:100%;left:calc(50% * var(--hero-center));transform:translateX(calc(-50% * var(--hero-center)));}
  .hero:not([data-alignment='left']) :is(h1:not(.sr-only),.genres,.metadata,.hero-action-row) {width:fit-content;}
  .hero:not([data-alignment='left']) .logo-card {width:min(544px,100%);justify-content:var(--hero-copy-align);}
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
  .background-drag { position: absolute; inset: 0; cursor: grab; touch-action: none; }
  .background-drag.grabbing { cursor: grabbing; }
  .background-positionable .hero-inner { pointer-events: none; }
  .background-positionable .title-artwork > :global(*),
  .background-positionable .edit-field > :global(*),
  .background-positionable .hero-item-actions { pointer-events: auto; }
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
  .title-artwork + h1:not(.sr-only), .title-field, .genres {
    margin-top: 28px;
  }
  :is(h1:not(.sr-only), .title-field) + .genres {
    margin-top: 12px;
  }
  .genres {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
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
  .editable-copy, .title-field, .overview-field { position: relative; }
  .title-field h1, .overview-field .overview { color: transparent; }
  .edit-field { position: absolute; inset: 0; }
  .overview-field {
    margin-top: 12px;
    max-width: 672px;
  }
  .overview-field .overview { margin-top: 0; }
  .overview-field.empty {
    position: absolute;
    inset-inline: 0;
    top: 100%;
    height: calc(var(--text-md) * var(--leading-relaxed));
    margin-top: 0;
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
  .hero-item-actions.with-segments {flex-wrap:wrap;min-width:0;max-width:100%;}
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
    .hero {
      --hero-artwork-height: 144px;
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
      max-width: 100%;
    }
    .overview {
      font-size: var(--text-md);
      line-clamp: 3;
      -webkit-line-clamp: 3;
    }
  }

  .hero.compact { --hero-height: 0px; --hero-artwork-height: 128px; }
  .hero.compact .hero-inner { padding-block: 80px 32px; }
  @media (max-width: 639px) {
    .hero.compact { --hero-artwork-height: 104px; }
  }
  .hero-video { position: absolute; inset: 0; z-index: -3; overflow: hidden; pointer-events: none; visibility: hidden; }
  .hero-video.visible { visibility: visible; }
  video { position: absolute; width: 100%; height: 100%; object-fit: cover; }
  video.positioned { max-width: none; object-fit: fill; }

</style>
