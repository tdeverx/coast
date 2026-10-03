<script lang="ts" generics="T extends MediaView | MediaCardPresentation">
 import { availabilityControl, collectionControl } from '$lib/ui/controls/actions';
  import { untrack, type Snippet } from 'svelte';
  import { createShelfSource, type ShelfConfig } from '$lib/ui/shelves';
  import type { ShelfControl } from '$lib/ui/shelves/types';
  import { createShelfSelection } from '$lib/ui/shelves/local.svelte';
  import { createShelfLayout } from '$lib/ui/shelves/layout.svelte';
  import { lazyContent } from '$lib/ui/lazy-content';
  import RowFeedback from './RowFeedback.svelte';
  import Pagination from './Pagination.svelte';
  import { createSequencePlayback } from '$lib/ui/controls/sequence.svelte';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  import { page } from '$app/state';
  import { useClient } from '$lib/ui/client-context';

  import { mediaTypeOptions } from '$lib/ui/filter-options';
  import RowFilter from './RowFilter.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import type { ArtworkPriority, MediaView, MediaCardPresentation, MediaCardShape, MediaCardArtwork } from '$lib/ui/types';
  import RowStyleMenu from './RowStyleMenu.svelte';
  import Heading from './Heading.svelte';
  import { contextGesture } from '$lib/ui/context-gesture';
  import type { MediaRowStyle, MediaCardOverlay } from '$lib/ui/types';
  import Shelf from './Shelf.svelte';
  import { journalCards, type JournalCards, type JournalCard } from '$lib/ui/shelves/journal-cards';
  import DetailCard from './DetailCard.svelte';
  import type { InsightPanel } from '$lib/ui/insights/types';
  import MediaCard from './MediaCard.svelte';

  const { api, change, preview } = useClient();
  const sequence = createSequencePlayback({source: () => adapter?.sequence, experimental: () => !!page.data.experimentalFeatures, preview, api, change});

  let {
    title = '', items = [], source, panels, journal, href, children, heading, size = 'poster', overlay = 'none', artworkOptions = true, shape, layout = 'row', artworkStyle = 'auto', artworkPriority,
    mediaKind = 'screen', filters, controls, actions, empty, details,
    busy = false, hideEmpty = true, itemCount, preserveHeight, rows = 1, hasMore = false, onend, resetKey,
    pageNumber, pages, onpage, pageUrl, filterBy = 'none', availability = true, availableOnly = $bindable(false),
  }: {
    filterBy?: 'none' | 'type' | 'watched';
    availability?: boolean;
    availableOnly?: boolean;
    children?: Snippet<[MediaRowStyle]>;
    heading?: Snippet;
    size?: MediaCardShape | 'panel';
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
    mediaKind?: 'screen' | 'music' | 'game';
    filters?: Snippet;
    controls?: Snippet;
    actions?: Snippet;
    empty?: Snippet;
    details?: Snippet<[T]>;
    busy?: boolean;
    hideEmpty?: boolean;
    itemCount?: number;
    preserveHeight?: boolean;
    rows?: 1 | 2;
    hasMore?: boolean;
    onend?: () => void;
    resetKey?: string;
    pageNumber?: number;
    pages?: number;
    onpage?: (page: number) => void;
    pageUrl?: (page: number) => string;
  } = $props();
  let selected = $state(false);
  let socialActive=$state(false);
  let social=$state<Record<string,{friends:{username:string;avatar?:string|null;status?:import('$lib/social/status').ActivityStatus}[];total:number}>>({});
  const adapter = untrack(() => source ? createShelfSource(() => source!) : undefined);
  const filterMode = $derived(adapter?.filterBy ?? filterBy);
  const inputItems = $derived(adapter ? adapter.items as T[] : items);
  const displayTitle = $derived(adapter?.title ?? title);
  const displayBusy = $derived(adapter?.busy ?? busy);
  const displayLayout = $derived(source?.layout ?? layout);
  const selection = createShelfSelection(() => ({
    items: inputItems, mode: filterMode, layout: displayLayout, busy: displayBusy,
    availability, availableOnly, title: displayTitle, href: adapter?.href ?? href, url: page.url,
  }), value => { availableOnly = value; });
  const displayItems = $derived(selection.items);
  const count = $derived(panels?.length ?? itemCount ?? (children ? null : journal ? journal.runs.length : displayItems.length));
  const loading = $derived(count === 0 && (displayBusy || !!adapter && !adapter.ready && !adapter.error));
  // Keep failed rows and user-selected empty filters reachable; never hide a grid page.
  const hidden = $derived(hideEmpty && displayLayout === 'row' && !loading && !selected && !selection.filtered && count === 0 && !adapter?.error && !adapter?.notice && (!adapter || adapter.ready) && adapter?.emptyConfirmed !== false);
  function selectControl(control: ShelfControl, value: string) { selected = true; control.change(value); }
  const key = (item: T) => item.entryId ?? ('href' in item ? item.href : item.id);

  $effect(()=>{
    const ids=[...new Set(displayItems.filter(item=>!item.captionActor).map(item=>'workId' in item?item.workId??item.id:item.id).filter(id=>/^[0-9a-f-]{36}$/.test(id)))];
    social={};if(!socialActive||!page.data.user||!ids.length)return;
    const controller=new AbortController();
    void (async()=>{
      const batches=[];
      for(let offset=0;offset<ids.length;offset+=60)batches.push(ids.slice(offset,offset+60));
      const results=await Promise.all(batches.map(batch=>api<typeof social>(`social/works?ids=${batch.join(',')}`,undefined,'GET',{signal:controller.signal})));
      if(!controller.signal.aborted)social=Object.assign({},...results);
    })().catch(()=>{});
    return ()=>controller.abort();
  });

  const entries = $derived<{ key: string; item: T | JournalCard['item']; activity?: JournalCard['activity']; note?: JournalCard['note']; run?: JournalCard['run'] }[]>(
    journal ? journalCards(journal.runs, !!journal.selection).map(entry => entry) : displayItems.map(item => ({ key: key(item), item }))
  );
  const displayHref = $derived(selection.href);
  const displayFilters = $derived(adapter && filterMode === 'none' ? (adapter.filters.length ? adapterFilters : undefined) : filterMode === 'none' ? filters : filters || filterMode === 'watched' || availability ? localFilters : undefined);
  const displayControls = $derived(adapter && filterMode === 'none' ? (adapter.controls.length || adapter.filters.some(control => !['segments', 'availability'].includes(control.type)) ? adapterControls : undefined) : filterMode === 'none' ? controls : localControls);
  const displayActions = $derived(adapter ? adapterActions : actions);
  const displaySize = $derived(adapter?.shape ?? shape ?? size);
  const displayArtworkStyle = $derived(adapter?.artworkStyle ?? artworkStyle);
  const displayArtworkPriority = $derived(adapter?.artworkPriority ?? artworkPriority);
  const displayMediaKind = $derived(adapter?.mediaKind ?? mediaKind);
  const displayPreserveHeight = $derived(preserveHeight ?? (!children && !panels && (displayBusy || !!displayItems.length || !!adapter && !adapter.ready)));
  const displayRows = $derived(adapter?.rows ?? rows);
  const pagination = $derived(adapter?.pagination);
  const displayHasMore = $derived(pagination?.kind === 'cursor' ? pagination.hasMore : pagination?.kind === 'pages' ? pagination.append && pagination.page < pagination.pages : hasMore);
  const displayOnend = $derived(adapter ? () => {if(!adapter.busy) void adapter.load((pagination?.kind === 'pages' ? pagination.page : 1)+1,true);} : onend);
  const displayResetKey = $derived(adapter?.resetKey ?? resetKey ?? (filterMode !== 'none' ? selection.resetKey : undefined));
  const displayPageNumber = $derived(pagination?.kind === 'pages' ? pagination.page : pageNumber ?? 1);
  const displayPages = $derived(pagination?.kind === 'pages' ? pagination.pages : pages ?? 1);
  const displayOnpage = $derived(adapter ? (pagination?.kind === 'pages' && ['header','both'].includes(pagination.controls) ? adapter.load : undefined) : onpage);
  let styleMenu = $state<RowStyleMenu>();
  const rail = createShelfLayout(() => ({
    size: displaySize, artworkStyle: displayArtworkStyle, artworkPriority: displayArtworkPriority,
    overlay, layout: displayLayout, busy: displayBusy, preserveHeight: displayPreserveHeight,
    hasMore: displayHasMore, onend: displayOnend, resetKey: displayResetKey,
  }));
  function styleGesture(node: HTMLElement) {
    if (displaySize !== 'panel') return contextGesture(node, point => styleMenu?.openAt(point));
  }
</script>

{#snippet localFilters()}
  {@render filters?.()}
  {@render renderControls(selection.filters, [], false)}
{/snippet}
{#snippet localControls()}{@render renderControls(selection.controls, selection.filters)}{/snippet}
{#snippet renderControls(options: ShelfControl[], extra: ShelfControl[] = [], showGroups = true)}
  {#each options as control (control.label)}
    {#if control.type === 'segments'}<SegmentedControl label={control.label} value={control.value} options={control.options ?? []} onchange={value => selectControl(control, value)} />
    {:else if control.type === 'collection'}<Button {...collectionControl(control.value === 'collection', value => selectControl(control, value ? 'collection' : 'all'))} />
    {:else if control.type === 'availability'}<Button {...availabilityControl(control.value === 'available', value => selectControl(control, value ? 'available' : 'all'))} />
    {/if}
  {/each}
  {@const groups = [...options, ...extra].filter(control => control.type !== 'segments' && control.type !== 'availability' && control.type !== 'collection').map(control => ({label: control.label, value: control.value, options: control.type === 'media-type' ? mediaTypeOptions(control.includeOtherMedia) : control.options ?? [], change: (value: string) => selectControl(control, value)}))}
  {#if showGroups && groups.length}<RowFilter {groups} />{/if}
{/snippet}
{#snippet adapterFilters()}{@render renderControls(adapter?.filters ?? [], [], false)}{/snippet}
{#snippet adapterControls()}{@render renderControls(adapter?.controls ?? [], adapter?.filters ?? [])}{/snippet}
{#if adapter?.sequence}<Dialog bind:open={sequence.open} title={sequence.title} message={sequence.message} alert={!!sequence.error} actions={sequence.actions} />{/if}
{#snippet adapterActions()}
  {#if adapter?.sequence}<Button emphasis="subtle" icon="play" disabled={sequence.busy} onclick={() => sequence.start()}>Play playlist</Button>{/if}
  <RowFeedback error={adapter?.error} retry={() => adapter?.load(pagination?.kind === 'pages' ? pagination.page : 1)} retryLabel={adapter?.retryLabel ?? 'Try again'} />
  {#if adapter?.notice}<span class="small muted">{adapter.notice}</span>{/if}
  {#each adapter?.actions ?? [] as action}<Button emphasis="subtle" onclick={action.run}>{action.label}</Button>{/each}
  {@render actions?.()}
{/snippet}
<div use:lazyContent={{load: () => {socialActive=true;if(adapter&&!adapter.appendOnly&&!adapter.ready&&!adapter.activated)void adapter.load();}, enabled: () => !socialActive || !!adapter && !adapter.appendOnly && !adapter.ready && !adapter.activated}}>
  {#snippet cards(style: MediaRowStyle)}
    {#if panels}{#each panels as panel}<DetailCard {...panel} />{/each}{:else}
    {#each entries as entry (entry.key)}{@const item = entry.item}{@const extra = adapter?.details?.(item)}<div class={entry.activity ? entry.run ? 'episode-run' : 'entry' : 'shelf-item'}>
      <MediaCard {item} {...style} wrapActivity={displayLayout === 'grid'} social={social['workId' in item?item.workId??item.id:item.id]}
        shape={!journal && rail.overrideShape === null && shape === undefined && adapter?.shape === undefined && ['album', 'track', 'game'].includes(item.kind) ? 'square' : style.shape} />
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
    {#if !loading && adapter && !displayItems.length && !adapter.error}<div class="row-empty" aria-live="polite"><RowFeedback message={adapter.empty}>
      {#if adapter.emptyHref}<a href={adapter.emptyHref}>{adapter.emptyLink}</a>{/if}
    </RowFeedback></div>
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
{:else if children || adapter || filterMode === 'none' || selection.sourceItems.length || filters || empty}
<section hidden={hidden} class="content-row section" aria-label={displayTitle} aria-busy={displayBusy}>
  <div use:styleGesture>
    <Heading title={displayTitle} {heading} filters={displayFilters} actions={displayActions} href={displayHref}>
      {#snippet navigation()}{#if displayLayout === 'row' || displayControls || displayOnpage}<div class="navigation">
            {#if displayLayout === 'row' || displayOnpage}
              <Button size="icon"
                class="icon-button"
                label={displayLayout === 'grid' ? `Previous ${displayTitle} page` : `Scroll ${displayTitle} left`}
                disabled={displayLayout === 'grid' ? displayBusy || displayPageNumber <= 1 : !rail.previous}
                onclick={() => (displayLayout === 'grid' ? displayOnpage?.(displayPageNumber - 1) : rail.scroll(-1))}
                 icon="left" iconSize={20} />{/if}
            {#if displayControls}<div class="row-controls">{@render displayControls()}</div>{/if}
            {#if displayLayout === 'row' || displayOnpage}
              <Button size="icon"
                class="icon-button"
                label={displayLayout === 'grid' ? `Next ${displayTitle} page` : `Scroll ${displayTitle} right`}
                disabled={displayLayout === 'grid' ? displayBusy || displayPageNumber >= displayPages : !rail.next && !displayHasMore}
                onclick={() => (displayLayout === 'grid' ? displayOnpage?.(displayPageNumber + 1) : rail.scroll(1))}
                 icon="right" iconSize={20} />{/if}
          </div>{/if}{/snippet}
    </Heading>
  </div>
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
  <div
    class="rail"
    class:two-rows={displayRows === 2 && displayLayout === 'row'}
    class:grid-layout={displayLayout === 'grid'}
    class:preserve={displayPreserveHeight}
    class:square={rail.size === 'square'||rail.size==='circle'}
    style:min-height={displayLayout === 'row' && displayPreserveHeight && rail.size === 'panel' && rail.savedHeight
      ? `${rail.savedHeight}px`
      : undefined}
    class:fanart={rail.size === 'fanart'}
    class:banner={rail.size === 'banner'}
    class:panel-row={rail.size === 'panel'}
    bind:this={rail.scroller}
    onscroll={rail.reachedEnd}
  >
    {#if loading}
    <span class="sr-only" role="status">Loading {displayTitle || 'titles'}…</span>
    {#each Array.from({length:displayLayout === 'grid' ? 60 : 12},(_,i)=>i) as placeholder (placeholder)}<div class="shelf-skeleton" aria-hidden="true">{#if source?.type === 'social' && source.surface !== 'popular'}<div class="activity-placeholder"><div class="skeleton avatar-placeholder"></div><div class="skeleton name-placeholder"></div><div class="skeleton time-placeholder"></div></div>{/if}<div class="skeleton artwork-placeholder" class:round={rail.size === 'circle'}></div><div class="skeleton text-placeholder"></div><div class="placeholder-caption"><div class="placeholder-copy"><div class="skeleton text-placeholder short"></div></div>{#if source?.type === 'social' && source.surface !== 'popular'}<div class="skeleton reaction-placeholder"></div>{/if}</div></div>{/each}
  {:else if children}{@render children(rail.style)}{:else}{@render cards(rail.style)}{/if}
  </div>
</section>

{/if}
{#if adapter && !adapter.appendOnly && pagination?.kind === 'cursor' && displayLayout === 'grid' && displayHasMore}
<div class="load-more" use:lazyContent={{load:()=>{if(!adapter.busy)void adapter.load(1,true);},enabled:()=>!adapter.busy&&!adapter.error,repeat:true}} aria-busy={displayBusy}>
 <Button emphasis="subtle" disabled={displayBusy} onclick={()=>adapter.load(1,true)}>{displayBusy?'Loading…':adapter.error?'Retry':'Load more'}</Button>
</div>
{/if}
{#if adapter?.appendOnly}<div class="load-more" use:lazyContent={{load:()=>adapter.load(),enabled:()=>!adapter.error,repeat:true}} aria-busy={adapter.busy} aria-live="polite">
  {#if adapter.error}<RowFeedback error={adapter.error} tag="p" />{/if}
  {#if displayHasMore && !adapter.busy}<Button emphasis="subtle" onclick={()=>adapter.load()}>{adapter.error?'Retry':adapter.loadMoreLabel}</Button>
  {:else if !displayHasMore && !adapter.items.length}<p class="muted">{adapter.empty}</p>{/if}
</div>{/if}
{#if (pagination?.kind === 'pages' && ['footer','both'].includes(pagination.controls) || pageUrl) && displayLayout === 'grid'}<Pagination page={displayPageNumber} pages={displayPages}
  busy={displayBusy} onchange={(pagination?.kind === 'pages' ? pagination.url : undefined) || pageUrl ? undefined : adapter?.load} pageUrl={(pagination?.kind === 'pages' ? pagination.url : undefined) ?? pageUrl} label={`${displayTitle} pages`} />{/if}
</div>
<style>
  .activity-placeholder{display:flex;align-items:center;gap:8px;margin-bottom:8px;height:24px;}
  .avatar-placeholder{width:20px;height:20px;border-radius:50%;flex-shrink:0;}
  .name-placeholder{height:12px;width:40%;border-radius:4px;}
  .time-placeholder{height:12px;width:20%;border-radius:4px;margin-left:auto;}
  .placeholder-caption{display:flex;align-items:center;gap:8px;}
  .placeholder-copy{flex:1;}
  .reaction-placeholder{width:28px;height:28px;border-radius:50%;}
  .content-row[hidden] { display:none; }
  .artwork-placeholder { aspect-ratio:calc(1 / var(--row-art-ratio));border-radius:8px; }
  .artwork-placeholder.round { border-radius:50%; }
  .panel-row .artwork-placeholder { aspect-ratio:auto;height:260px; }
  .text-placeholder { height:var(--text-sm);margin-top:10px;width:80%;border-radius:4px; }
  .text-placeholder.short { width:55%; }
  .journal { min-width:0; }
  .journal :global(.content-row:first-child) { margin-top:0; }
  .load-more { display:grid; justify-items:center; gap:10px; padding-block:18px; }

  .content-row {
    min-width: 0;
  }
  .rail {
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
  .rail {
    --row-art-ratio: 1.5;
    --row-gap: 20px;
  }
  .square {
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
    --row-card-width: clamp(255px, 27vw, 380px);
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
  .row-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    flex-wrap: wrap;
    justify-content: center;
  }
  .navigation {
    align-items: center;
    min-width: 0;
    display: flex;
    gap: 2px;
  }
  .navigation :global(.icon-button) {
    width: var(--control-compact-height);
    height: var(--control-compact-height);
    color: var(--muted);
  }
  .navigation :global(.icon-button:disabled) {
    opacity: 0.25;
  }
  @media (max-width: 500px) {
    .rail {
      gap: 14px;
      --row-gap: 14px;
    }
    .rail:not(.fanart):not(.banner):not(.panel-row) {
      --row-card-width: 145px;
    }
  }

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
