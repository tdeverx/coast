<script lang="ts">
  import ReadingLaunch from './ReadingLaunch.svelte';
  import { goto } from '$app/navigation';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import ProgressChart from '$lib/ui/components/ProgressChart.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import PresentationActions from '$lib/ui/components/PresentationActions.svelte';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import {lazyContent} from '$lib/ui/lazy-content';
  import {createResource} from '$lib/ui/resource.svelte';
  import { useClient } from '$lib/ui/client-context';
  import { createOperation } from '$lib/ui/operation.svelte';
  import { displayLabel } from '$lib/ui/labels';
  import { readingHero, readingCard, readingFacts, readingLabel, readingProviderLabel, type ReadingDetailData } from './presentation';
  import { readingStates, type ReadingState } from './model';

  let { data }: { data: ReadingDetailData } = $props();
  const title = $derived(readingLabel(data.kind));
  const library = $derived(`/library?view=read&kind=${data.kind}&scope=all`);
  const overview = $derived(overviewPanels(data.item.overview, readingFacts(data.item)));
  const { change, api } = useClient();
  const history=createResource<{items:{id:string;state:ReadingState;page:number;totalPages:number|null;occurredAt:string}[];page:number;pages:number;total:number}>({items:[],page:1,pages:1,total:0});
  let historyWork='';
  $effect(()=>{const id=data.item.id;untrack(()=>{if(historyWork!==id){history.cancel();history.replace({items:[],page:1,pages:1,total:0});historyWork=id;}});});
  async function loadHistory(number=1){await history.load(signal=>api(`reading/${data.item.id}/history?page=${number}`,undefined,'GET',{signal}));}
  onDestroy(()=>history.cancel());
  const operation = createOperation();
  const busy = $derived(operation.busy);
  const failure = $derived(operation.error);
  let progressOpen = $state(false);
  let readingState = $state<ReadingState>('reading'), currentPage = $state<number | undefined>(0), totalPages = $state<number | undefined>();
  async function act(task: () => Promise<void>) {
    await operation.run(task);
  }
  function editProgress() {
    readingState = data.progress?.state ?? 'reading'; currentPage = data.progress?.page ?? 0;
    totalPages = data.progress?.totalPages ?? undefined; operation.error = ''; progressOpen = true;
  }
  $effect(() => {
    if (data.remote || page.url.searchParams.get('action') !== 'progress') return;
    untrack(() => {
      editProgress();
      const url = new URL(page.url); url.searchParams.delete('action'); replaceState(url, page.state);
    });
  });
  async function add() {
    await act(async () => {
      const item = await change<{ id: string }>('reading/import', { kind: data.kind, externalId: data.item.externalId });
      await goto(`/media/${item.id}`);
    });
  }
  async function saveProgress(nextState = readingState) {
    if (currentPage === undefined || !Number.isSafeInteger(currentPage) || currentPage < 0 || currentPage > 1000000 || (totalPages !== undefined && (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 1000000 || currentPage > totalPages))) {
      operation.error = 'Enter a valid current page and total pages. The current page cannot exceed the total.';
      return;
    }
    await act(async () => {
      await change(`reading/${data.item.id}/progress`, { state: nextState, page: currentPage, totalPages: totalPages ?? null });
      progressOpen = false;if(history.activated)void loadHistory();
    });
  }
  async function setState(nextState: ReadingState) {
    await act(async () => {
      await change(`reading/${data.item.id}/progress`, { state: nextState });if(history.activated)void loadHistory();
    });
  }
</script>

<svelte:head><title>{data.item.title} · {title} · Coast</title></svelte:head>
<MediaPage details item={readingHero(data.item, data.remote)}>
  {#snippet heroActions()}
    <Button emphasis="subtle" href={library} icon="left">Library</Button>
    {#if data.remote}<Button size="hero" icon="plus" disabled={busy} onclick={add}>Add {data.kind}</Button>
    {:else}
      <ReadingLaunch workId={data.item.id} title={data.item.title} />
      <Button size="hero" icon="plus" disabled={busy} onclick={editProgress}>{data.progress ? 'Update reading' : 'Start reading'}</Button>
      <PresentationActions item={readingCard(data.item)} showTrigger />
    {/if}
    <Button emphasis="subtle" href={data.item.sourceUrl}>View on {readingProviderLabel(data.item.provider)}</Button>
  {/snippet}
  {#if failure && !progressOpen}<div class="notice error" role="alert">{failure}</div>{/if}
  <p class="small quiet">Experimental · Metadata from <a href={data.item.sourceUrl} target="_blank" rel="noreferrer">{readingProviderLabel(data.item.provider)}</a>.</p>
  {#if overview.length}<Shelf title="Overview" size="panel" artworkOptions={false} panels={overview} />{/if}
  {#if data.item.authors.length||data.item.seriesTitle}
    <Shelf title="Explore" size="panel" artworkOptions={false}>
      {#if data.item.authors.length}<DetailCard title="Authors"><div class="row wrap">{#each data.item.authors as author}<Button href={`/search?view=read&q=${encodeURIComponent(author)}`}>{author}</Button>{/each}</div></DetailCard>{/if}
      {#if data.item.seriesTitle}<DetailCard title="Series"><Button href={`/search?view=read&kind=comic&q=${encodeURIComponent(data.item.seriesTitle)}`}>{data.item.seriesTitle}</Button></DetailCard>{/if}
      {#if data.item.editionIds?.length}<DetailCard title="Editions"><Button href={`https://openlibrary.org/works/${data.item.externalId}/editions`}>View editions on Open Library</Button></DetailCard>{/if}
    </Shelf>
  {/if}
  {#if !data.remote}
    <section class="section" aria-label="Reading progress">
      <div class="reading-heading"><Heading title="Reading progress">
        {#snippet actions()}<Button icon="plus" disabled={busy} onclick={editProgress}>Update progress</Button>
          {#if data.progress?.state==='completed'}<Button disabled={busy} onclick={()=>act(async()=>{await change(`reading/${data.item.id}/progress`,{restart:true,state:'reading',page:0});void loadHistory();})}>Reread</Button>{/if}
          {#if data.progress}<Button icon="check" disabled={busy} onclick={() => setState(data.progress!.state === 'completed' ? 'reading' : 'completed')}>{data.progress.state === 'completed' ? 'Mark unfinished' : 'Mark completed'}</Button>{/if}
        {/snippet}
      </Heading></div>
      {#if data.progress}
        <Shelf title="Progress" size="panel" artworkOptions={false}>
          <DetailCard title={displayLabel(data.progress.state)} description={`${data.progress.page.toLocaleString()} pages read`}>
            {#if data.progress.totalPages}<ProgressChart label="Reading page progress" items={[{ label: 'Pages', value: data.progress.page, total: data.progress.totalPages }]} />{:else}<p class="small quiet">Add the page count of your edition to show progress.</p>{/if}
          </DetailCard>
          <DetailCard title="At a glance"><MetricGrid items={[
            { label: 'Current page', value: data.progress.page },
            { label: 'Total pages', value: data.progress.totalPages ?? 'Not set', text: data.progress.totalPages === null },
            { label: 'Started', value: data.progress.startedAt ? new Date(data.progress.startedAt).toLocaleDateString() : 'Not started', text: true },
            { label: 'Completed', value: data.progress.completedAt ? new Date(data.progress.completedAt).toLocaleDateString() : 'Unfinished', text: true },
          ]} /></DetailCard>
        </Shelf>
      {:else}<EmptyState title="Track your reading" description="Choose a reading state and record your current page. Add the page count for the edition you are reading." icon="library"><Button onclick={editProgress}>Start reading</Button></EmptyState>{/if}
    </section>
    {#key data.item.id}<div use:lazyContent={{load:()=>void loadHistory()}}>
      <Shelf title="Reading history" size="panel" artworkOptions={false} hideEmpty={false} busy={history.busy&&!history.data.items.length}>
        {#each history.data.items as event(event.id)}<DetailCard title={displayLabel(event.state)} description={new Date(event.occurredAt).toLocaleString()}><p class="small quiet">{event.totalPages?`Page ${event.page} of ${event.totalPages}`:`Page ${event.page}`}</p></DetailCard>{:else}<DetailCard title="No reading history yet" />{/each}
      </Shelf>
      {#if history.error}<p role="alert" class="notice error">{history.error}<Button onclick={()=>loadHistory(history.data.page)}>Retry</Button></p>{/if}
      {#if history.data.pages>1}<div class="row"><Button disabled={history.busy||history.data.page<=1} onclick={()=>loadHistory(history.data.page-1)}>Previous</Button><Button disabled={history.busy||history.data.page>=history.data.pages} onclick={()=>loadHistory(history.data.page+1)}>Next</Button></div>{/if}
    </div>{/key}
  {/if}
</MediaPage>

<Dialog bind:open={progressOpen} title="Update reading progress">
  <form class="stack" onsubmit={event => { event.preventDefault(); void saveProgress(); }}>
    {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}
    <label class="field">Reading state<select bind:value={readingState}>{#each readingStates as entry}<option value={entry}>{displayLabel(entry)}</option>{/each}</select></label>
    <label class="field">Current page<input type="number" bind:value={currentPage} required min="0" max="1000000" step="1" /></label>
    <label class="field">Total pages (optional)<input type="number" bind:value={totalPages} min="1" max="1000000" step="1" placeholder="Page count of your edition" /></label>
    <p class="small quiet">Completing the page count keeps your current reading state. Choose Completed when you have finished.</p>
    <div class="row"><Button disabled={busy} onclick={() => progressOpen = false}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save progress'}</Button></div>
  </form>
</Dialog>

<style>
  .reading-heading :global(.identity) { min-width: min(100%, 200px); }
</style>
