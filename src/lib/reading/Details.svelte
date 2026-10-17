<script lang="ts">
  import ReadingLaunch from './ReadingLaunch.svelte';
  import { goto } from '$app/navigation';
  import { replaceState, afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import ChartView from '$lib/ui/charts/ChartView.svelte';
  import { targetModel } from '$lib/ui/charts/insights';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import WorkMenu from '$lib/ui/components/WorkMenu.svelte';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import {lazyContent} from '$lib/ui/lazy-content';
  import {createResource} from '$lib/ui/resource.svelte';
  import { useClient } from '$lib/ui/client-context';
  import { createOperation } from '$lib/ui/operation.svelte';
  import { displayLabel } from '$lib/ui/labels';
  import { readingHero, readingCard, readingFacts, readingLabel, readingProviderLabel, type ReadingDetailData } from './presentation';
  import { type ReadingState } from './model';

  let { data }: { data: ReadingDetailData } = $props();
  const title = $derived(readingLabel(data.kind));
  const section=$derived(page.url.searchParams.get('section'));
  const rowHref=(name:string)=>`/media/${data.item.id}?section=${name}`;
  const library = $derived(`/library?view=read&kind=${data.kind}&scope=all`);
  const overview = $derived(overviewPanels(data.item.overview, readingFacts(data.item)));
  const { change, api,preview } = useClient();
  const history=createResource<{items:{id:string;state:ReadingState;page:number;totalPages:number|null;occurredAt:string}[];page:number;pages:number;total:number}>({items:[],page:1,pages:1,total:0});
  let historyWork='';
  $effect(()=>{const id=data.item.id;untrack(()=>{if(historyWork!==id){history.cancel();history.replace({items:[],page:1,pages:1,total:0});historyWork=id;}});});
  async function loadHistory(number=1){await history.load(signal=>api(`reading/${data.item.id}/history?page=${number}`,undefined,'GET',{signal}));}
  onDestroy(history.dispose);
  const operation = createOperation();
  const busy = $derived(operation.busy);
  const failure = $derived(operation.error);
  let menu = $state<WorkMenu>();
  async function act(task: () => Promise<void>) {
    await operation.run(task);
  }
  afterNavigate(() => {
    if (data.remote || !menu || page.url.searchParams.get('action') !== 'progress') return;
    untrack(() => {
      void menu?.editReading();
      const url = new URL(page.url); url.searchParams.delete('action'); replaceState(url, page.state);
    });
  });
  async function add() {
    await act(async () => {
      const item = await change<{ id: string }>('reading/import', { kind: data.kind, externalId: data.item.externalId });
      if(!preview)await goto(`/media/${item.id}`);
    });
  }
</script>

<svelte:head><title>{data.item.title} · {title} · Coast</title></svelte:head>
<MediaPage details hero={!section} item={readingHero(data.item, data.remote)}>
  {#if section}<Button emphasis="subtle" href={`/media/${data.item.id}`} icon="left">{data.item.title}</Button>{/if}
  {#snippet heroActions()}
    <Button emphasis="subtle" href={library} icon="left">Library</Button>
    {#if data.remote}<Button size="hero" icon="plus" disabled={busy} onclick={add}>Add {data.kind}</Button>
    {:else}
      {#if page.data.capabilities?.reader!==false}<ReadingLaunch workId={data.item.id} title={data.item.title} />{/if}
      <WorkMenu bind:this={menu} item={readingCard(data.item)} readingState={data.progress} showTrigger hero menuOnly onchanged={() => { if (history.activated) void loadHistory(); }} />
    {/if}
  {/snippet}
  {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}

  {#if overview.length&&(!section||section==='insights')}<Shelf title="Insights" href={!section?rowHref('insights'):undefined} layout={section?'grid':'row'} size="panel" artworkOptions={false} panels={overview} />{/if}
  {#if (!section||section==='credits')}
    <Shelf title="Credits" href={!section?rowHref('credits'):undefined} layout={section?'grid':'row'} size="panel" artworkOptions={false}>
      {#if data.item.authors.length}<DetailCard title="Authors"><div class="row wrap">{#each data.item.authors as author}<Button href={`/search?view=read&q=${encodeURIComponent(author)}`}>{author}</Button>{/each}</div></DetailCard>{/if}
      {#if data.item.seriesTitle}<DetailCard title="Series"><Button href={`/search?view=read&kind=comic&q=${encodeURIComponent(data.item.seriesTitle)}`}>{data.item.seriesTitle}</Button></DetailCard>{/if}
      <DetailCard title="Metadata source"><Button emphasis="subtle" href={data.item.sourceUrl}>View on {readingProviderLabel(data.item.provider)}</Button></DetailCard>
    </Shelf>
  {/if}
  {#if !data.remote}
    {#if (!section||section==='collections')&&data.kind==='comic'}<Shelf source={{type:'detail',title:'Collections',path:`reading/${data.item.id}/groups`,href:rowHref('collections'),layout:section?'grid':'row',mediaKind:'reading'}} />{/if}
    {#if (!section||section==='editions')&&(data.item.provider==='openlibrary'||data.item.hasEditions)}<Shelf source={{type:'detail',title:'Editions',path:`reading/${data.item.id}/editions`,href:rowHref('editions'),layout:section?'grid':'row',mediaKind:'reading',page:Number(page.url.searchParams.get('page')??1)}} />{/if}
    {#if !section||section==='activity'}<section class="section" aria-label="Reading progress">
      <div class="reading-heading"><Heading title="Your activity" href={!section?rowHref('activity'):undefined}>
        {#snippet actions()}<Button icon="plus" disabled={busy||menu?.isBusy()} onclick={() => menu?.editReading()}>Update progress</Button>
          {#if data.progress?.state==='completed'}<Button disabled={busy||menu?.isBusy()} onclick={() => menu?.setReading('reading', true)}>Reread</Button>{/if}
          {#if data.progress}<Button icon="check" disabled={busy} onclick={() => menu?.setReading(data.progress!.state === 'completed' ? 'reading' : 'completed')}>{data.progress.state === 'completed' ? 'Mark unfinished' : 'Mark completed'}</Button>{/if}
        {/snippet}
      </Heading></div>
      {#if data.progress}
        <Shelf title="Progress" size="panel" artworkOptions={false}>
          <DetailCard title={displayLabel(data.progress.state)} description={`${data.progress.page.toLocaleString()} pages read`}>
            {#if data.progress.totalPages}<ChartView model={targetModel({label:'Reading page progress',items:[{ label: 'Pages', value: data.progress.page, total: data.progress.totalPages }]})} compact />{:else}<p class="small quiet">Add the page count of your edition to show progress.</p>{/if}
          </DetailCard>
          <DetailCard title="At a glance"><MetricGrid items={[
            { label: 'Current page', value: data.progress.page },
            { label: 'Total pages', value: data.progress.totalPages ?? 'Not set', text: data.progress.totalPages === null },
            { label: 'Started', value: data.progress.startedAt ? new Date(data.progress.startedAt).toLocaleDateString() : 'Not started', text: true },
            { label: 'Completed', value: data.progress.completedAt ? new Date(data.progress.completedAt).toLocaleDateString() : 'Unfinished', text: true },
          ]} /></DetailCard>
        </Shelf>
      {:else}<EmptyState title="Track your reading" description="Choose Update progress to record your reading state, current page and edition page count." icon="library" />{/if}
    </section>
    {#key data.item.id}<div id="reading-history" use:lazyContent={{load:()=>void loadHistory()}}>
      <Shelf title="Reading history" size="panel" artworkOptions={false} hideEmpty={false} itemCount={history.data.items.length} busy={!history.ready && !history.error || history.busy} error={history.error} retry={()=>void loadHistory(history.data.page)} pageNumber={history.data.page} pages={history.data.pages} onpage={number=>void loadHistory(number)}>
        {#each history.data.items as event(event.id)}<DetailCard title={displayLabel(event.state)} description={new Date(event.occurredAt).toLocaleString()}><p class="small quiet">{event.totalPages?`Page ${event.page} of ${event.totalPages}`:`Page ${event.page}`}</p></DetailCard>{/each}
      </Shelf>
    </div>{/key}{/if}
  {/if}
</MediaPage>

<style>
  .reading-heading :global(.identity) { min-width: min(100%, 200px); }
</style>
