<script lang="ts" generics="T extends MediaView | MediaCardPresentation">
  import { mixedCardStyle, cardAspectRatio } from '#lib/ui/mixed-card.js';
  import type { ReadonlyURL } from '$app/state';
  import { shelfControls } from '#lib/ui/shelves/controls.js';
  import {availabilityControl} from '#lib/ui/controls/actions.js';
  import {useDetailSection} from '#lib/ui/detail-section.svelte.js';
  import type {ComponentProps} from 'svelte';
  import { reportFailure } from '#lib/ui/client-context.js';
  import type { FilterGroup } from '#lib/ui/controls/filters.js';
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { createShelfSource, type ShelfConfig } from '#lib/ui/shelves/index.js';
  import type { ShelfControl } from '#lib/ui/shelves/types.js';
  import { createShelfSelection } from '#lib/ui/shelves/local.svelte.js';
  import { createShelfLayout } from '#lib/ui/shelves/layout.svelte.js';
  import { createShelfContinuation } from '#lib/ui/shelves/continuation.svelte.js';
  import { lazyContent } from '#lib/ui/lazy-content.js';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
  import Pagination from './Pagination.svelte';
  import { createSequencePlayback } from '#lib/ui/controls/sequence.svelte.js';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  import { page } from '$app/state';
  import { useClient } from '#lib/ui/client-context.js';
  import { contentRevisionKey } from '#lib/ui/content-revision.svelte.js';
  import { createSocialEnrichment, type SocialEnrichment } from '#lib/ui/social-enrichment.js';
  import { observeVisibility } from '#lib/ui/visibility.js';

  import RowFilter from './RowFilter.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import type { ArtworkPriority, MediaView, MediaCardPresentation, MediaCardShape, MediaCardArtwork } from '#lib/ui/types.js';
  import RowStyleMenu from './RowStyleMenu.svelte';
  import Heading from './Heading.svelte';
  import { contextGesture } from '#lib/ui/context-gesture.js';
  import type { MediaRowStyle, MediaCardOverlay } from '#lib/ui/types.js';
  import Shelf from './Shelf.svelte';
  import { journalCards, type JournalCards, type JournalCard } from '#lib/ui/shelves/journal-cards.js';
  import DetailCard from './DetailCard.svelte';
  import type { InsightPanel } from '#lib/ui/insights/types.js';
  import MediaCard from './MediaCard.svelte';

  const { api, change, preview } = useClient();
  const sequence = createSequencePlayback({source: () => adapter?.sequence, experimentalMusic: () => !!page.data.experimentalMusic, preview, api, change});

  let {
    title = '', items = [], source, panels, journal, href, children, heading, before, size = 'poster', mixed = false, overlay = 'none', artworkOptions = true, shape, layout = 'row', artworkStyle, artworkPriority,
    mediaKind = 'screen', segments: customSegments, controls: customControls, filterGroups = [], actions, error = '', retry, empty, details, captionAction, body, footer,
    busy = false, hideEmpty = true, itemCount, preserveHeight, rows = 1, hasMore = false, onend, resetKey,
    url = page.url, pageNumber, pages, onpage, pageUrl, onsettled, onactivate, filterBy = 'none', enrichSocial = true, availability = true, availableOnly = $bindable(false),
  }: {
    filterBy?: 'none' | 'type' | 'watched';
    availability?: boolean;
    availableOnly?: boolean;
    children?: Snippet<[MediaRowStyle]>;
    heading?: Snippet;
    before?:Snippet;
    enrichSocial?:boolean;
    size?: MediaCardShape | 'panel';
    mixed?: boolean;
    overlay?: MediaCardOverlay;
    artworkOptions?: boolean;
    title?: string;
    items?: T[];
    source?: ShelfConfig;
    panels?: InsightPanel[];
    journal?: JournalCards;
    href?: string;
    shape?: MediaCardShape;
    layout?: 'row' | 'grid';
    artworkStyle?: MediaCardArtwork;
    artworkPriority?: ArtworkPriority;
    mediaKind?: 'screen' | 'music' | 'game' | 'reading';
    segments?: Snippet<[Pick<ComponentProps<typeof SegmentedControl>,'material'|'presentation'>]>;
    filterGroups?: FilterGroup[];
    controls?: Snippet;
    actions?: Snippet;
    error?: string;
    retry?: () => void;
    empty?: Snippet;
    details?: Snippet<[T]>;
    captionAction?: Snippet<[T]>;
    body?: Snippet<[T]>;
    footer?: Snippet<[T]>;
    busy?: boolean;
    hideEmpty?: boolean;
    itemCount?: number;
    preserveHeight?: boolean;
    rows?: 1 | 2;
    hasMore?: boolean;
    onend?: () => void;
    resetKey?: string;
    url?: ReadonlyURL;
    pageNumber?: number;
    pages?: number;
    onpage?: (page: number) => void;
    pageUrl?: (page: number) => string;
    onsettled?: () => void;
    onactivate?: () => void;
  } = $props();
  const sectionHost=useDetailSection(),sectionId=$props.id();
  let selected = $state(false);
  let socialActive=$state(false);
  let social=$state<SocialEnrichment>({});
  let visibleSocialKeys=$state.raw(new Set<string>());
  let disposed=false;
  function observeSocialCard(node: HTMLElement, input: {key:string;enabled:boolean}) {
    let current:typeof input|undefined, stop=()=>{};
    const mark=(key:string,visible:boolean)=>{
      if(disposed||visibleSocialKeys.has(key)===visible)return;
      const keys=new Set(visibleSocialKeys);if(visible)keys.add(key);else keys.delete(key);
      visibleSocialKeys=keys;
    };
    function update(next:typeof input) {
      if(current?.key===next.key&&current.enabled===next.enabled)return;
      stop();if(current)mark(current.key,false);current=next;
      stop=next.enabled?observeVisibility(node,visible=>mark(next.key,visible)):()=>{};
    }
    update(input);
    return {update,destroy(){stop();if(current)mark(current.key,false);}};
  }

  const adapter = untrack(() => source ? createShelfSource(() => source!) : undefined);
  const displayEnrichSocial=$derived(enrichSocial&&(adapter?.enrichSocial??true));
  const activitySkeleton=$derived(source?.type==='social'&&source.surface!=='popular'||source?.type==='library-feed'&&source.feature==='requests'&&page.data.user?.role==='admin');
  $effect(() => { if(adapter && (adapter.ready || adapter.error))untrack(()=>onsettled?.()); });
  const filterMode = $derived(adapter?.filterBy ?? filterBy);
  const inputItems = $derived(adapter ? adapter.items as T[] : items);
  const displayTitle = $derived(adapter?.title ?? title);
  const displayError = $derived(adapter?.error || error);
  const displayBusy = $derived(adapter?.busy ?? busy);
  const displayLayout = $derived(source?.layout ?? layout);
  const selection = createShelfSelection(() => ({
    items: inputItems, mode: filterMode, layout: displayLayout, busy: displayBusy,
    availability, availableOnly, title: displayTitle, href: adapter?.href ?? href, url,
  }), value => { availableOnly = value; });
  const pagination = $derived(adapter?.pagination);
  const infiniteGrid=$derived(displayLayout==='grid'&&pagination?.kind==='pages'&&!!pagination.infinite);
  const manualGrid=$derived(displayLayout==='grid'&&pagination?.kind==='pages'&&pagination.automatic===false);
  const sectionCandidate=$derived(!!sectionHost?.active&&displayLayout==='grid');
  const displayResetKey = $derived(adapter?.resetKey ?? resetKey ?? (filterMode !== 'none' ? selection.resetKey : undefined));
  const sourceHasMore = $derived(pagination?.kind === 'cursor' ? pagination.hasMore : pagination?.kind === 'pages' ? (displayLayout==='row'||pagination.append||sectionCandidate) && pagination.page < pagination.pages : hasMore);
  const continuation=createShelfContinuation(()=>({
    items:selection.items,row:displayLayout==='row',
    progressive:!children&&!panels&&!journal&&!adapter?.loadPrevious&&!adapter?.appendOnly,
    scope:JSON.stringify([page.data.user?.id,displayResetKey,selection.resetKey,adapter?.filters.map(control=>control.value),adapter?.controls.map(control=>control.value)]),
    busy:displayBusy,error:displayError,hasMore:sourceHasMore,
    page:pagination?.kind==='pages'?pagination.page:1,
    load:async(number,append)=>{if(adapter)return adapter.load(number,append);onend?.();},
    retry:adapter?.retry,
  }));
  const displayItems = $derived(continuation.items);
  const count = $derived(panels?.length ?? itemCount ?? (children ? null : journal ? journal.runs.length : displayItems.length));
  const loading = $derived(count === 0 && (displayBusy || !!adapter && !adapter.ready && !adapter.error));
  const emptyRow = $derived(displayLayout === 'row' && count === 0 && !loading && !displayError);
  // Keep failed rows and user-selected empty filters reachable; never hide a grid page.
  const hidden = $derived(hideEmpty && displayLayout === 'row' && !loading && !selected && !selection.filtered && count === 0 && !displayError && !adapter?.notice && (!adapter || adapter.ready) && adapter?.emptyConfirmed !== false);
  function selectControl(control: ShelfControl, value: string) { selected = true; control.change(value); }
  const key = (item: T) => item.entryId ?? ('href' in item ? item.href : item.id);

  const socialRevision = $derived(contentRevisionKey(page.data, ['social']));
  const enrichment = createSocialEnrichment(
    (ids, signal) => api<SocialEnrichment>(`social/works?ids=${ids.join(',')}`, undefined, 'GET', { signal }),
    value => { social = value; },
  );
  $effect(() => {
    const ids = [...new Set(entries.filter(entry=>visibleSocialKeys.has(entry.key)&&!entry.item.captionActor).map(({item}) => 'workId' in item ? item.workId ?? item.id : item.id).filter(id => /^[0-9a-f-]{36}$/.test(id)))];
    const scope = JSON.stringify([socialRevision, displayResetKey, selection.resetKey, adapter?.filters.map(control => [control.label, control.value]), adapter?.controls.map(control => [control.label, control.value])]);
    const active = displayEnrichSocial && socialActive && !!page.data.user && page.data.capabilities?.social!==false;
    untrack(() => enrichment.update({ ids, scope, active }));
  });
  onDestroy(()=>{disposed=true;enrichment.cancel();});

  const entries = $derived<{ key: string; item: T | JournalCard['item']; activity?: JournalCard['activity']; note?: JournalCard['note']; run?: JournalCard['run'] }[]>(
    journal ? journalCards(journal.runs, !!journal.selection).map(entry => entry) : displayItems.map(item => ({ key: key(item), item }))
  );
  const displayHref = $derived(selection.href);
  const headerControls = $derived(shelfControls(
    adapter && filterMode === 'none' ? [...adapter.filters, ...adapter.controls]
      : filterMode !== 'none' ? [...selection.filters, ...selection.controls] : [],
    selectControl,
  ));
  const groups = $derived([...headerControls.groups, ...filterGroups.map(group => ({...group, change:(value:string)=>{selected=true;group.change(value);}}))]);
  const displayMixed = $derived(adapter?.mixed ?? mixed);
  function itemStyle(item: MediaView | MediaCardPresentation, style: MediaRowStyle): MediaRowStyle {
    return displayMixed ? mixedCardStyle(item.kind, style, {shape:rail.overrideShape,artworkStyle:rail.overrideArtwork}) : style;
  }
  const displaySize = $derived(shape ?? adapter?.shape ?? size);
  const inDetailSection=$derived(sectionCandidate&&!!sectionHost?.owns(sectionId));
  $effect(()=>{if(sectionCandidate&&!hidden)return untrack(()=>sectionHost!.attach(sectionId,()=>({title:displayTitle,segments:headerControls.segments.length||customSegments?sectionSegments:undefined,controls:sectionControls})));});
  const displayArtworkStyle = $derived(artworkStyle ?? adapter?.artworkStyle ?? 'auto');
  const displayArtworkPriority = $derived(adapter?.artworkPriority ?? artworkPriority);
  const displayMediaKind = $derived(adapter?.mediaKind ?? mediaKind);
  const displayPreserveHeight = $derived(preserveHeight ?? (!children && !panels && (displayBusy || !!displayItems.length || !!adapter && !adapter.ready)));
  const displayRows = $derived(adapter?.rows ?? rows);
  const displayHasMore = $derived(continuation.hasMore);
  const displayHasPrevious = $derived(pagination?.kind === 'pages' && (pagination.firstPage ?? 1) > 1 && !!adapter?.loadPrevious);
  const displayOnend = ()=>{void continuation.more();};
  const displayPageNumber = $derived(pagination?.kind === 'pages' ? pagination.page : pageNumber ?? 1);
  const displayPages = $derived(pagination?.kind === 'pages' ? pagination.pages : pages ?? 1);
  const displayOnpage = $derived(adapter ? (pagination?.kind === 'pages' ? adapter.load : undefined) : onpage);
  const displayPageUrl = $derived((pagination?.kind === 'pages' ? pagination.url : undefined) ?? pageUrl);
  const pagedNavigation = $derived(displayLayout === 'grid' || !adapter && !!onpage);
  const hasNavigation = $derived(!sectionCandidate&&!infiniteGrid&&(displayLayout === 'row' || !!displayOnpage || !!displayPageUrl));
  let styleMenu = $state<RowStyleMenu>();
  const layoutItems=$derived(entries.map(entry=>entry.key));
  const rail = createShelfLayout(() => ({
    size: displaySize, artworkStyle: displayArtworkStyle, artworkPriority: displayArtworkPriority,
    overlay, layout: displayLayout, busy: displayBusy, preserveHeight: displayPreserveHeight,
    hasMore: displayHasMore, onend: displayOnend, resetKey: displayResetKey,
    hasPrevious: displayHasPrevious, onstart: adapter?.loadPrevious, initialItemId: adapter?.initialItemId, items:layoutItems,
    restoration:page.state.mediaDetailShelf?.href===adapter?.location?page.state.mediaDetailShelf?.position:undefined,
    autoLoad:!manualGrid&&(sectionCandidate||infiniteGrid||pagination?.kind==='cursor'||!adapter&&!!onend),error:displayError,
  }));
  function styleGesture(node: HTMLElement) {
    if (displaySize !== 'panel') return contextGesture(node, point => styleMenu?.openAt(point));
  }

  reportFailure(()=>({text:displayError,retry:adapter ? continuation.retry : retry}));
</script>

{#if adapter?.sequence}<Dialog bind:open={sequence.open} title={sequence.title} message={sequence.message} alert={!!sequence.error} actions={sequence.actions} />{/if}
{#snippet menuActions()}
  {#if adapter?.sequence}<Button item text="Play playlist" icon="play" disabled={sequence.busy} onclick={() => sequence.start()} />{/if}
  {#each adapter?.actions ?? [] as action}<Button item text={action.label} onclick={action.run} />{/each}
  {@render actions?.()}
{/snippet}
{#snippet availabilityToggles()}
 {#each headerControls.availability as control (control.label)}<Button {...availabilityControl(control.value==='available',value=>selectControl(control,value?'available':'all'))} />{/each}
{/snippet}
{#snippet sectionSegments()}
 {#each headerControls.segments as control (control.label)}<SegmentedControl material="clear" presentation="navigation" label={control.label} value={control.value} options={control.options??[]} onchange={value=>selectControl(control,value)} />{/each}
 {@render customSegments?.({material:'clear',presentation:'navigation'})}
{/snippet}
{#snippet sectionControls()}
 {@render availabilityToggles()}
 {#if groups.length || adapter?.sequence || adapter?.actions?.length || actions}<RowFilter {groups} actions={adapter?.sequence || adapter?.actions?.length || actions ? menuActions : undefined} />{/if}
 {@render customControls?.()}
{/snippet}
<div data-shelf use:lazyContent={{load: () => {socialActive=true;onactivate?.();if(adapter&&!adapter.appendOnly&&!adapter.ready&&!adapter.activated)void adapter.load();}, enabled: () => !socialActive || !!adapter && !adapter.appendOnly && !adapter.ready && !adapter.activated}}>
  {#snippet cards(style: MediaRowStyle)}
    {#if panels}{#each panels as panel}<DetailCard {...panel} />{/each}{:else}
    {#each entries as entry (entry.key)}{@const item = entry.item}{@const cardStyle = itemStyle(item, style)}{@const extra = adapter?.details?.(item)}<div class={entry.activity ? entry.run ? 'episode-run' : 'entry' : 'shelf-item'} style:--mixed-card-ratio={displayMixed ? cardAspectRatio(cardStyle.shape) : undefined} data-shelf-id={item.entryId ?? item.id} data-shelf-key={entry.key} data-shelf-visible={visibleSocialKeys.has(entry.key) ? '' : undefined} use:observeSocialCard={{key:entry.key,enabled:displayEnrichSocial&&!!page.data.user&&page.data.capabilities?.social!==false}}>
      {#snippet cardAction()}{@render captionAction?.(item as T)}{/snippet}
      {#snippet cardBody()}{@render body?.(item as T)}{/snippet}
      {#snippet cardFooter()}{@render footer?.(item as T)}{/snippet}
      <MediaCard {item} {...cardStyle} retain={()=>adapter?.retain?.(entry.key)??(()=>{})} wrapActivity={displayLayout === 'grid'} social={social['workId' in item?item.workId??item.id:item.id]}
        shape={displayMixed ? cardStyle.shape : !journal && rail.overrideShape === null && shape === undefined && adapter?.shape === undefined && ['album', 'track', 'game'].includes(item.kind) ? 'square' : style.shape}
        captionAction={captionAction ? cardAction : undefined} body={body ? cardBody : undefined} footer={footer ? cardFooter : undefined} />
      {#if entry.run}<details class="journal-run">
        <summary>Show {entry.run.length} episodes</summary>
        <div class="episode-list">{#each entry.run as episode}<a href={episode.href}><span>{episode.title}</span><small>{episode.note.time} · {episode.note.source}{episode.note.repeat ? ' · Rewatch' : ''}</small></a>{/each}</div>
      </details>
      {:else if entry.activity && entry.note}
        {#if journal?.selection}<label class="check"><input type="checkbox" checked={journal.selection.checked(entry.activity.eventId)} disabled={journal.selection.disabled} onchange={() => journal?.selection?.toggle(entry.activity!.eventId)} />Select {item.captionSubtitle || item.title}</label>{/if}
        <p class="entry-note">
          {#if entry.note.action}{entry.note.action} · {/if}
          {#if entry.note.pending}Pending review · {/if}
          {#if entry.note.date}<time datetime={entry.note.date}>{entry.note.time}</time>{:else}{entry.note.time}{/if} · {entry.note.source}{#if entry.note.repeat}<span class="rewatch">{entry.note.repeat}</span>{/if}
        </p>
      {/if}
      {#if extra?.summary}<details class="credit-roles"><summary>{extra.summary}</summary><p>{extra.body}</p></details>{/if}
      {#if extra?.actions}<div class="order">{#each extra.actions as action}<Button emphasis="subtle" icon={action.icon} label={action.label} disabled={action.disabled} onclick={action.run} />{/each}</div>{/if}
      {#if !entry.activity}{@render details?.(item as T)}{/if}
    </div>{/each}
    {#if !loading && adapter && !displayItems.length && !adapter.error}<div class="row-empty" aria-live="polite"><p class="quiet" role="status">{adapter.empty}
      {#if adapter.emptyHref}<a href={adapter.emptyHref}>{adapter.emptyLink}</a>{/if}
    </p></div>
    {:else if !loading && !adapter && !displayItems.length && (empty || filterMode !== 'none') && (filterMode === 'none' || !busy)}<div class="row-empty" aria-live="polite">
      {#if filterMode !== 'none' && selection.filtered}<p class="muted">No titles in this selection.</p>
      {:else}{@render empty?.()}{/if}
    </div>{/if}
    {/if}
  {/snippet}
{#if adapter?.groups}
<div class="journal">
  {#each adapter.groups as group}<Shelf title={group.title} href={group.href} controls={group.controls} items={group.items} size="fanart" layout={displayLayout} preserveHeight={!!group.preserveHeight} journal={group.runs ? { runs: group.runs, selection: group.selection } : undefined}>
    {#snippet heading()}{#if group.heading}<h3>{group.heading}</h3><span class="small muted">{group.count} {group.count===1?'entry':'entries'}</span>{:else}<Heading variant="title" title={group.title} href={group.href} />{/if}{/snippet}
  </Shelf>{/each}
</div>
{:else if children || adapter || filterMode === 'none' || selection.sourceItems.length || customSegments || customControls || filterGroups.length || empty}
<section hidden={hidden} class="content-row section" class:detail-section={inDetailSection} aria-label={displayTitle} aria-busy={displayBusy}>
  {#if !inDetailSection}<div use:styleGesture>
    <Heading title={displayTitle} {heading} href={displayHref}>
      {#snippet segments()}
        {#each headerControls.segments as control (control.label)}<SegmentedControl label={control.label} value={control.value} options={control.options ?? []} onchange={value => selectControl(control, value)} />{/each}
        {@render customSegments?.({})}
        {@render availabilityToggles()}
      {/snippet}
      {#snippet previous()}{#if hasNavigation}<Button size="icon"
        label={pagedNavigation ? `Previous ${displayTitle} page` : `Scroll ${displayTitle} left`}
        disabled={pagedNavigation ? displayBusy || displayPageNumber <= 1 : emptyRow || !rail.previous && !displayHasPrevious}
        href={pagedNavigation ? displayPageUrl?.(displayPageNumber - 1) : undefined}
        onclick={pagedNavigation ? displayPageUrl ? undefined : () => displayOnpage?.(displayPageNumber - 1) : () => rail.scroll(-1)}
        icon="left" iconSize={20} />{/if}{/snippet}
      {#snippet controls()}
        {#if groups.length || adapter?.sequence || adapter?.actions?.length || actions}<RowFilter {groups} actions={adapter?.sequence || adapter?.actions?.length || actions ? menuActions : undefined} />{/if}
        {@render customControls?.()}
      {/snippet}
      {#snippet next()}{#if hasNavigation}<Button size="icon"
        label={pagedNavigation ? `Next ${displayTitle} page` : `Scroll ${displayTitle} right`}
        disabled={pagedNavigation ? displayBusy || displayPageNumber >= displayPages : emptyRow || !rail.next && !displayHasMore}
        href={pagedNavigation ? displayPageUrl?.(displayPageNumber + 1) : undefined}
        onclick={pagedNavigation ? displayPageUrl ? undefined : () => displayOnpage?.(displayPageNumber + 1) : () => rail.scroll(1)}
        icon="right" iconSize={20} />{/if}{/snippet}
    </Heading>
  </div>{/if}
  {#if displaySize !== 'panel'}<RowStyleMenu
      bind:this={styleMenu}
      title={displayTitle}

      {artworkOptions}
      mediaKind={displayMediaKind}
      bind:overridePriority={rail.overridePriority}
      bind:overrideShape={rail.overrideShape}
      bind:overrideArtwork={rail.overrideArtwork}
      bind:overrideOverlay={rail.overrideOverlay}
    />{/if}

  {#if adapter?.notice}<p class="small muted">{adapter.notice}</p>{/if}
  {@render before?.()}
  {#if displayLayout==='grid' && displayHasPrevious}<div class="load-more"><Button emphasis="subtle" disabled={displayBusy} onclick={()=>rail.loadPrevious()}>Load previous titles</Button></div>{/if}
  <div class="rail-shell" class:mixed-shell={displayMixed}>
  <div
    class="rail"
    data-shelf-location={adapter?.location}
    class:mixed={displayMixed}
    class:empty-row={emptyRow}
    class:two-rows={displayRows === 2 && displayLayout === 'row'}
    class:grid-layout={displayLayout === 'grid'}
    class:anchored={displayLayout === 'row' && !!adapter?.initialItemId}
    style:--shelf-card-count={entries.length}
    class:preserve={displayPreserveHeight}
    class:square={rail.size === 'square'||rail.size==='circle'}
    style:min-height={displayLayout === 'row' && displayPreserveHeight && rail.size === 'panel' && rail.savedHeight
      ? `${rail.savedHeight}px`
      : undefined}
    class:fanart={rail.size === 'fanart'}
    class:banner={rail.size === 'banner'}
    class:panel-row={rail.size === 'panel'}
    bind:this={rail.scroller}
    onscroll={() => { if(!emptyRow&&displayLayout==='row')rail.reachedEnd(); }}
    onwheel={rail.wheel}
  >
    {#if loading || emptyRow}
    {#if loading}<span class="sr-only" role="status">Loading {displayTitle || 'titles'}…</span>{/if}
    {#each Array.from({length:displayLayout === 'grid' ? 60 : 12},(_,i)=>i) as placeholder (placeholder)}<div class="shelf-skeleton" style:--mixed-card-ratio={displayMixed ? [16/9, 2/3, 1, 2/3][placeholder % 4] : undefined} aria-hidden="true">{#if activitySkeleton}<div class="activity-placeholder"><div class="skeleton avatar-placeholder"></div><div class="skeleton name-placeholder"></div><div class="skeleton time-placeholder"></div></div>{/if}<div class="skeleton artwork-placeholder" class:round={rail.size === 'circle'}></div><div class="placeholder-caption"><div class="placeholder-copy"><div class="placeholder-line"><div class="skeleton text-placeholder" style:width={`${65 + placeholder % 3 * 10}%`}></div></div><div class="placeholder-line short"><div class="skeleton text-placeholder" style:width={`${35 + placeholder % 4 * 8}%`}></div></div></div>{#if activitySkeleton}<div class="skeleton reaction-placeholder"></div>{/if}</div></div>{/each}
  {:else if children}{@render children(rail.style)}{:else}{@render cards(rail.style)}{/if}
  </div>
  {#if emptyRow}<div class="empty-label" role="status"><span class="glass empty-badge" use:liquidGlass={{variant:'glassDark',renderer:'css'}}>{selected || selection.filtered ? 'No matches' : 'Nothing here yet'}</span></div>{/if}
  </div>
</section>

{/if}
{#if !adapter?.appendOnly && displayLayout === 'grid' && displayHasMore && (infiniteGrid||pagination?.kind === 'cursor'||sectionCandidate||!adapter&&!!onend)}
<div class="load-more" use:lazyContent={{load:()=>{if(!displayBusy)void displayOnend?.();},enabled:()=>!manualGrid&&!displayBusy&&!displayError,repeat:true}} aria-busy={displayBusy}>
 <Button emphasis="subtle" disabled={displayBusy} onclick={()=>displayError?continuation.retry():displayOnend?.()}>{displayBusy?'Loading…':displayError?'Retry':'Load more'}</Button>
</div>
{/if}
{#if adapter?.appendOnly}<div class="load-more" use:lazyContent={{load:()=>adapter.load(),enabled:()=>!adapter.error,repeat:true}} aria-busy={adapter.busy} aria-live="polite">

  {#if displayHasMore && !adapter.busy}<Button emphasis="subtle" onclick={()=>adapter.load()}>{adapter.error?'Retry':adapter.loadMoreLabel}</Button>
  {:else if !displayHasMore && !adapter.items.length}<p class="muted">{adapter.empty}</p>{/if}
</div>{/if}
{#if !sectionCandidate && (pagination?.kind === 'pages' && ['footer','both'].includes(pagination.controls) || pageUrl) && displayLayout === 'grid'}<Pagination page={displayPageNumber} pages={displayPages}
  busy={displayBusy} onchange={(pagination?.kind === 'pages' ? pagination.url : undefined) || pageUrl ? undefined : adapter?.load} pageUrl={(pagination?.kind === 'pages' ? pagination.url : undefined) ?? pageUrl} label={`${displayTitle} pages`} />{/if}
</div>
<style>
  .detail-section {margin-top:0;}
  .activity-placeholder{display:flex;align-items:center;gap:8px;margin-bottom:8px;height:24px;}
  .avatar-placeholder{width:20px;height:20px;border-radius:50%;flex-shrink:0;}
  .name-placeholder{height:12px;width:40%;border-radius:4px;}
  .time-placeholder{height:12px;width:20%;border-radius:4px;margin-left:auto;}
  .placeholder-caption{display:flex;align-items:center;gap:8px;margin-top:8px;}
  .placeholder-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}
  .placeholder-line{display:flex;align-items:center;height:calc(var(--text-md) * var(--leading-relaxed));}
  .placeholder-line.short{height:calc(var(--text-sm) * var(--leading-relaxed));}
  .reaction-placeholder{width:28px;height:28px;border-radius:50%;}
  .content-row[hidden] { display:none; }
  .rail-shell {position:relative;}
  .mixed-shell {container-type:inline-size;}
  .rail.empty-row {overflow:hidden;scroll-snap-type:none;pointer-events:none;}
  .empty-row :global(.skeleton) {animation:none;opacity:.5;}
  .empty-label {position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;}
  .empty-badge {padding:8px 16px;border-radius:999px;color:var(--ink);font-size:var(--text-md);font-weight:var(--weight-semibold);}
  .artwork-placeholder { aspect-ratio:calc(1 / var(--row-art-ratio));border-radius:8px; }
  .artwork-placeholder.round { border-radius:50%; }
  .panel-row .artwork-placeholder { aspect-ratio:auto;height:260px; }
  .text-placeholder { height:var(--text-sm);width:80%;border-radius:4px; }
  .journal { min-width:0; }
  .journal :global(.content-row:first-child) { margin-top:0; }
  .load-more { display:grid; justify-items:center; gap:10px; padding-block:18px; }

  .content-row {
    min-width: 0;
  }
  .rail {
    --landscape-card-width: clamp(255px, 27vw, 380px);
    --row-card-width: clamp(155px, 14vw, 210px);
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: min(100%, var(--row-card-width));
    align-items: start;
    gap: 20px;
    overflow: auto;
    padding: 24px var(--gutter);
    margin: -24px calc(-1 * var(--gutter));
    scroll-padding-inline: var(--gutter);
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    scroll-snap-type: x proximity;
  }
  .rail :global(> *) {
    min-width: 0;
    scroll-snap-align: start;
  }
  .rail.anchored {grid-template-columns:repeat(var(--shelf-card-count),min(100%,var(--row-card-width))) max(0px,calc(var(--shelf-viewport-width) - min(100%,var(--row-card-width)) - 2 * var(--gutter) - var(--row-gap)));}
  .rail.anchored::after {content:'';height:1px;scroll-snap-align:none;pointer-events:none;}
  .rail {
    --row-art-ratio: 1.5;
    --row-gap: 20px;
  }
  .square {
    --row-card-width: calc(var(--landscape-card-width) * 9 / 16);
    --row-art-ratio: 1;
  }
  .fanart {
    --row-art-ratio: 0.5625;
  }
  .banner {
    --row-art-ratio: 0.185;
  }
  .preserve {
    min-height: calc(var(--row-card-width) * var(--row-art-ratio) + 108px);
  }
  .two-rows.preserve {
    min-height: calc((var(--row-card-width) * var(--row-art-ratio) + 108px) * 2 + var(--row-gap));
  }
  .preserve.panel-row {
    min-height: 380px;
  }
  .fanart {
    --row-card-width: var(--landscape-card-width);
  }
  .banner {
    --row-card-width: clamp(310px, 34vw, 480px);
  }
  .panel-row {
    --row-card-width: 360px;
    grid-auto-columns: min(calc(100% - 24px), 440px);
    align-items: stretch;
  }
  .two-rows {
    grid-template-rows: repeat(2, auto);
  }
  .grid-layout {
    grid-auto-flow: row;
    grid-auto-columns: auto;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--row-card-width)), 1fr));
    overflow: visible;
    scroll-snap-type: none;
  }
  .grid-layout :global(.row-empty) {
    grid-column: 1 / -1;
  }
  @media (max-width: 500px) {
    .rail {
      gap: 14px;
      --row-gap: 14px;
    }
    .rail:not(.square):not(.fanart):not(.banner):not(.panel-row) {
      --row-card-width: 145px;
    }
  }

  .rail.mixed {
    --mixed-art-height: min(clamp(180px, 20vw, 260px), calc(100cqw * 9 / 16));
    --row-card-width: calc(var(--mixed-art-height) * 2 / 3);
    display:flex;
  }
  .rail.mixed :global(> *) {flex:0 0 calc(var(--mixed-art-height) * var(--mixed-card-ratio, 0.6666667));width:calc(var(--mixed-art-height) * var(--mixed-card-ratio, 0.6666667));}
  .rail.mixed .artwork-placeholder {height:var(--mixed-art-height);aspect-ratio:auto;}
  .rail.mixed.preserve {min-height:calc(var(--mixed-art-height) + 108px);}
  .rail.mixed.grid-layout {flex-wrap:wrap;}

  .credit-roles { margin-top:6px; font-size:var(--text-sm); color:var(--muted); }
  .credit-roles summary { cursor:pointer; font-weight:var(--weight-semibold); }
  .credit-roles p { margin-top:8px; line-height:var(--leading-relaxed); overflow-wrap:anywhere; }
  .order { display:flex; align-items:center; gap:4px; margin-top:8px; }

  .episode-run {
    min-width: 0;
  }
  .journal-run {
    margin-top: 10px;
    font-size: var(--text-sm);
    color: var(--muted);
  }
  .journal-run summary {
    cursor: pointer;
    padding-block: 4px;
  }
  .episode-list {
    display: grid;
    gap: 12px;
    margin-top: 14px;
  }
  .episode-list a {
    display: grid;
    gap: 4px;
  }
  .episode-list small {
    font-size: var(--text-sm);
    color: var(--quiet);
  }
  .rewatch {
    margin-left: 8px;
    color: var(--muted);
  }
  .entry {
    min-width: 0;
  }
  .entry-note {
    font-size: var(--text-sm);
    color: var(--quiet);
    margin-top: 6px;
  }

</style>
