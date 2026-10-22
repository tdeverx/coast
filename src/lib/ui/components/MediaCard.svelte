<script lang="ts">
  import Button from './Button.svelte';
  import { page } from '$app/state';
  import ProgressBar from './ProgressBar.svelte';
  import { primaryMediaAction, progressFraction } from '#lib/media/model.js';
  import { canPlayMusicCard } from '#lib/music/presentation.js';
  import {navigateMedia} from '#lib/ui/media-navigation.js';
  import { cardArtwork, overlayArtwork } from '#lib/media/artwork.js';
  import type { ArtworkPriority } from '#lib/ui/types.js';
  import { artworkTypes } from '#lib/artwork.js';
  import { displayLabel } from '#lib/ui/labels.js';
  import { tick, getContext, onDestroy } from 'svelte';
  import {provideRetention,type Retain} from '#lib/ui/retention.js';
  import type { Snippet } from 'svelte';
  import type {
    MediaView,
    MediaCardPresentation,
    MediaCardDisplay,
    MediaCardShape,
    MediaCardArtwork,
    MediaCardOverlay,
  } from '#lib/ui/types.js';
  import { lazyImage } from '#lib/ui/lazy-image.js';
  import { useClient } from '#lib/ui/client-context.js';
  import { contextGesture, type MenuPoint } from '#lib/ui/context-gesture.js';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
  import {useClock} from '#lib/ui/clock.svelte.js';
  import {activityDateLabel,unknownActivityDate} from '#lib/social/model.js';
  import ReactionActions from './ReactionActions.svelte';
  import TextLink from './TextLink.svelte';
  const { preview } = useClient();
  import Icon from './Icon.svelte';
  import ActivityHeader from './ActivityHeader.svelte';
  import SocialControls from './SocialControls.svelte';
  import {detailHref} from '../pages/detail-rows';
  import WorkMenu from './WorkMenu.svelte';
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
    captionAction,
    body,
    footer,
    retain,
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
    captionAction?: Snippet;
    body?: Snippet;
    footer?: Snippet;
    retain?: Retain;
    social?:{friends:{username:string;avatar?:string|null;status?:import('#lib/social/status.js').ActivityStatus}[];total:number};
  } = $props();
  const retainCard=provideRetention(()=>retain?.()??(()=>{}));
  let releaseFocus:(()=>void)|undefined;
  function cardFocus(event:FocusEvent) {
    if(event.type==='focusin'){active=true;releaseFocus??=retainCard();}
    else if(!(event.relatedTarget instanceof Node)||!(event.currentTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget)){
      releaseFocus?.();releaseFocus=undefined;
    }
  }
  onDestroy(()=>releaseFocus?.());
  const clock=useClock('minute',()=>showActivityContext&&!!(item.captionActivity?.dateKnown||item.captionDate));
  const contextReadOnly = getContext<() => boolean>('profile-read-only') ?? (() => false);
  const readOnly = () => !page.data.user || contextReadOnly() || ('href' in item&&(item.href===null||item.kind==='collection'&&!item.workId));
  const trackedItem = $derived('href' in item ? undefined : item);
  const href = $derived('href' in item ? item.href??undefined : `/media/${item.id}`);
  const activityHref=$derived(href ? detailHref(href,{section:'activity',relationship:'all'}) : undefined);
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
  let actions = $state<WorkMenu>();
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
    const release=retainCard();
    try {
    active = true;
    await tick();
    if(primaryMenu) primaryMenuButton?.openAt(point);
    else actions?.openAt(point);
    } finally {release();}
  }
  const completion = $derived(
    progressFraction(
      item.trackingProgress ?? {
        unit: 'seconds',
        value: trackedItem?.progress ?? 0,
        ...(trackedItem && trackedItem.duration > 0 ? { total: trackedItem.duration } : {}),
      }
    )
  );
  const primaryAction = $derived(
    page.data.capabilities?.playback===false && !['game','book','comic'].includes(item.kind) || page.data.capabilities?.reader===false && ['book','comic'].includes(item.kind) ? 'open' : trackedItem
      ? primaryMediaAction({
          category: trackedItem.category ?? 'screen',
          canOpen: trackedItem.canOpen ?? trackedItem.available,
          canRequest: page.data.capabilities?.requests!==false && (trackedItem.requestable ?? ((trackedItem.category ?? 'screen') === 'screen' && !trackedItem.available)),
        })
      : (item.kind === 'book' || item.kind === 'comic') && item.workId && item.available ? 'read' : canPlayMusicCard(item) ? 'play' : 'open'
  );
  const cardProgress=$derived(item.captionActor?activityProgress??null:completion!==null&&completion>0&&completion<(item.kind==='book'||item.kind==='comic'?1:0.9)?completion:null);
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
    const release=retainCard();
    try {
    const rect=event.currentTarget instanceof HTMLElement?event.currentTarget.getBoundingClientRect():null;
    active = true;
    await tick();
    if(primaryMenu&&rect){primaryMenuButton?.openAt({x:rect.left,y:rect.bottom});return;}
    if (preview) return;
    if (primaryAction === 'play') {
      await actions?.start();
    }
    else if (primaryAction === 'read') await actions?.startReading();
    else if (primaryAction === 'request') actions?.request();
    else if(href) await navigateMedia(href);
    } finally {release();}
  }
  function cardGesture(node: HTMLElement) {
    return contextGesture(node, openMenu);
  }
  function select(event: MouseEvent) {
    if (preview) { event.preventDefault(); return; }
    if (event.defaultPrevented) return;
    if(!href)return;
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
  onfocusin={cardFocus}
  onfocusout={cardFocus}
>
  {#if showActivityContext && item.captionActor}
    <div class="activity-context">
      <ActivityHeader username={item.captionActor.username} avatar={item.captionActor.avatar} status={item.captionActor.status} profileHref={item.captionActor.profileHref} showAvatar={!loading} nonApproved>
        {#snippet trailing()}{#if activityTrailing}{@render activityTrailing()}{:else if item.captionActivity}{#if item.captionActivity.dateKnown}<time datetime={item.captionActivity.occurredAt} title={new Date(item.captionActivity.occurredAt).toLocaleString()}>{activityDateLabel(item.captionActivity.occurredAt,clock.now)}</time>{:else}<span>{unknownActivityDate(item.captionActivity.kind)}</span>{/if}{:else if item.captionDate}<time datetime={item.captionDate} title={new Date(item.captionDate).toLocaleString()}>{activityDateLabel(item.captionDate,clock.now)}</time>{/if}{/snippet}
      </ActivityHeader>
    </div>
  {/if}
  <div
    class="art media-surface-edge {shape}"
    class:unavailable={!!page.data.user && page.data.user.settings?.monochromeMissing !== false && item.available === false}
    class:contained
    title={artworkHint}
  >
    <span class="hover-stroke" aria-hidden="true"></span>
    {#if loading}<span class="skeleton artwork-loading" aria-hidden="true"></span>{/if}
    <a class="art-link" {href} aria-label={primaryMenu && !showPrimaryAction ? `Actions for ${item.title}` : item.title}
      role={primaryMenu && !showPrimaryAction ? 'button' : undefined} aria-haspopup={primaryMenu && !showPrimaryAction ? 'menu' : undefined}
      onkeydown={event => { if (primaryMenu && !showPrimaryAction && event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } }}
      onclick={event => { if (primaryMenu && !showPrimaryAction) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); void openMenu({ x: rect.left, y: rect.bottom }); } else select(event); }} draggable="false">
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
                : item.kind === 'show' || item.kind === 'book' || item.kind === 'comic'
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
            : primaryAction === 'read' ? 'library' : primaryAction === 'request'
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
        {#if active && !('href' in item && item.href === null)}<WorkMenu bind:this={actions} {item} menuOnly />{/if}
      </div>
    {/if}{/if}
    {#if !loading && !item.captionActor && social?.total}<div class="card-friends"><SocialControls friends={social.friends} total={social.total} href={activityHref} label={`View activity for ${item.title}`} /></div>{/if}
    {#if !loading && cardProgress!==null}<div class="card-status">
      <div class="card-progress"><ProgressBar progress={cardProgress} label={`${item.title}${item.captionActor?' playback':''} progress`} /></div>
    </div>{/if}
  </div>
  {#if showCaption || captionAction}<div class="caption-row">
  {#if showCaption}
  {#if item.captionActor}
    <div class="caption activity-attribution" class:wrap-activity={wrapActivity}>
          <div class="title activity-media">{#if item.captionTitleHref ?? href}<TextLink href={(item.captionTitleHref ?? href)!} text={item.captionTitle ?? item.title} onclick={event=>{if(!item.captionTitleHref)select(event);}}/>{:else}{item.captionTitle ?? item.title}{/if}</div>
          {#if item.captionActivity?.action || item.captionSubtitle}<div class="meta activity-detail">{item.captionActivity?.action ?? item.captionSubtitle}{#if item.captionActivity?.detail}{' '}{item.captionActivity.detail}{/if}</div>{/if}
    </div>
  {:else}
    <div class="caption">
    <div class="title">{#if item.captionTitleHref ?? href}<TextLink href={(item.captionTitleHref ?? href)!} text={item.captionTitle ?? item.title} onclick={event=>{if(!item.captionTitleHref)select(event);}}/>{:else}{item.captionTitle ?? item.title}{/if}</div>
    {#if !item.captionActor&&(item.kind!=='person'||item.captionSubtitle)}<div class="meta">
      {#if item.captionSubtitle}<span class="subtitle">
        {#if item.captionCredits?.length && item.captionCredits.map(credit=>credit.name).join(', ')===item.captionSubtitle}
          {#each item.captionCredits as credit,index}{#if index}{', '}{/if}{#if credit.href}<TextLink href={credit.href} text={credit.name}/>{:else}{credit.name}{/if}{/each}
        {:else if item.captionSubtitleHref}<TextLink href={item.captionSubtitleHref} text={item.captionSubtitle}/>
        {:else}{item.captionSubtitle}{/if}
      </span>{:else if item.kind === 'season' && trackedItem?.seasonNumber !== undefined}{item.captionTitle
          ? item.title
          : (item.year ?? '')}{:else if trackedItem?.seasonNumber !== undefined && href}<TextLink {href} text={`S${String(trackedItem.seasonNumber).padStart(2,'0')}E${String(trackedItem.episodeNumber??0).padStart(2,'0')}`} onclick={select}/>{:else}{item.year ?? ''}{#if item.year}<span>·</span>{/if}{displayLabel(item.kind)}{/if}{#if !item.captionActor && item.rating}<span>·</span><span class="rating"
          ><Icon name="star" size={14} filled /> {item.rating}</span
        >{/if}
    </div>{/if}
  </div>
  {/if}
  {/if}
  {#if captionAction || item.captionStatus || (showCaption && showActivityContext && item.captionActor && item.captionActivity)}<div class="caption-action">
    {#if captionAction}{@render captionAction()}{:else if item.captionStatus}<span class="caption-status" data-tone={item.captionStatus.tone}><Button size="icon" href={item.captionStatus.href} icon={item.captionStatus.icon} label={`${item.captionStatus.label} · ${item.title}`} title={item.captionStatus.label}/></span>{:else if item.captionActivity}<ReactionActions targetKind="activity" targetId={item.captionActivity.id} initialReaction={item.captionActivity.myReaction} />{/if}
  </div>{/if}
  </div>{/if}
  {#if body}<div class="card-body">{@render body()}</div>{/if}
  {#if footer}<footer class="card-footer">{@render footer()}</footer>{/if}
  {#if showActivityContext && item.captionActivity && !item.captionActor}
    <div class="activity-reactions small quiet">
      {#if !item.captionActor}{#if item.captionActivity.dateKnown}<time datetime={item.captionActivity.occurredAt} title={new Date(item.captionActivity.occurredAt).toLocaleString()}>{activityDateLabel(item.captionActivity.occurredAt,clock.now)}</time>{:else}<span>{unknownActivityDate(item.captionActivity.kind)}</span>{/if}{/if}
      {#if !captionAction}<ReactionActions targetKind="activity" targetId={item.captionActivity.id} initialReaction={item.captionActivity.myReaction} />{/if}
    </div>
  {/if}
</article>

<style>
  .caption-status[data-tone='positive'] {color:var(--success);}
  .caption-status[data-tone='pending'] {color:var(--rating);}
  .caption-status[data-tone='negative'] {color:var(--danger);}
  .caption-status :global(.icon-button) {color:inherit;}
  .caption-row { display:flex; align-items:center; gap:8px; }
  .caption { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; -webkit-touch-callout:none; user-select:none; }
  .caption-action { flex-shrink:0; }
  .card-body { font-size:var(--text-sm); line-height:var(--leading-relaxed); overflow-wrap:anywhere; }
  .card-body :global(p) { margin:0; }
  .card-footer { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:var(--text-sm); color:var(--muted); }
  .card-body:empty, .card-footer:empty, .caption-action:empty { display:none; }
  .caption-row:not(:has(> .caption, > .caption-action:not(:empty))) { display:none; }
  .activity-context { min-height:24px; }
  .activity-media { font-size:var(--text-md); }
  .caption .activity-detail { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .wrap-activity .activity-detail,.wrap-activity .activity-media { white-space:normal; overflow:visible; overflow-wrap:anywhere; }
  .activity-reactions { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .card-status{position:absolute;bottom:8px;left:8px;right:8px;z-index:3;display:flex;align-items:flex-end;gap:8px;}
  .card-friends{position:absolute;top:8px;left:8px;z-index:3;max-width:calc(100% - 52px);}
  .card-progress{flex:1;min-width:0;height:6px;pointer-events:none;}

  .media-card {
    --text-link-gap:2px;
    display:flex;
    flex-direction:column;
    gap:8px;
    min-width:0;
  }
  .art {
    position: relative;
    flex:none;
    min-height:0;
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
  .art:is(:hover, :focus-within) {
    transform: scale(var(--media-surface-hover-scale));
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
  .art:is(:hover, :focus-within).unavailable img {
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
  .art:is(:hover, :focus-within)::before {
    opacity: 0.4;
  }
  .art::after {
    transition:
      border-width var(--fast),
      opacity var(--fast);
  }
  .art:hover::after,
  .art:focus-within::after {
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
    .art:hover .hover-stroke {
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
  .art:hover .play,
  .art:hover .card-menu,
  .art:focus-within .play,
  .art:focus-within .card-menu {
    opacity: 1;
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
  }
  .meta {
    font-size: var(--text-sm);
    color: var(--muted);
    display: flex;
    gap: 8px;
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
    gap: 4px;
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
