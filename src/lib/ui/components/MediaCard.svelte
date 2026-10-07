<script lang="ts">
  import Button from './Button.svelte';
  import { page } from '$app/state';
  import ProgressBar from './ProgressBar.svelte';
  import { primaryMediaAction, progressFraction } from '$lib/media/model';
  import { canPlayMusicCard } from '$lib/music/presentation';
  import { goto,pushState } from '$app/navigation';
  import { cardArtwork, overlayArtwork } from '$lib/ui/artwork-priority';
  import type { ArtworkPriority } from '$lib/ui/types';
  import { artworkTypes } from '$lib/artwork';
  import { tick, getContext } from 'svelte';
  import type {
    MediaView,
    MediaCardPresentation,
    MediaCardDisplay,
    MediaCardShape,
    MediaCardArtwork,
    MediaCardOverlay,
  } from '$lib/ui/types';
  import { lazyImage } from '$lib/ui/lazy-image';
  import { contextGesture, type MenuPoint } from '$lib/ui/context-gesture';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import {useClock} from '$lib/ui/clock.svelte';
  import {activityDateLabel,unknownActivityDate} from '$lib/social/model';
  import ReactionActions from './ReactionActions.svelte';
  const clock=useClock();
  import Icon from './Icon.svelte';
  import ActivityHeader from './ActivityHeader.svelte';
  import SocialControls from './SocialControls.svelte';
  import MediaActions from './MediaActions.svelte';
  import PresentationActions from './PresentationActions.svelte';
  let {
    item,
    shape = item.kind==='person'?'circle':'poster',
    artworkStyle = 'auto',
    overlay = 'none',
    artworkPriority,
    onselect,
    social,
    wrapActivity = false,
    showActivityContext = true,
    showCaption = true,
    showPrimaryAction = true,
    primaryMenu,
    activityTrailing,
    activityProgress,
  }: {
    item: MediaView | MediaCardPresentation | MediaCardDisplay;
    shape?: MediaCardShape;
    artworkStyle?: MediaCardArtwork;
    overlay?: MediaCardOverlay;
    artworkPriority?: ArtworkPriority;
    onselect?: (item: MediaView) => void;
    wrapActivity?: boolean;
    showActivityContext?: boolean;
    showCaption?:boolean;
    showPrimaryAction?:boolean;
    primaryMenu?:import('svelte').Snippet;
    activityTrailing?:import('svelte').Snippet;
    activityProgress?:number|null;
    social?:{friends:{username:string;avatar?:string|null;status?:import('$lib/social/status').ActivityStatus}[];total:number};
  } = $props();
  const contextReadOnly = getContext<() => boolean>('profile-read-only') ?? (() => false);
  const readOnly = () => !page.data.user || contextReadOnly() || ('href' in item&&item.href===null);
  const trackedItem = $derived('href' in item ? undefined : item);
  const href = $derived('href' in item ? item.href??undefined : `/media/${item.id}`);
  let overlayIndex = $state(0);
  const overlayCandidates = $derived(overlayArtwork(item, overlay, artworkPriority));
  const overlayImage = $derived(overlayCandidates[overlayIndex]);
  $effect(() => {
    overlayCandidates;
    overlayIndex = 0;
  });
  let imageIndex = $state(0);
  let active = $state(false);
  let primaryMenuButton=$state<Button>();
  let actions = $state<MediaActions>();
  let presentationActions = $state<PresentationActions>();
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
  let loadedArtwork = $state<string>();
  const loading = $derived(!!artwork && loadedArtwork !== artwork);
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
    if (readOnly() || item.kind === 'person'&&!primaryMenu) return;
    active = true;
    await tick();
    if(primaryMenu) primaryMenuButton?.openAt(point);
    else if (trackedItem) actions?.openAt(point);
    else presentationActions?.openAt(point);
  }
  const completion = $derived(
    progressFraction(
      trackedItem?.trackingProgress ?? {
        unit: 'seconds',
        value: trackedItem?.progress ?? 0,
        ...(trackedItem && trackedItem.duration > 0 ? { total: trackedItem.duration } : {}),
      }
    )
  );
  const primaryAction = $derived(
    trackedItem
      ? primaryMediaAction({
          category: trackedItem.category ?? 'screen',
          canOpen: trackedItem.canOpen ?? trackedItem.available,
          canRequest:
            trackedItem.requestable ??
            ((trackedItem.category ?? 'screen') === 'screen' && !trackedItem.available),
        })
      : canPlayMusicCard(item) ? 'play' : 'open'
  );
  const cardProgress=$derived(item.captionActor?activityProgress??null:completion!==null&&completion>0&&completion<0.9?completion:null);
  const primaryLabel = $derived(
    {
      play: 'Play',
      read: 'Read',
      open: 'Open',
      request: 'Request',
      progress: 'Update progress',
    }[primaryAction]
  );
  async function activate(event:MouseEvent) {
    const rect=event.currentTarget instanceof HTMLElement?event.currentTarget.getBoundingClientRect():null;
    active = true;
    await tick();
    if(primaryMenu&&rect){primaryMenuButton?.openAt({x:rect.left,y:rect.bottom});return;}
    if (primaryAction === 'play') {
      if (trackedItem) await actions?.start();
      else await presentationActions?.start();
    }
    else if (primaryAction === 'request') actions?.request();
    else if(href) await goto(href);
  }
  function cardGesture(node: HTMLElement) {
    return contextGesture(node, openMenu);
  }
  function select(event: MouseEvent) {
    if(!href)return;
    if(!onselect&&page.data.user&&page.data.experiments?.mediaModal&&/^\/media\/[0-9a-f-]{36}$/.test(href)&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();pushState(page.url,{...page.state,mediaModalId:href.split('/')[2]});return;}
    if (onselect && trackedItem) {
      event.preventDefault();
      onselect(trackedItem);
    }
  }
</script>

<article
  class="media-card"
  class:loading
  use:cardGesture
  onpointerenter={() => (active = true)}
  onfocusin={() => (active = true)}
>
  {#if showActivityContext && item.captionActor}
    <div class="activity-context">
      <ActivityHeader username={item.captionActor.username} avatar={item.captionActor.avatar} status={item.captionActor.status} profileHref={item.captionActor.profileHref} showAvatar={!loading} nonApproved>
        {#snippet trailing()}{#if activityTrailing}{@render activityTrailing()}{:else if item.captionActivity}{#if item.captionActivity.dateKnown}<time datetime={item.captionActivity.occurredAt} title={new Date(item.captionActivity.occurredAt).toLocaleString()}>{activityDateLabel(item.captionActivity.occurredAt,clock.now)}</time>{:else}<span>{unknownActivityDate(item.captionActivity.kind)}</span>{/if}{/if}{/snippet}
      </ActivityHeader>
    </div>
  {/if}
  <div
    class="art {shape}"
    class:unavailable={!!page.data.user && page.data.user.settings?.monochromeMissing !== false && trackedItem && !trackedItem.available}
    class:contained
    title={artworkHint}
  >
    <span class="hover-stroke" aria-hidden="true"></span>
    {#if loading}<span class="skeleton artwork-loading" aria-hidden="true"></span>{/if}
    <a class="art-link" {href} aria-label={item.title} onclick={select} draggable="false">
      {#if artwork}<img
          use:lazyImage={artwork}
          alt=""
          loading="lazy"
          decoding="async"
          draggable="false"
          onload={event => { loadedArtwork = event.currentTarget.getAttribute('src') ?? undefined; }}
          onerror={() => (imageIndex += 1)}
        />
      {:else if artworkStyle !== 'none'}<div class="fallback">
          <Icon
            name={item.kind === 'artist'
              ? 'user'
              : item.kind === 'album' || item.kind === 'track' || item.kind === 'game'
                ? 'library'
                : item.kind === 'show'
                  ? 'library'
                  : 'film'}
            size={32}
          />{#if showCaption}<span>{item.title}</span>{/if}
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
    {#if !readOnly()}{#if showPrimaryAction}<button
        class="play glass icon-button"
        use:liquidGlass={{ enabled: active }}
        aria-label={primaryMenu?`Actions for ${item.title}`:`${primaryLabel} ${item.title}`}
        aria-haspopup={primaryMenu?'menu':undefined}
        onclick={activate}
        ><Icon
          name={primaryMenu?'more':primaryAction === 'play'
            ? 'play'
            : primaryAction === 'request'
              ? 'request'
              : 'arrow'}
          size={28}
        /></button
      >{/if}
      {#if primaryMenu}<Button menu hideTrigger bind:this={primaryMenuButton} label={`Actions for ${item.title}`}>{@render primaryMenu()}</Button>{/if}
      {#if item.kind !== 'person'}<div class="card-menu">
        <button
          class="icon-button"
          aria-label={`Actions for ${item.title}`}
          aria-haspopup="menu"
          onclick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            void openMenu({ x: rect.left, y: rect.bottom });
          }}><Icon name="more" size={18} /></button
        >
        {#if active}{#if trackedItem}<MediaActions
              bind:this={actions}
              item={trackedItem}
              menuOnly
            />{:else if 'href' in item&&item.href!==null}<PresentationActions
              bind:this={presentationActions}
              {item}
            />{/if}{/if}
      </div>
    {/if}{/if}
    {#if !loading && ((!item.captionActor&&social?.total)||cardProgress!==null)}<div class="card-status">
      {#if !item.captionActor&&social?.total}<div class="card-friends"><SocialControls friends={social.friends} total={social.total} showLabel={false} showReactions={false} /></div>{/if}
      {#if cardProgress!==null}<div class="card-progress"><ProgressBar progress={cardProgress} label={`${item.title}${item.captionActor?' playback':''} progress`} /></div>{/if}
    </div>{/if}
  </div>
  {#if showCaption}<div class="caption-row">
  {#if item.captionActor}
    <div class="activity-attribution" class:wrap-activity={wrapActivity}>

      <div class="activity-body">
        <div class="activity-details">
          <a class="activity-media" {href} onclick={select}>{item.captionTitle ?? item.title}</a>
          {#if item.captionActivity?.action || item.captionSubtitle}<div class="activity-detail">{item.captionActivity?.action ?? item.captionSubtitle}{#if item.captionActivity?.detail}{' '}{item.captionActivity.detail}{/if}</div>{/if}
        </div>
        {#if showActivityContext && item.captionActivity}<div class="activity-reaction"><ReactionActions targetKind="activity" targetId={item.captionActivity.id} initialReaction={item.captionActivity.myReaction} /></div>{/if}
      </div>
    </div>
  {:else}
    <a class="caption" {href} onclick={select}>
    <div class="title">{item.captionTitle ?? item.title}</div>
    {#if !item.captionActor&&(item.kind!=='person'||item.captionSubtitle)}<div class="meta">
      {#if item.captionSubtitle}<span class="subtitle">{item.captionSubtitle}</span
        >{:else if item.kind === 'season' && trackedItem?.seasonNumber !== undefined}{item.captionTitle
          ? item.title
          : (item.year ?? '')}{:else if trackedItem?.seasonNumber !== undefined}S{String(
          trackedItem.seasonNumber
        ).padStart(2, '0')}E{String(trackedItem.episodeNumber ?? 0).padStart(
          2,
          '0'
        )}{:else}{item.year ?? ''}{#if item.year}<span>·</span>{/if}{item.kind === 'show'
          ? 'Show'
          : item.kind === 'movie'
            ? 'Movie'
            : item.kind}{/if}{#if !item.captionActor && trackedItem?.rating}<span>·</span><span class="rating"
          ><Icon name="star" size={14} filled /> {trackedItem.rating}</span
        >{/if}
    </div>{/if}
  </a>
  {/if}
  </div>{/if}
  {#if showActivityContext && item.captionActivity && !item.captionActor}
    <div class="activity-reactions small quiet">
      {#if !item.captionActor}{#if item.captionActivity.dateKnown}<time datetime={item.captionActivity.occurredAt} title={new Date(item.captionActivity.occurredAt).toLocaleString()}>{activityDateLabel(item.captionActivity.occurredAt,clock.now)}</time>{:else}<span>{unknownActivityDate(item.captionActivity.kind)}</span>{/if}{/if}
      <ReactionActions targetKind="activity" targetId={item.captionActivity.id} initialReaction={item.captionActivity.myReaction} />
    </div>
  {/if}
</article>

<style>
  .activity-attribution{margin-top:12px;}
  .activity-context{margin-bottom:8px;min-height:24px;}
  .activity-body{display:flex;align-items:flex-start;gap:8px;margin-top:4px;}
  .activity-details{min-width:0;flex:1;}
  .activity-media{display:block;font-size:var(--text-md);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .activity-detail{font-size:var(--text-sm);color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .wrap-activity .activity-detail,.wrap-activity .activity-media{white-space:normal;overflow:visible;overflow-wrap:anywhere;}
  .activity-reaction{flex-shrink:0;}
  .activity-reactions{margin-top:6px;}
  .card-status{position:absolute;bottom:8px;left:8px;right:8px;z-index:3;display:flex;align-items:flex-end;gap:8px;}
  .card-friends{flex-shrink:0;max-width:65%;}
  .card-progress{flex:1;min-width:0;height:6px;pointer-events:none;}

  .media-card {
    display: block;
    min-width: 0;
  }
  .art {
    position: relative;
    aspect-ratio: 2/3;
    border-radius: 12px;
    isolation: isolate;
    background: var(--surface);
    transition: transform var(--fast) var(--ease);
  }
  .art.circle{aspect-ratio:1;border-radius:50%;}
  .artwork-loading{position:absolute;inset:0;border-radius:inherit;pointer-events:none;}
  .loading .fallback,.loading .play,.loading .card-menu{visibility:hidden;}
  .loading .art-link img,.loading .art-overlay{visibility:hidden!important;}
  .art.circle .art-link{border-radius:50%;}
  .media-card:has(.art.circle) .caption-row{text-align:center;}
  .media-card:has(.art.circle) .meta{justify-content:center;}
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
  .media-card.loading .art {background:transparent;transform:none;}
  .media-card.loading .art::before,.media-card.loading .art::after {display:none;}
  .media-card.loading .hover-stroke {display:none;}
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
    background: var(--canvas);
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
    font-size: var(--text-md);
    font-weight: var(--weight-regular);
    letter-spacing: var(--tracking-tight);
  }
  .title {
    font-size: var(--text-md);
    font-weight: var(--weight-regular);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 12px;
  }
  .meta {
    font-size: var(--text-sm);
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
    .play,
    .card-menu {
      transition: none;
    }
  }
</style>
