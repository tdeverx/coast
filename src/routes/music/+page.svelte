<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import { browseHeading } from '$lib/ui/headings';
  import SegmentedControl from '$lib/ui/components/SegmentedControl.svelte';
  import { librarySelections } from '$lib/library';
  import RowFilter from '$lib/ui/components/RowFilter.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  let { data } = $props();
  function pageUrl(page: number, kind = data.filters.kind, scope = data.filters.scope) {
    return `/music?${new URLSearchParams({
      connection: data.connectionId,
      kind,
      scope,
      search: data.filters.search,
      page: String(page),
    })}`;
  }
</script>

<svelte:head><title>Music · Coast</title></svelte:head>
<div class="content page route-content">

  <Shelf title="Music" layout="grid" items={data.items} shape="square" mediaKind="music" enrichSocial={false} artworkOptions={false} hideEmpty={false} error={data.failure} retry={()=>invalidateAll()} pageNumber={data.page} pages={data.pages} {pageUrl}>
    {#snippet heading()}<Heading title="Library" level={1} variant="title" />{/snippet}
    {#snippet segments()}{@const browse=browseHeading('listen',{...data,features:data.capabilities})}{#if browse.selection}<SegmentedControl label={browse.selection.label} value={browse.selection.value} options={browse.selection.options} onchange={browse.selection.change} />{/if}<SegmentedControl label="Listen type" value={data.filters.kind} options={librarySelections.listen} onchange={kind => goto(pageUrl(1,kind as typeof data.filters.kind),{keepFocus:true,noScroll:true})} />{/snippet}
    {#snippet controls()}<RowFilter groups={[{label:'Availability',value:data.filters.scope,options:[{value:'all',label:'All titles'},{value:'available',label:'Available only'}],change:value=>{void goto(pageUrl(1,data.filters.kind,value as typeof data.filters.scope),{keepFocus:true,noScroll:true});}}]}/>{/snippet}
    {#snippet before()}
  <form class="filter-row browse-search" action="/music" method="GET">
    <input type="hidden" name="kind" value={data.filters.kind} />
    <input type="hidden" name="scope" value={data.filters.scope} />
    <input type="hidden" name="connection" value={data.connectionId} />
    <input
      aria-label="Search music"
      name="search"
      type="search"
      placeholder="Search music"
      value={data.filters.search}
      maxlength="200"
    />
    <Button type="submit"  icon="search">Search</Button>
  </form>
    {#if data.items.length}<p class="small result-count">{data.total.toLocaleString()} music items</p>{/if}
    {/snippet}
    {#snippet empty()}
  {#if !data.sources.length}
    <EmptyState
      title="Connect your music library"
      description="Link a Jellyfin account to browse its music."
      icon="library"
    >
      <Button  href="/settings/connections">Connect a media server</Button>
    </EmptyState>
  {:else if !data.items.length && !data.failure}
    <EmptyState
      title="No matching music"
      description="Try another music type or search."
      icon="library"
    >
      <Button  href={`/music?connection=${data.connectionId}`}
        >Reset filters</Button
      >
    </EmptyState>
  {/if}
    {/snippet}
  </Shelf>
</div>

<style>
  .result-count {margin:16px 0 22px;}
  .browse-search input[type='search'] {
    flex: 1;
    min-width: min(100%, 200px);
    width: auto;
  }
</style>
