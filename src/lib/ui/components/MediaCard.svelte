<script lang="ts">
  import Button from './Button.svelte';
  import { page } from '$app/state';
  import ProgressBar from './ProgressBar.svelte';
  import { primaryMediaAction } from '#lib/media/model.js';
  import { canPlayMusicCard } from '#lib/music/presentation.js';
  import {navigateMedia} from '#lib/ui/media-navigation.js';
  import { cardArtwork, overlayArtwork } from '#lib/media/artwork.js';
  import { artworkCardProgress, cardLibraryLink, screenCardCaption, usesScreenCardCaption } from '../card-caption';
  import { cardBadgeCorners, cardSlotValue, type CardDataField, type CardSlotValue, type CardBadgeSlots, type CardMetadataLayer, type CardMetadataValues } from '../card-slots';
  import MediaCardMetric from '../cards/MediaCardMetric.svelte';
  import { cardLayoutNumber, defaultBadgeSlots, emptyBadgeSlots, layoutForCard } from '../cards/layout';
  import type { ArtworkPriority } from '#lib/ui/types.js';
  import { artworkTypes } from '#lib/artwork.js';
  import { displayLabel } from '#lib/ui/labels.js';
  import { tick, getContext, onDestroy } from 'svelte';
  import {provideRetention,type Retain} from '#lib/ui/retention.js';
  import type { Snippet } from 'svelte';
  import {getCardTaste} from '#lib/ui/card-taste-context.js';
  import {observeVisibility} from '#lib/ui/visibility.js';
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
  import {canShowTaste,detailTaste,readingVolumeId} from '../pages/detail';
  import WorkMenu from './WorkMenu.svelte';
  let {
    item,
    shape: baseShape = item.kind==='person'?'circle':'poster',
    artworkStyle: baseArtworkStyle = 'auto',
    monochromeMissing: baseMonochromeMissing,
    overlay: baseOverlay = 'none',
    artworkPriority: baseArtworkPriority,
    artworkOnly = false,
    onselect,
    social,
    showFriends = true,
    showActivityContext: baseShowActivityContext = true,
    showActivityHeader: baseShowActivityHeader,
    showCaption: baseShowCaption = true,
    showCaptionStatus: baseShowCaptionStatus = true,
    showWorkMetadata = true,
    showPrimaryAction: baseShowPrimaryAction = true,
    showArtworkMenu: baseShowArtworkMenu = true,
    showTimeRemaining = true,
    showProgressBar: baseShowProgressBar = true,
    metric = 'auto',
    badgeSlots: baseBadgeSlots,
    metadataLayers: baseMetadataLayers,
    metadataValues: baseMetadataValues,
    previewTasteScore,
    previewArtworkLoading = false,
    personalise = true,
    onPreviewMetric,
    primaryMenu,
    primaryMenuLabel,
    primaryMenuIcon,
    activityTrailing,
    activityProgress: baseActivityProgress,
    captionAction,
    cornerMenu,
    header,
    body,
    footer,
    retain,
  }: {
    item: MediaView | MediaCardPresentation | MediaCardDisplay;
    shape?: MediaCardShape;
    artworkStyle?: MediaCardArtwork;
    monochromeMissing?: boolean;
    overlay?: MediaCardOverlay;
    artworkPriority?: ArtworkPriority;
    artworkOnly?: boolean;
    onselect?: (item: MediaView) => void;
    showActivityContext?: boolean;
    showActivityHeader?: boolean;
    showCaption?:boolean;
    showCaptionStatus?: boolean;
    showWorkMetadata?: boolean;
    showPrimaryAction?:boolean;
    showArtworkMenu?: boolean;
    showTimeRemaining?: boolean;
    showProgressBar?: boolean;
    metric?: 'auto' | 'rating' | 'none';
    badgeSlots?: CardBadgeSlots;
    metadataLayers?: readonly CardMetadataLayer[];
    metadataValues?: CardMetadataValues;
    previewTasteScore?: number;
    previewArtworkLoading?: boolean;
    personalise?: boolean;
    onPreviewMetric?: (kind: 'rating' | 'match', value: number) => void;
    primaryMenu?:import('svelte').Snippet;
    primaryMenuLabel?: string;
    primaryMenuIcon?: import('./Icon.svelte').IconName;
    activityTrailing?:import('svelte').Snippet;
    activityProgress?:number|null;
    captionAction?: Snippet;
    cornerMenu?: Snippet;
    header?: Snippet;
    body?: Snippet;
    footer?: Snippet;
    retain?: Retain;
    social?:{friends:{username:string;avatar?:string|null;status?:import('#lib/social/status.js').ActivityStatus}[];total:number};
    showFriends?: boolean;
  } = $props();
  const layout = $derived(!preview && personalise && !artworkOnly && page.data.capabilities?.cardLayouts === true
    ? layoutForCard(page.data.user?.settings.cardLayouts, item.kind) : undefined);
  const preferences = $derived(layout?.settings);
  const shape = $derived(preferences?.shape && preferences.shape !== 'auto' ? preferences.shape : baseShape);
  const artworkStyle = $derived(preferences?.artwork === false ? 'none'
    : preferences?.artworkStyle && preferences.artworkStyle !== 'auto' ? preferences.artworkStyle : baseArtworkStyle);
  const artworkPriority = $derived(preferences?.artworkPriority || baseArtworkPriority);
  const overlay = $derived(artworkStyle === 'none' ? 'none'
    : preferences?.overlay && preferences.overlay !== 'auto' ? preferences.overlay : baseOverlay);
  const monochromeMissing = $derived(preferences?.monochromeMissing ?? baseMonochromeMissing);
  const showCaption = $derived(preferences?.caption ?? baseShowCaption);
  const showCaptionStatus = $derived(preferences?.requestStatus ?? baseShowCaptionStatus);
  const showPrimaryAction = $derived(baseShowPrimaryAction && preferences?.primaryAction !== false);
  const showArtworkMenu = $derived(preferences?.artworkMenu ?? baseShowArtworkMenu);
  const showActivityContext = $derived(preferences?.secondaryAction ?? baseShowActivityContext);
  const showActivityHeader = $derived(preferences?.header ?? baseShowActivityHeader ?? baseShowActivityContext);
  const showProgressBar = $derived(preferences?.progressBar ?? baseShowProgressBar);
  const metadataValues = $derived(layout?.metadataValues ?? baseMetadataValues);
  const metadataLayers = $derived(layout?.metadataLayers ?? baseMetadataLayers);
  const configuredBadges = $derived(layout?.badgeSlots ?? baseBadgeSlots);
  const badgeSlots = $derived(preferences?.badges === false ? emptyBadgeSlots : configuredBadges ?? defaultBadgeSlots);
  const progressOverride = $derived(layout && cardLayoutNumber(layout.metadataValues.progress, 100));
  const activityProgress = $derived(progressOverride === undefined ? baseActivityProgress : progressOverride / 100);
  const showBody = $derived(preferences?.body ?? !!body);
  const showFooter = $derived(preferences?.footer ?? !!footer);
  const customHeader = $derived(!!layout && (preferences?.headerLeading !== 'actor' ||
    preferences?.headerTrailing !== 'activity-date' || !!(metadataValues?.actor || metadataValues?.['activity-date'])));

  const retainCard=provideRetention(()=>retain?.()??(()=>{}));
  const {current:getTasteBatch, explain:explainTaste}=getCardTaste();
  const ratingOverride = $derived(layout && cardLayoutNumber(layout.metadataValues.rating, 5));
  const tasteOverride = $derived(layout && page.data.experimentalCardTasteScores && !('href' in item && item.href === null) && canShowTaste(item, page.data.capabilities)
    ? cardLayoutNumber(layout.metadataValues.match, 100) : undefined);
  const rating = $derived(item.kind !== 'person' && !item.captionActor ? ratingOverride ?? item.rating ?? undefined : undefined);
  const requestsTaste = (field: string) => field === 'match' || (field === 'rating-or-match' && rating === undefined);
  const wantsTaste = $derived((metric === 'auto' && Object.values(badgeSlots).some(requestsTaste)) ||
    (showCaption && metadataLayers?.some(({ fields }) => fields.some(requestsTaste))));
  const tasteId=$derived(!preview && tasteOverride === undefined && page.data.experimentalCardTasteScores && wantsTaste &&
    !artworkOnly && !item.captionActor && item.kind !== 'collection' && item.kind !== 'episode' && item.kind !== 'season' &&
    !('href' in item && item.href === null) && canShowTaste(item, page.data.capabilities) ? detailTaste(item)?.workId : undefined);
  const tasteBatch=$derived(tasteId ? getTasteBatch() : undefined);
  let match=$state.raw<{batch:NonNullable<ReturnType<typeof getTasteBatch>>;id:string;score:number}>();
  const tasteScore=$derived(match && match.batch===tasteBatch && match.id===tasteId ? match.score : tasteId && tasteBatch ? tasteBatch.peek(tasteId) : undefined);
  const metricKind = $derived<'rating' | 'match'>(rating === undefined ? 'match' : 'rating');
  const matchValue = $derived(preview ? previewTasteScore : tasteOverride ?? tasteScore);
  const slotData = $derived.by(() => {
    const current = item;
    const progress = activityProgress;
    const overrides = metadataValues;
    const fields = new Map<CardDataField, CardSlotValue[]>();
    return (field: CardDataField) => {
      let result = fields.get(field);
      if (!result) {
        result = cardSlotValue(current, field, progress, overrides);
        fields.set(field, result);
      }
      return result;
    };
  });
  const captionStatus = $derived(showCaptionStatus ? item.captionStatus : undefined);
  const visibleCaptionAction = $derived(preferences?.secondaryAction === false ? undefined : captionAction);
  const showRatingBadge = $derived(metric !== 'none');
  const showMatchBadge = $derived(metric === 'auto');
  function slotScore(field: 'rating' | 'match' | 'rating-or-match') {
    if (field === 'rating') return { kind: 'rating' as const, value: ratingOverride ?? item.rating ?? undefined };
    if (field === 'match') return { kind: 'match' as const, value: matchValue };
    return { kind: metricKind, value: rating ?? matchValue };
  }
  function openTasteBreakdown(event: MouseEvent) {
    event.stopPropagation();
    if (tasteId && tasteScore !== undefined)
      explainTaste({ workId: tasteId, title: item.title, kind: item.kind, cardScore: tasteScore });
  }
  function watchTaste(node:HTMLElement) {
    $effect(()=>{
      const batch=tasteBatch,id=tasteId;
      if(!id || !batch) return;
      let release:(()=>void)|undefined;
      const stop=observeVisibility(node,visible=>{
        if(visible) release??=batch.watch(id,score=>{
          if(batch===tasteBatch && id===tasteId) match=score===undefined ? undefined : {batch,id,score};
        });
        else {release?.();release=undefined;}
      });
      return ()=>{stop();release?.();};
    });
  }
  let releaseFocus:(()=>void)|undefined;
  function cardFocus(event:FocusEvent) {
    if(event.type==='focusin'){releaseFocus??=retainCard();}
    else if(!(event.relatedTarget instanceof Node)||!(event.currentTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget)){
      releaseFocus?.();releaseFocus=undefined;
    }
  }
  onDestroy(()=>releaseFocus?.());
  const activityHeaderVisible = $derived(showActivityHeader);
  const clock=useClock('minute',()=>(item.captionActor ? activityHeaderVisible : showActivityContext)&&!!(item.captionActivity?.dateKnown||item.captionDate));
  const contextReadOnly = getContext<() => boolean>('profile-read-only') ?? (() => false);
  const readOnly = () => !page.data.user || contextReadOnly() || ('href' in item&&(item.href===null&&!primaryMenu||item.kind==='collection'&&!item.workId&&!readingVolumeId(item)));
  const hasCardMenu = $derived(showArtworkMenu && !readOnly() && !cornerMenu && item.kind !== 'person');
  const hasPrimaryControl = $derived(showPrimaryAction && (!readOnly() || (preview && !!primaryMenu)));
  const canActivateMetric = (kind: 'rating' | 'match') =>
    preview && !!onPreviewMetric || (kind === 'rating' ? hasCardMenu && !primaryMenu : !!tasteId);
  const trackedItem = $derived('href' in item ? undefined : item);
  const href = $derived('href' in item ? item.href??undefined : `/media/${item.id}`);
  function headerSlot(field: NonNullable<typeof preferences>['headerLeading']) {
    if (field === 'none') return;
    if (field === 'title') return { text: metadataValues?.title?.trim() || item.captionTitle || item.title, href };
    return slotData(field)[0];
  }
  const activityHref=$derived(href ? detailHref(href,{section:'activity',relationship:'all'}) : undefined);
  const captionSubtitle = $derived(metadataValues?.subtitle?.trim() || item.captionSubtitle);
  const screenCaption = $derived(trackedItem && usesScreenCardCaption(trackedItem, showWorkMetadata)
    ? screenCardCaption(trackedItem, showTimeRemaining, metadataValues) : undefined);
  const screenNote = $derived(screenCaption && captionSubtitle && captionSubtitle !== String(item.year ?? '') &&
    item.captionSubtitleHref !== href && (!item.captionSubtitleHref || item.captionSubtitleHref !== screenCaption.label?.href)
    ? { text: captionSubtitle.replaceAll(' · ', ' '), href: item.captionSubtitleHref } : undefined);
  const libraryLabel = $derived(!captionSubtitle && (item.kind !== 'collection' || trackedItem) ? cardLibraryLink(item.kind) : undefined);
  const activityText = $derived(metadataValues?.activity?.trim() ||
    [item.captionActivity?.action ?? captionSubtitle, item.captionActivity?.detail].filter(Boolean).join(' '));
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
  let cornerMenuButton=$state<Button>();
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
  const loading = $derived(!!artwork && (loadedArtwork !== artwork || (preview && previewArtworkLoading)));
  const cardSocial = $derived(showFriends && !loading && (configuredBadges || !item.captionActor) && social?.total ? social : undefined);
  function hasBadge(field: typeof badgeSlots[keyof typeof badgeSlots]) {
    if (field === 'friends') return !!cardSocial;
    if (field === 'none') return false;
    if (field === 'rating' || field === 'match' || field === 'rating-or-match') {
      const score = slotScore(field);
      return score.value !== undefined && (score.kind === 'rating' ? showRatingBadge : showMatchBadge);
    }
    return slotData(field).length > 0;
  }
  const hasBadges = $derived(!loading && Object.values(badgeSlots).some(hasBadge));
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
    if (loading || (!cornerMenuButton && (readOnly() || item.kind === 'person' && !primaryMenu))) return;
    const release=retainCard();
    try {
    active = true;
    await tick();
    if (primaryMenu) primaryMenuButton?.openAt(point);
    else if (cornerMenuButton) cornerMenuButton.openAt(point);
    else actions?.openAt(point);
    } finally {release();}
  }
  const primaryAction = $derived(
    trackedItem?.playbackPending || page.data.capabilities?.playback===false && !['game','book','comic'].includes(item.kind) || page.data.capabilities?.reader===false && ['book','comic'].includes(item.kind) ? 'open' : trackedItem
      ? primaryMediaAction({
          category: trackedItem.category ?? 'screen',
          canOpen: trackedItem.canOpen ?? trackedItem.available,
          canRequest: page.data.capabilities?.requests!==false && (trackedItem.requestable ?? ((trackedItem.category ?? 'screen') === 'screen' && !trackedItem.available)),
        })
      : (item.kind === 'book' || item.kind === 'comic') && item.workId && item.available ? 'read' : canPlayMusicCard(item) ? 'play' : 'open'
  );
  const cardProgress = $derived(artworkCardProgress(item, showWorkMetadata && preferences?.progressBar !== true, activityProgress));
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
    $effect(() => {
      if (!loading && (showArtworkMenu || primaryMenu)) return contextGesture(node, openMenu).destroy;
    });
  }
  function activateMetric(event: MouseEvent, kind: 'rating' | 'match', value: number) {
    if (preview && onPreviewMetric) { onPreviewMetric(kind, value); return; }
    if (kind === 'match') { openTasteBreakdown(event); return; }
    if (event.currentTarget instanceof HTMLElement) {
      const {left, bottom} = event.currentTarget.getBoundingClientRect();
      void openMenu({x:left,y:bottom});
    }
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

{#snippet artworkImage()}
  {#if artwork}<img
    use:lazyImage={artwork}
    alt=""
    loading="lazy"
    decoding="async"
    draggable="false"
    onload={event => { loadedArtwork = event.currentTarget.getAttribute('src') ?? undefined; }}
    onerror={() => (imageIndex += 1)}
  />{/if}
{/snippet}

{#snippet friendHeads()}
  {#if cardSocial}
    <SocialControls friends={cardSocial.friends} total={cardSocial.total} href={activityHref}
      compact size={26} label={`View activity for ${item.title}`} />
  {/if}
{/snippet}

{#snippet captionLink(link: { text: string; href?: string })}
  {#if link.href && (page.data.user || !link.href.startsWith('/library?'))}
    <TextLink text={link.text} href={link.href}/>
  {:else}{link.text}{/if}
{/snippet}

{#snippet artworkSample(source: string)}
  <div class="artwork-sample" aria-hidden="true">
    <img src={source} alt="" decoding="async" draggable="false" />
  </div>
{/snippet}

{#snippet scoreBadge(kind: 'rating' | 'match', value: number)}
  <div class="artwork-badge">
    {#if artwork}{@render artworkSample(artwork)}{/if}
    <MediaCardMetric {kind} {value} title={item.title} artwork={item.poster ?? item.artwork?.primary ?? artwork}
      popup={preview || kind === 'match' ? 'dialog' : 'menu'}
      onclick={canActivateMetric(kind) ? event => activateMetric(event, kind, value) : undefined} />
  </div>
{/snippet}

{#snippet captionTitle()}
  {@const title = metadataValues?.title?.trim() || (screenCaption?.title ?? item.captionTitle ?? item.title)}
  {@const titleHref = screenCaption ? href : item.captionTitleHref ?? href}
  <div class="title" class:activity-media={!!item.captionActor}>
    {#if titleHref}<TextLink href={titleHref} text={title} onclick={event=>{if(!item.captionTitleHref || screenCaption)select(event);}}/>{:else}{title}{/if}
  </div>
{/snippet}

{#snippet captionDetails()}
  {#if metadataValues?.default?.trim()}
    <div class="meta">{metadataValues.default.trim()}</div>
  {:else if item.captionActor}
    {#if activityText}<div class="meta activity-detail">{activityText}</div>{/if}
  {:else if screenCaption}
    <div class="meta screen-meta">
      {#if screenCaption.context}<span class="subtitle caption-context">{@render captionLink(screenCaption.context)}</span>{/if}
      {#if screenCaption.label}<span class="subtitle screen-label">{@render captionLink(screenCaption.label)}</span>{/if}
      {#if screenCaption.detail}<span class="viewing-detail">{screenCaption.detail}</span>{/if}
      {#if screenNote}<span class="subtitle screen-note">{@render captionLink(screenNote)}</span>{/if}
    </div>
  {:else if item.kind !== 'person' || captionSubtitle}
    <div class="meta">{#if captionSubtitle}<span class="subtitle">
      {#if item.captionCredits?.length && item.captionCredits.map(credit=>credit.name).join(', ')===captionSubtitle}
        {#each item.captionCredits as credit,index}{#if index}{', '}{/if}{#if credit.href}<TextLink href={credit.href} text={credit.name}/>{:else}{credit.name}{/if}{/each}
      {:else if item.captionSubtitleHref}<TextLink href={item.captionSubtitleHref} text={captionSubtitle}/>
      {:else}{captionSubtitle}{/if}
    </span>{:else if libraryLabel}{@render captionLink(libraryLabel)}{:else}{displayLabel(item.kind)}{/if}</div>
  {/if}
{/snippet}

{#snippet primaryControl()}
  <button
    type="button"
    class="play glass icon-button"
    use:liquidGlass
    aria-label={primaryMenu ? (primaryMenuLabel ?? `Actions for ${item.title}`) : `${primaryLabel} ${item.title}`}
    title={trackedItem?.playbackPending && !primaryMenu ? 'Stream pending · Open details' : undefined}
    aria-haspopup={primaryMenu ? 'menu' : undefined}
    onclick={activate}
  ><Icon name={primaryMenu ? (primaryMenuIcon ?? 'more') : primaryAction === 'play'
      ? 'play' : primaryAction === 'read' ? 'library' : primaryAction === 'request' ? 'request' : 'arrow'}
    size={28}
  /></button>
{/snippet}

{#snippet menuControl()}
  <div class="card-menu sampled-menu">
    {#if !loading && artwork}{@render artworkSample(artwork)}{/if}
    <button
      type="button"
      class="icon-button glass"
      use:liquidGlass
      aria-label={`Actions for ${item.title}`}
      aria-haspopup="menu"
      onclick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        void openMenu({ x: rect.left, y: rect.bottom });
      }}><Icon name="more" size={18} /></button
    >
  </div>
{/snippet}

{#if artworkOnly}
  {#if artwork}
    <div class="media-card" class:loading aria-hidden="true">
      <div class="art media-surface-edge {shape}" class:skeleton={loading}>
        <div class="art-link">{@render artworkImage()}</div>
      </div>
    </div>
  {/if}
{:else}
<article
  class="media-card"
  class:loading
  inert={loading}
  use:cardGesture
  use:watchTaste
  onfocusin={cardFocus}
  onfocusout={cardFocus}
>
  {#if header && preferences?.header !== false}
    <div class="activity-context">{@render header()}</div>
  {:else if activityHeaderVisible && customHeader && preferences}
    {@const left = headerSlot(preferences.headerLeading)}
    {@const right = headerSlot(preferences.headerTrailing)}
    {#if preferences.headerLeading === 'actor' && left}
      <div class="activity-context">
        <ActivityHeader username={left.text} avatar={item.captionActor?.avatar} status={item.captionActor?.status}
          profileHref={left.href ?? null} showAvatar={!loading} nonApproved>
          {#snippet trailing()}{#if right}{@render captionLink(right)}{/if}{/snippet}
        </ActivityHeader>
      </div>
    {:else if left || right}
      <div class="activity-context metadata-header">
        {#if left}<span>{@render captionLink(left)}</span>{/if}
        {#if right}<span class="metadata-header-right">{@render captionLink(right)}</span>{/if}
      </div>
    {/if}
  {:else if activityHeaderVisible && item.captionActor}
    <div class="activity-context">
      <ActivityHeader username={item.captionActor.username} avatar={item.captionActor.avatar} status={item.captionActor.status} profileHref={item.captionActor.profileHref} showAvatar={!loading} nonApproved>
        {#snippet trailing()}{#if activityTrailing}{@render activityTrailing()}{:else if item.captionActivity}{#if item.captionActivity.dateKnown}<time datetime={item.captionActivity.occurredAt} title={new Date(item.captionActivity.occurredAt).toLocaleString()}>{activityDateLabel(item.captionActivity.occurredAt,clock.now)}</time>{:else}<span>{unknownActivityDate(item.captionActivity.kind)}</span>{/if}{:else if item.captionDate}<time datetime={item.captionDate} title={new Date(item.captionDate).toLocaleString()}>{activityDateLabel(item.captionDate,clock.now)}</time>{/if}{/snippet}
      </ActivityHeader>
    </div>
  {/if}
  <div
    class="art media-surface-edge {shape}"
    class:skeleton={loading}
    class:unavailable={(monochromeMissing ?? (!!page.data.user && page.data.user.settings?.monochromeMissing !== false)) && item.available === false}
    class:has-artwork-menu={hasCardMenu || !!(showArtworkMenu && cornerMenu)}
    class:contained
    title={artworkHint}
  >
    <a class="art-link" {href} aria-label={primaryMenu && !showPrimaryAction ? `Actions for ${item.title}` : item.title}
      role={primaryMenu && !showPrimaryAction ? 'button' : undefined} aria-haspopup={primaryMenu && !showPrimaryAction ? 'menu' : undefined}
      onkeydown={event => { if (primaryMenu && !showPrimaryAction && event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } }}
      onclick={event => { if (primaryMenu && !showPrimaryAction) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); void openMenu({ x: rect.left, y: rect.bottom }); } else select(event); }} draggable="false">
      {#if artwork}{@render artworkImage()}
      {:else if artworkStyle !== 'none'}<div class="fallback">
          <Icon
            name={item.kind === 'artist' || item.kind === 'person'
              ? 'user'
              : item.kind === 'album' || item.kind === 'track' || item.kind === 'game'
                ? 'library'
                : item.kind === 'show' || item.kind === 'book' || item.kind === 'comic'
                  ? 'library'
                  : 'film'}
            size={32}
          />
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
    {#if !loading && (hasPrimaryControl || hasCardMenu || hasBadges)}
      <div class="artwork-overlays">
        {#if hasPrimaryControl}
          <div class="sampled-primary">
            {#if !loading && artwork}{@render artworkSample(artwork)}{/if}
            {@render primaryControl()}
          </div>
        {/if}
        {#if hasCardMenu}{@render menuControl()}{/if}
        {#if hasBadges}
          {#each cardBadgeCorners as { id } (id)}
            {@const field = badgeSlots[id]}
            {#if field !== 'none' && hasBadge(field)}
              <div class="badge-corner" data-corner={id}>
                {#if field === 'friends'}
                  {#if cardSocial}<div class="artwork-friends">{@render friendHeads()}</div>{/if}
                {:else if field === 'rating' || field === 'match' || field === 'rating-or-match'}
                  {@const { kind, value } = slotScore(field)}
                  {#if value !== undefined}{@render scoreBadge(kind, value)}{/if}
                {:else if slotData(field).length}
                  {@const text = slotData(field).map(value => value.text).join(', ')}
                  <div class="artwork-badge">
                    {#if artwork}{@render artworkSample(artwork)}{/if}
                    <span class="slot-badge glass" use:liquidGlass={{ variant: 'clear' }} title={text}>{text}</span>
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        {/if}
      </div>
    {/if}
    {#if primaryMenu && (!readOnly() || preview)}
      <Button menu hideTrigger bind:this={primaryMenuButton} label={primaryMenuLabel ?? `Actions for ${item.title}`}>{@render primaryMenu()}</Button>
    {/if}
    {#if !loading && showArtworkMenu && cornerMenu}
      <div class="card-menu sampled-menu">
        {#if artwork}{@render artworkSample(artwork)}{/if}
        <Button menu bind:this={cornerMenuButton} material="clear" triggerClass="icon-button card-menu-pill" label={`Actions for ${item.captionTitle ?? item.title}`} iconSize={18}>
          {@render cornerMenu()}
        </Button>
      </div>
    {/if}
    {#if active && (hasCardMenu || (hasPrimaryControl && !primaryMenu && !preview)) && !('href' in item && item.href === null)}
      <WorkMenu bind:this={actions} {item} menuOnly />
    {/if}
    {#if !loading && showProgressBar && cardProgress!==null}<div class="card-status">
      <div class="card-progress"><ProgressBar progress={cardProgress} label={`${item.title}${item.captionActor?' playback':''} progress`} /></div>
    </div>{/if}
  </div>
  {#if showCaption || visibleCaptionAction || captionStatus}
    <div class="caption-row">
      {#if showCaption}
        <div class="caption" class:activity-attribution={!!item.captionActor}>
          {#if metadataLayers}
            {#each metadataLayers as { size, fields }}
              <div class="caption-layer" data-size={size}>
                {#each fields as field}
                  {#if field === 'title'}{@render captionTitle()}
                  {:else if field === 'default'}{@render captionDetails()}
                  {:else if field === 'rating' || field === 'match' || field === 'rating-or-match'}
                    {@const { kind, value } = slotScore(field)}
                    {#if value !== undefined}<span>{kind === 'rating' ? `${value}/5` : `${value}%`}</span>{/if}
                  {:else if field !== 'none' && slotData(field).length}
                    <span>{#each slotData(field) as value, index}{#if index}{', '}{/if}{@render captionLink(value)}{/each}</span>
                  {/if}
                {/each}
              </div>
            {/each}
          {:else}
            {@render captionTitle()}
            {@render captionDetails()}
          {/if}
        </div>
      {/if}
      {#if visibleCaptionAction || captionStatus || (showCaption && showActivityContext && item.captionActor && item.captionActivity)}
        <div class="caption-action" class:caption-action-pair={preview && !!visibleCaptionAction && !!captionStatus}>
          {#if visibleCaptionAction}{@render visibleCaptionAction()}{/if}
          {#if captionStatus && (!visibleCaptionAction || preview)}<span class="caption-status" data-tone={captionStatus.tone} role="img"
            aria-label={`${captionStatus.label} · ${item.title}`} title={captionStatus.label}><Icon name={captionStatus.icon} /></span>
          {:else if !visibleCaptionAction && item.captionActivity}<ReactionActions targetKind="activity" targetId={item.captionActivity.id} initialReaction={item.captionActivity.myReaction} />{/if}
        </div>
      {/if}
    </div>
  {/if}
  {#if showBody}
    <div class="card-body">{#if layout?.metadataValues.body}{layout.metadataValues.body}{:else if body}{@render body()}{:else}{trackedItem?.overview}{/if}</div>
  {/if}
  {#if showFooter}
    <footer class="card-footer">{#if layout?.metadataValues.footer}{layout.metadataValues.footer}{:else if footer}{@render footer()}{:else}{slotData('release-date')[0]?.text}{/if}</footer>
  {/if}
  {#if showActivityContext && item.captionActivity && !item.captionActor}
    <div class="activity-reactions small quiet">
      {#if !item.captionActor}{#if item.captionActivity.dateKnown}<time datetime={item.captionActivity.occurredAt} title={new Date(item.captionActivity.occurredAt).toLocaleString()}>{activityDateLabel(item.captionActivity.occurredAt,clock.now)}</time>{:else}<span>{unknownActivityDate(item.captionActivity.kind)}</span>{/if}{/if}
      {#if !visibleCaptionAction}<ReactionActions targetKind="activity" targetId={item.captionActivity.id} initialReaction={item.captionActivity.myReaction} />{/if}
    </div>
  {/if}
</article>
{/if}

<style>
  @property --card-glass-scale {
    syntax: '<number>';
    inherits: true;
    initial-value: 1;
  }
  .caption-status[data-tone='positive'] {color:var(--success);}
  .caption-status[data-tone='pending'] {color:var(--rating);}
  .caption-status[data-tone='negative'] {color:var(--danger);}
  .caption-status {display:grid;place-items:center;width:var(--control-compact-height);height:var(--control-compact-height);}
  .caption-row { display:flex; align-items:center; gap:8px; }
  .caption { flex:1; min-width:0; display:flex; flex-direction:column; gap:var(--row-text-gap); -webkit-touch-callout:none; user-select:none; }
  .caption-action { flex-shrink:0; }
  .caption-action-pair { display:flex; align-items:center; gap:4px; }
  .card-body { font-size:var(--text-sm); line-height:var(--leading-relaxed); overflow-wrap:anywhere; }
  .card-body :global(p) { margin:0; }
  .card-footer { display:flex; flex-wrap:wrap; align-items:center; gap:var(--media-metadata-gap); font-size:var(--text-sm); color:var(--muted); }
  .card-body:empty, .card-footer:empty, .caption-action:empty { display:none; }
  .caption-layer { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px var(--media-metadata-gap); overflow-wrap:anywhere; }
  .caption:not(:has(> :not(.caption-layer), > .caption-layer > *)),
  .caption-layer:empty,
  .caption-row:not(:has(> .caption > :not(.caption-layer), > .caption > .caption-layer > *, > .caption-action:not(:empty))) { display:none; }
  .caption-layer > * { min-width:0; }
  .caption-layer > :is(.title, .meta) { font-size:inherit; color:inherit; }
  .caption-layer[data-size='small'] { font-size:var(--text-sm); color:var(--muted); }
  .caption-layer[data-size='medium'] { font-size:var(--text-md); }
  .caption-layer[data-size='large'] { font-size:var(--text-xl); }
  .activity-context { min-height:24px; }
  .metadata-header { display:flex; align-items:center; gap:var(--media-metadata-gap); font-weight:var(--weight-semibold); overflow-wrap:anywhere; }
  .metadata-header > span { min-inline-size:0; }
  .metadata-header-right { margin-inline-start:auto; color:var(--muted); font-size:var(--text-sm); }
  .activity-media { font-size:var(--text-md); }
  .activity-attribution .activity-detail { display:block; }
  .activity-attribution :is(.activity-detail, .activity-media) { white-space:normal; overflow:visible; overflow-wrap:anywhere; }
  .activity-reactions { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .card-status{position:absolute;bottom:8px;left:8px;right:8px;z-index:3;display:flex;align-items:flex-end;gap:8px;}
  .artwork-overlays {
    --card-bottom-overlay-inset: var(--media-card-badge-inset, 8px);
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    /* Keep the fixed artwork sample aligned to the card as it scales. */
    contain: layout;
  }
  .art:has(.card-status) .artwork-overlays { --card-bottom-overlay-inset: 18px; }
  .badge-corner {
    --corner-inset: var(--media-card-badge-inset, 8px);
    --menu-clearance: 0px;
    position:absolute;
    display:flex;
    max-inline-size:calc(50% - var(--corner-inset));
  }
  .badge-corner:empty { display:none; }
  .badge-corner[data-corner^='top'] { inset-block-start:var(--corner-inset); }
  .badge-corner[data-corner^='bottom'] { inset-block-end:max(var(--corner-inset), var(--card-bottom-overlay-inset)); }
  .badge-corner[data-corner$='left'] { inset-inline-start:var(--corner-inset); }
  .badge-corner[data-corner$='right'] { inset-inline-end:calc(var(--corner-inset) + var(--menu-clearance)); }
  .badge-corner[data-corner='top-right'] { transition:inset-inline-end var(--fast) var(--ease); }
  .has-artwork-menu:is(:hover, :focus-within) .badge-corner[data-corner='top-right'] {
    --menu-clearance:calc(2 * var(--artwork-badge-radius) + 13px);
  }
  .art.circle .badge-corner { --corner-inset:15%; }
  .slot-badge {
    min-inline-size:0;
    padding:var(--metric-spacing);
    border-radius:var(--artwork-badge-radius);
    color:var(--white);
    font-size:var(--text-sm);
    font-weight:var(--weight-semibold);
    line-height:var(--leading-card-metric);
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    pointer-events:auto;
    scale:var(--card-glass-scale, 1);
  }
  @media (hover: none) {
    .has-artwork-menu .badge-corner[data-corner='top-right'] { --menu-clearance:calc(2 * var(--artwork-badge-radius) + 13px); }
  }
  .artwork-badge, .artwork-friends { display: flex; pointer-events: auto; }
  .artwork-badge { position: relative; min-inline-size:0; }
  .sampled-primary {
    --artwork-badge-radius: 50%;
    position: absolute;
    inset: 0;
    margin: auto;
    width: var(--card-primary-size);
    height: var(--card-primary-size);
  }
  .artwork-sample {
    position: absolute;
    inset: 0;
    clip-path: inset(
      calc(1px - (var(--card-glass-scale, 1) - 1) * 50%)
      round calc(var(--artwork-badge-radius) * var(--card-glass-scale, 1))
    );
    pointer-events: none;
  }
  .artwork-sample img {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: var(--surface);
  }
  .artwork-friends { margin: 1px; margin-inline-start: auto; }
  .card-progress{flex:1;min-width:0;height:6px;pointer-events:none;}

  .media-card {
    --metric-spacing:6px;
    --artwork-badge-radius:calc(var(--leading-card-metric) / 2 + var(--metric-spacing));
    --media-card-badge-inset:calc(2 * var(--media-card-hover-edge-width));
    --card-control-hover-scale:1.08;
    --card-elastic-duration:320ms;
    --card-elastic-easing:linear(0, 0.15 8%, 0.58 20%, 1.17 36%, 1.34 47%, 1.22 57%, 1.04 69%, 0.9 81%, 0.94 90%, 1);
    display:flex;
    flex-direction:column;
    gap:8px;
    min-width:0;
  }
  .art {
    --card-primary-size: 58px;
    position: relative;
    flex:none;
    min-height:0;
    aspect-ratio: 2/3;
    border-radius: var(--media-card-corner-radius);
    isolation: isolate;
    background: var(--surface);
    transition: transform var(--fast) var(--ease);
  }
  .art.circle{aspect-ratio:1;border-radius:50%;}
  .loading .fallback,.loading .play,.loading .card-menu{visibility:hidden;}
  .loading .art-link img,.loading .art-overlay{visibility:hidden!important;}
  .art.circle .art-link{border-radius:50%;}
  .media-card:has(.art.circle) .caption-row{text-align:center;}
  .media-card:has(.art.circle) .meta{justify-content:center;}
  .media-card:has(.art.circle) .caption-layer{justify-content:center;}
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
    transform: scale(1.03);
  }
  .media-card.loading .art {transform:none;}
  .media-card.loading .art::before {display:none;}
  .art.contained :is(.art-link, .artwork-sample) img {
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
  .art.unavailable { --media-card-grayscale: 1; }
  .art.unavailable:is(:hover, :focus-within) { --media-card-grayscale: 0; }
  .art.unavailable img {
    filter: grayscale(var(--media-card-grayscale));
    transition: filter var(--fast) var(--ease);
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
  .art.banner { --card-primary-size: 44px; }
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
    --card-edge-width:var(--media-surface-edge-width);
    z-index:2;
    border:0;
    box-shadow:inset 0 0 0 var(--card-edge-width) var(--white);
    transition:box-shadow var(--fast), opacity var(--fast);
  }
  .media-card:not(.loading) .art:is(:hover, :focus-within)::after {
    --card-edge-width:var(--media-card-hover-edge-width);
    opacity: 1;
  }
  .play {
    position: absolute;
    inset: 0;
    width: var(--card-primary-size);
    height: var(--card-primary-size);
    z-index: 2;
    border-radius: 50%;
    pointer-events: auto;
  }
  .card-menu {
    position: absolute;
    right: 6px;
    top: 6px;
    z-index: 2;
  }
  .card-menu > button,
  .card-menu > :global(.context > .icon-button) {
    width: var(--control-compact-height);
    height: var(--control-compact-height);
  }
  .card-menu.sampled-menu {
    top: var(--media-card-badge-inset, 6px);
    right: var(--media-card-badge-inset, 6px);
    pointer-events: auto;
    opacity: 1;
  }
  .card-menu.sampled-menu > button, .card-menu :global(.card-menu-pill) {
    /* The visible 18 px icon is 9 px wider than it is tall. */
    width: calc(2 * var(--artwork-badge-radius, 14px) + 9px);
    height: calc(2 * var(--artwork-badge-radius, 14px));
    border-radius: var(--artwork-badge-radius, 14px);
    color: var(--white);
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
  :is(.sampled-primary, .sampled-menu) > :is(button, .artwork-sample, :global(.context)) {
    opacity: 0;
    transition: opacity var(--fast);
  }
  .art:is(:hover, :focus-within) :is(.sampled-primary, .sampled-menu) > :is(button, .artwork-sample, :global(.context)) {
    opacity: 1;
  }
  @media (hover: none) {
    .art::before {
      opacity: 0.4;
    }
    .play,
    .card-menu,
    :is(.sampled-primary, .sampled-menu) > :is(button, .artwork-sample, :global(.context)) {
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
    gap: var(--media-metadata-gap);
  }
  .subtitle {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .screen-meta {white-space:nowrap;}
  .screen-meta .screen-label {flex:none;max-inline-size:50%;}
  .screen-meta .viewing-detail {flex:none;}
  .screen-note {flex-shrink:2;}
  @media (prefers-reduced-motion: no-preference) {
    .art {transition-duration:var(--card-elastic-duration);transition-timing-function:var(--card-elastic-easing);}
    :is(.artwork-badge, .sampled-primary, .sampled-menu) {
      transition:--card-glass-scale var(--card-elastic-duration) var(--card-elastic-easing);
    }
    :is(.sampled-primary, .sampled-menu) > button, .sampled-menu :global(.card-menu-pill) {
      scale:var(--card-glass-scale, 1);
    }
    .artwork-badge:hover,
    .artwork-badge:has(:global(.card-metric:focus-visible)),
    .sampled-primary:has(.play:is(:hover, :focus-visible)),
    .sampled-menu:has(:is(button:hover, button:focus-visible)) {
      --card-glass-scale:var(--card-control-hover-scale);
    }
    .artwork-friends :global(a) {transition:scale var(--card-elastic-duration) var(--card-elastic-easing);}
    .artwork-friends :global(a:is(:hover, :focus-visible)) {scale:var(--card-control-hover-scale);}
  }
  @media (prefers-reduced-motion: reduce) {
    .art,
    .badge-corner[data-corner='top-right'],
    .art::before,
    .art::after,
    .art.unavailable img,
    .play,
    :is(.sampled-primary, .sampled-menu) > :is(button, .artwork-sample),
    .card-menu {
      transition: none;
    }
    .art:is(:hover, :focus-within) {transform:none;}
  }
</style>
