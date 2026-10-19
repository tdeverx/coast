<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { refreshRouteDependencies } from '$lib/ui/client';
  import Heading from '$lib/ui/components/Heading.svelte';
  import { browseHeading } from '$lib/ui/headings';
  import SegmentedControl from '$lib/ui/components/SegmentedControl.svelte';
  import { librarySelections } from '$lib/library';
  import RowFilter from '$lib/ui/components/RowFilter.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  let { data } = $props();
  function pageUrl(
    page: number,
    view = data.filters.view,
    state = data.filters.state,
    personal = data.filters.personal,
    scope = data.filters.scope
  ) {
    return `/games?${new URLSearchParams({ view, state, scope, personal: String(personal), instance: data.instanceId, search: data.filters.search, page: String(page) })}`;
  }
</script>

<svelte:head><title>Games · Coast</title></svelte:head>
<div class="content page route-content">

  <Shelf title="Games" layout="grid" items={data.items} shape="poster" mediaKind="game" enrichSocial={false} artworkOptions={false} hideEmpty={false} error={data.failure} retry={()=>refreshRouteDependencies('all')} pageNumber={data.page} pages={data.pages} {pageUrl}>
    {#snippet heading()}<Heading title="Library" level={1} variant="title" />{/snippet}
    {#snippet segments()}{@const browse=browseHeading('play',{...data,features:data.capabilities})}{#if browse.selection}<SegmentedControl label={browse.selection.label} value={browse.selection.value} options={browse.selection.options} onchange={browse.selection.change} />{/if}{#if data.filters.view==='library'}<SegmentedControl label="Play state" value={data.filters.state} options={librarySelections.play} onchange={state=>goto(pageUrl(1,data.filters.view,state as typeof data.filters.state),{keepFocus:true,noScroll:true})}/>{/if}{/snippet}
    {#snippet controls()}<RowFilter groups={[
      {label:'Games view',value:data.filters.view==='library'&&data.filters.personal?'personal':data.filters.view,options:[{value:'library',label:'All games'},{value:'personal',label:'Your games'},{value:'igdb',label:'Discover'}],change:view=>{void goto(pageUrl(1,view==='igdb'?'igdb':'library',data.filters.state,view==='personal'),{keepFocus:true,noScroll:true});}},
      ...(data.filters.view==='library'?[{label:'Availability',value:data.filters.scope,options:[{value:'all',label:'All titles'},{value:'available',label:'Available only'}],change:(value:string)=>{void goto(pageUrl(1,data.filters.view,data.filters.state,data.filters.personal,value as typeof data.filters.scope),{keepFocus:true,noScroll:true});}}]:[]),
    ]}>{#snippet actions()}{#if page.data.user?.role==='admin'}<Button item href="/settings/integrations" icon="server">Integrations</Button>{/if}{/snippet}</RowFilter>{/snippet}
    {#snippet before()}
  <form class="filter-row browse-search" action="/games" method="GET">
    <input type="hidden" name="view" value={data.filters.view} />
    <input type="hidden" name="personal" value={String(data.filters.personal)} />
    <input type="hidden" name="scope" value={data.filters.scope} />
    <input type="hidden" name="state" value={data.filters.state} />
    <input type="hidden" name="instance" value={data.instanceId} />
    <input
      aria-label="Search games"
      name="search"
      type="search"
      placeholder="Search games"
      value={data.filters.search}
      maxlength="250"
    />
    <Button type="submit"  icon="search">Search</Button>
  </form>
    {#if data.items.length}<p class="small result-count">{data.total.toLocaleString()} games</p>{/if}
    {/snippet}
    {#snippet empty()}
  {#if !data.items.length && !data.failure && data.filters.view === 'library' && data.filters.scope === 'available'}
    <EmptyState title="No owned games in this selection" description="Steam ownership provides availability; installation is unknown. Turn off Available to browse all games." icon="library" />
  {:else if data.filters.view === 'igdb' && !data.sources.length}
    <EmptyState
      title="Connect IGDB"
      description="An administrator can add IGDB in Integrations to enable game discovery."
      icon="library"
    >
      {#if page.data.user?.role === 'admin'}<Button

          href="/settings/integrations">Configure IGDB</Button
        >{/if}
    </EmptyState>
  {:else if data.filters.view === 'igdb' && !data.filters.search}
    <EmptyState
      title="Find your next game"
      description="Search IGDB to find games and add them to your library."
      icon="search"
    />
  {:else}
    <EmptyState
      title={data.filters.search || data.filters.state !== 'all'
        ? 'No matching games'
        : data.filters.personal
          ? 'No playthroughs yet'
          : 'No games yet'}
      description="Discover games with IGDB and add them to start tracking."
      icon="library"
    >
      <Button  href="/games?view=igdb">Discover games</Button>
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
