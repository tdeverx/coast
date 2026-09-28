<script lang="ts">
  import { primaryMediaAction, progressFraction } from '$lib/media/model';
  import { goto } from '$app/navigation';
  import { cardArtwork, overlayArtwork } from '$lib/ui/artwork-priority';
  import type { ArtworkPriority } from '$lib/ui/types';
  import { artworkTypes } from '$lib/artwork';
  import { tick, getContext } from 'svelte';
  import type {
    MediaView,
    MediaCardShape,
    MediaCardArtwork,
    MediaCardOverlay,
  } from '$lib/ui/types';
  import { lazyImage } from '$lib/ui/lazy-image';
  import { contextGesture, type MenuPoint } from '$lib/ui/context-gesture';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import Icon from './Icon.svelte';
  import MediaActions from './MediaActions.svelte';
  let {
    item,
    shape = 'poster',
    artworkStyle = 'auto',
    overlay = 'none',
    artworkPriority,
    onselect,
  }: {
    item: MediaView;
    shape?: MediaCardShape;
    artworkStyle?: MediaCardArtwork;
    overlay?: MediaCardOverlay;
    artworkPriority?: ArtworkPriority;
    onselect?: (item: MediaView) => void;
  } = $props();
  const readOnly = getContext<() => boolean>('profile-read-only') ?? (() => false);
  let overlayIndex = $state(0);
  const overlayCandidates = $derived(overlayArtwork(item, overlay, artworkPriority));
  const overlayImage = $derived(overlayCandidates[overlayIndex]);
  $effect(() => {
    overlayCandidates;
    overlayIndex = 0;
  });
  let imageIndex = $state(0);
  let active = $state(false);
  let actions = $state<MediaActions>();
  const selectedType = $derived(
    artworkStyle === 'auto'
      ? shape === 'banner'
        ? 'banner'
        : shape === 'fanart'
          ? 'backdrop'
          : 'primary'
      : artworkStyle
  );
  const resolvedArtwork = $derived(cardArtwork(item, selectedType, shape, artworkPriority));
  const selectedImage = $derived(resolvedArtwork.selected);
  const candidates = $derived(resolvedArtwork.candidates);
  const artwork = $derived(candidates[imageIndex]);
  const contained = $derived(
    selectedType !== 'none' &&
      !!selectedImage &&
      artwork === selectedImage &&
      artworkTypes[selectedType].contain
  );
  const artworkHint = $derived(
    selectedType !== 'none' && artworkStyle !== 'auto' && artwork !== selectedImage
      ? `${artworkTypes[selectedType].label} unavailable; showing fallback artwork`
      : undefined
  );
  $effect(() => {
    candidates;
    imageIndex = 0;
  });
  async function openMenu(point: MenuPoint) {
    if (readOnly()) return;
    active = true;
    await tick();
    actions?.openAt(point);
  }
  const completion = $derived(
    progressFraction(
      item.trackingProgress ?? {
        unit: 'seconds',
        value: item.progress,
        ...(item.duration > 0 ? { total: item.duration } : {}),
      }
    )
  );
  const primaryAction = $derived(
    primaryMediaAction({
      category: item.category ?? 'screen',
      canOpen: item.canOpen ?? item.available,
      canRequest: item.requestable ?? ((item.category ?? 'screen') === 'screen' && !item.available),
    })
  );
  const primaryLabel = $derived(
    { play: 'Play', read: 'Read', open: 'Open', request: 'Request', progress: 'Update progress' }[
      primaryAction
    ]
  );
  async function activate() {
    active = true;
    await tick();
    if (primaryAction === 'play') await actions?.start();
    else if (primaryAction === 'request') actions?.request();
    else await goto(`/media/${item.id}`);
  }
  function select(event: MouseEvent) {
    if (onselect) {
      event.preventDefault();
      onselect(item);
    }
  }
</script>

<article
  class="media-card"
  use:contextGesture={openMenu}
  onpointerenter={() => (active = true)}
  onfocusin={() => (active = true)}
>
  <div class="art {shape}" class:unavailable={!item.available} class:contained title={artworkHint}>
    <span class="hover-stroke" aria-hidden="true"></span>
    <a
      class="art-link"
      href="/media/{item.id}"
      aria-label={item.title}
      onclick={select}
      draggable="false"
    >
      {#if artwork}<img
          use:lazyImage={artwork}
          alt=""
          loading="lazy"
          decoding="async"
          draggable="false"
          onerror={() => (imageIndex += 1)}
        />
      {:else if artworkStyle !== 'none'}<div class="fallback">
          <Icon name={item.kind === 'show' ? 'library' : 'film'} size={32} /><span
            >{item.title}</span
          >
        </div>{/if}
    </a>
    {#if overlayImage}
      <img
        class="art-overlay"
        use:lazyImage={overlayImage}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        draggable="false"
        onerror={() => (overlayIndex += 1)}
      />
    {/if}
    {#if !readOnly()}<button
        class="play glass icon-button"
        use:liquidGlass={{ enabled: active }}
        aria-label={`${primaryLabel} ${item.title}`}
        onclick={activate}
        ><Icon
          name={primaryAction === 'play'
            ? 'play'
            : primaryAction === 'request'
              ? 'request'
              : 'arrow'}
          size={28}
        /></button
      >
      <div class="card-menu">
        <button
          class="icon-button"
          aria-label={`Actions for ${item.title}`}
          aria-haspopup="menu"
          onclick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            void openMenu({ x: rect.left, y: rect.bottom });
          }}><Icon name="more" size={18} /></button
        >
        {#if active}<MediaActions bind:this={actions} {item} menuOnly />{/if}
      </div>
    {/if}
    {#if completion !== null && completion > 0 && completion < 0.9}<div
        class="progress"
        role="progressbar"
        aria-label={`${item.title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(completion * 100)}
      >
        <span style:width={`${completion * 100}%`}></span>
      </div>{/if}
  </div>
  <a class="caption" href="/media/{item.id}" onclick={select}>
    <div class="title">{item.captionTitle ?? item.title}</div>
    <div class="meta">
      {#if item.captionSubtitle}<span class="subtitle">{item.captionSubtitle}</span
        >{:else if item.kind === 'season' && item.seasonNumber !== undefined}{item.captionTitle
          ? item.title
          : (item.year ?? '')}{:else if item.seasonNumber !== undefined}S{String(
          item.seasonNumber
        ).padStart(2, '0')}E{String(item.episodeNumber ?? 0).padStart(2, '0')}{:else}{item.year ??
          ''}{#if item.year}<span>·</span>{/if}{item.kind === 'show'
          ? 'Show'
          : item.kind === 'movie'
            ? 'Movie'
            : item.kind}{/if}{#if item.rating}<span>·</span><span class="rating"
          ><Icon name="star" size={14} filled /> {item.rating}</span
        >{/if}
    </div>
  </a>
</article>

<style>
  .media-card {
    display: block;
    min-width: 0;
  }
  .art {
    position: relative;
    aspect-ratio: 2/3;
    border-radius: 12px;
    isolation: isolate;
    background: var(--surface-soft);
    transition: transform var(--fast) var(--ease);
  }
  .art.square {
    aspect-ratio: 1;
  }
  .art.fanart {
    aspect-ratio: 16/9;
  }
  .art.banner {
    aspect-ratio: 5.4 / 1;
  }
  .media-card:is(:hover, :focus-within) .art {
    transform: scale(1.02);
  }
  .art.contained .art-link img {
    object-fit: contain;
    padding: 24px;
  }
  .art-link {
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .art-link img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .art.unavailable img {
    filter: grayscale(1);
    transition: filter var(--fast) var(--ease);
  }
  .media-card:is(:hover, :focus-within) .art.unavailable img {
    filter: grayscale(0);
  }
  .art-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 10px;
    box-sizing: border-box;
    object-fit: contain;
    object-position: center;
    pointer-events: none;
  }
  .art.banner .play {
    width: 44px;
    height: 44px;
  }
  .art::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: #000;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--fast);
    z-index: 1;
  }
  .media-card:is(:hover, :focus-within) .art::before {
    opacity: 0.4;
  }
  .art::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 1.5px solid white;
    border-radius: inherit;
    pointer-events: none;
    mix-blend-mode: overlay;
    z-index: 0;
    box-sizing: border-box;
    opacity: 0.5;
    transition:
      border-width var(--fast),
      opacity var(--fast);
  }
  .media-card:hover .art::after,
  .media-card:focus-within .art::after {
    border-width: 3px;
    opacity: 1;
  }
  .hover-stroke {
    position: absolute;
    inset: 0;
    border: 3px solid white;
    border-radius: inherit;
    box-sizing: border-box;
    pointer-events: none;
    z-index: 2;
    opacity: 0;
    transition: opacity var(--fast);
  }
  @media (hover: hover) {
    .media-card:hover .hover-stroke {
      opacity: 0.5;
    }
  }
  .play {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 58px;
    height: 58px;
    z-index: 2;
    border-radius: 50%;
  }
  .play:is(:hover, :focus-visible) {
    transform: translate(-50%, -50%) scale(1.08);
  }
  .card-menu {
    position: absolute;
    right: 6px;
    top: 6px;
    z-index: 2;
  }
  .card-menu > button {
    width: 32px;
    height: 32px;
  }
  .play,
  .card-menu {
    opacity: 0;
    transition:
      opacity var(--fast),
      transform var(--fast) var(--ease);
  }
  .media-card:hover .play,
  .media-card:hover .card-menu,
  .media-card:focus-within .play,
  .media-card:focus-within .card-menu {
    opacity: 1;
  }
  .caption {
    -webkit-touch-callout: none;
    user-select: none;
    display: block;
  }
  @media (pointer: coarse) {
    .card-menu > button {
      width: 44px;
      height: 44px;
    }
  }
  @media (hover: none) {
    .art::before {
      opacity: 0.4;
    }
    .play,
    .card-menu {
      opacity: 1;
    }
  }
  .fallback {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 18px;
    color: var(--quiet);
    text-align: center;
  }
  .fallback span {
    font-size: 16px;
    font-weight: 550;
    letter-spacing: -0.02em;
  }
  .title {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 12px;
  }
  .meta {
    font-size: 12px;
    color: var(--muted);
    display: flex;
    gap: 7px;
    margin-top: 4px;
  }
  .subtitle {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rating {
    flex-shrink: 0;
  }
  .progress {
    height: 6px;
    border-radius: 99px;
    overflow: hidden;
    background: #ffffff45;
    position: absolute;
    bottom: 10px;
    left: 10px;
    right: 10px;
    z-index: 2;
    pointer-events: none;
  }
  .progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: currentColor;
  }
  .rating :global(svg) {
    width: 1em;
    height: 1em;
  }
  .rating {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--rating);
  }
  @media (prefers-reduced-motion: reduce) {
    .art,
    .art::before,
    .art::after,
    .art.unavailable img,
    .hover-stroke,
    .progress,
    .play,
    .card-menu {
      transition: none;
    }
  }
</style>
