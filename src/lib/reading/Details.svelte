<script lang="ts">
  import ReadingLaunch from './ReadingLaunch.svelte';
  import { navigateMedia } from '$lib/ui/media-navigation';
  import { replaceState, afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import MediaDetails from '$lib/ui/components/MediaDetails.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import type {DetailRowsModel} from '$lib/ui/pages/detail-rows';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import ChartView from '$lib/ui/charts/ChartView.svelte';
  import { targetModel } from '$lib/ui/charts/insights';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import WorkMenu from '$lib/ui/components/WorkMenu.svelte';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import {createResource} from '$lib/ui/resource.svelte';
  import { useClient, reportFailure } from '$lib/ui/client-context';
  import { createOperation } from '$lib/ui/operation.svelte';
  import { displayLabel } from '$lib/ui/labels';
  import { readingHero, readingHref, readingCard, readingFacts, readingLabel, readingProviderLabel, type ReadingDetailData } from './presentation';
  import { type ReadingCredit } from './model';

  let { data, modal=false,detailHref }: { data: ReadingDetailData;modal?:boolean;detailHref?:string } = $props();
  const detailUrl=$derived(modal?new URL(detailHref??`/media/${data.item.id}`,page.url):page.url);
  const title = $derived(readingLabel(data.kind));
  const section=$derived(detailUrl.searchParams.get('section'));
  let insight=$state(untrack(()=>['overview','activity','community'].includes(detailUrl.searchParams.get('insight')??'')?detailUrl.searchParams.get('insight')!:'overview'));
  const baseHref=$derived(readingHref(data.item,data.remote));
  const rowHref=(name:string)=>`${baseHref}?section=${name}`;
  const library = $derived(`/library?view=read&kind=${data.kind}&scope=all`);
  const overview = $derived(overviewPanels(data.item.overview, readingFacts(data.item)).map(panel=>panel.title==='Details'?{...panel,footerLink:{href:data.item.sourceUrl,label:`View on ${readingProviderLabel(data.item.provider)} ↗`,external:true}}:panel));
  const { change, api,preview } = useClient();
  const credits=createResource<ReadingCredit[]|null>(null);
  const community=createResource<Awaited<ReturnType<typeof import('./detail.server').readingCommunity>>|null>(null);
  let creditsActive=$state(false);
  let creditSelection=$state('all');
  const contributors=$derived(credits.data??data.item.authors.map(name=>({name,role:'Author'})));
  const roles=$derived([...new Set(contributors.map(person=>person.role))]);
  async function loadCredits(){await credits.load(signal=>api(`reading/${data.item.id}/credits`,undefined,'GET',{signal}));}
  async function loadCommunity(){await community.load(signal=>api(`reading/${data.item.id}/community`,undefined,'GET',{signal}));}
  $effect(()=>{const id=data.item.id;untrack(()=>{id;credits.replace(null);community.replace(null);creditSelection='all';});});
  $effect(()=>{if(creditsActive&&!data.remote&&!credits.activated)untrack(()=>void loadCredits());});
  $effect(()=>{if(insight==='community'&&!data.remote&&!community.activated)untrack(()=>void loadCommunity());});
  onDestroy(()=>{credits.dispose();community.dispose();});
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
      if(!preview)await navigateMedia(`/media/${item.id}`);
    });
  }
  const model=$derived<DetailRowsModel>({
    insights:{selection:insight,select:value=>insight=value,href:`${rowHref('insights')}&insight=${insight}`,tabs:[
      {value:'overview',label:'Overview',panels:overview},
      ...(!data.remote?[{value:'activity',label:'Your activity',content:activity}]:[]),
      ...(!data.remote&&page.data.capabilities?.social!==false?[{value:'community',label:'Community',busy:community.busy||!community.ready&&!community.error,
        panels:community.data?[{title:'Coast readers',content:{kind:'metrics' as const,props:{items:[
          {label:'Reading',value:community.data.reading},{label:'Completed',value:community.data.completed},
          {label:'Ratings',value:community.data.rated},{label:'Average rating',value:community.data.rating===null?'Unrated':`${community.data.rating.toFixed(1)} / 5`,text:true},
        ]}},footerText:'People whose ratings or reading progress are visible to you.'}]:[],
        errors:community.error?[{title:'Community unavailable',message:community.error,retry:loadCommunity}]:[],
      }]:[]),
    ]},
    credits:{selection:creditSelection,select:value=>creditSelection=value,activate:()=>creditsActive=true,
      groups:[{value:'all',label:'All',people:contributors.map(person=>creditCard(person))},...roles.map(role=>({value:role,label:displayLabel(role),people:contributors.filter(person=>person.role===role).map(person=>creditCard(person))}))],
      href:rowHref('credits'),hideEmpty:true,errors:credits.error?[{title:'Credits unavailable',message:credits.error,retry:loadCredits}]:[]},
  });
  function creditCard(person:ReadingCredit){return {id:`credit:${person.name}:${person.role}`,kind:'person' as const,title:person.name,
    href:`/search?view=read&q=${encodeURIComponent(person.name)}`,captionSubtitle:displayLabel(person.role)};}
  reportFailure(()=>failure);
</script>

{#snippet activity()}
 <DetailCard title="Reading progress"><div class="row wrap">
  <Button icon="plus" disabled={busy||menu?.isBusy()} onclick={()=>menu?.editReading()}>Update progress</Button>
  {#if data.progress?.state==='completed'}<Button disabled={busy||menu?.isBusy()} onclick={()=>menu?.setReading('reading',true)}>Reread</Button>{/if}
  {#if data.progress}<Button icon="check" disabled={busy||menu?.isBusy()} onclick={()=>menu?.setReading(data.progress!.state==='completed'?'reading':'completed')}>{data.progress.state==='completed'?'Mark unfinished':'Mark completed'}</Button>{/if}
 </div></DetailCard>
      {#if data.progress}

          <DetailCard title={displayLabel(data.progress.state)} description={`${data.progress.page.toLocaleString()} pages read`}>
            {#if data.progress.totalPages}<ChartView model={targetModel({label:'Reading page progress',items:[{ label: 'Pages', value: data.progress.page, total: data.progress.totalPages }]})} compact />{:else}<p class="small quiet">Add the page count of your edition to show progress.</p>{/if}
          </DetailCard>
          <DetailCard title="At a glance"><MetricGrid items={[
            { label: 'Current page', value: data.progress.page },
            { label: 'Total pages', value: data.progress.totalPages ?? 'Not set', text: data.progress.totalPages === null },
            { label: 'Started', value: data.progress.startedAt ? new Date(data.progress.startedAt).toLocaleDateString() : 'Not started', text: true },
            { label: 'Completed', value: data.progress.completedAt ? new Date(data.progress.completedAt).toLocaleDateString() : 'Unfinished', text: true },
          ]} /></DetailCard>

      {:else}<EmptyState title="Track your reading" description="Choose Update progress to record your reading state, current page and edition page count." icon="library" />{/if}
{/snippet}
<svelte:head><title>{data.item.title} · {title} · Coast</title></svelte:head>
<MediaDetails {detailHref} view={{hero:!section,item:readingHero(data.item,data.remote)}} {model} {section}>
  {#if section&&!modal}<Button emphasis="subtle" href={`/media/${data.item.id}`} icon="left">{data.item.title}</Button>{/if}
  {#snippet heroActions()}
    <Button emphasis="subtle" href={library} icon="left">Library</Button>
    {#if data.remote}<Button size="hero" icon="plus" disabled={busy} onclick={add}>Add {data.kind}</Button>
    {:else}
      {#if page.data.capabilities?.reader!==false}<ReadingLaunch workId={data.item.id} title={data.item.title} />{/if}
      <WorkMenu bind:this={menu} item={readingCard(data.item)} readingState={data.progress} showTrigger hero menuOnly />
    {/if}
  {/snippet}
  {#snippet hierarchy()}{#if !data.remote}
    {#if (!section||section==='issues')&&data.kind==='comic'}<Shelf source={{type:'detail',title:data.item.seriesTitle||'Issues',path:`reading/${data.item.id}/issues`,href:rowHref('issues'),layout:section?'grid':'row',mediaKind:'reading',page:Number(detailUrl.searchParams.get('page')??1)}} />{/if}
  {/if}{/snippet}

  {#if !data.remote}
    {#if (!section||section==='editions')&&(data.item.provider==='openlibrary'||data.item.hasEditions)}<Shelf source={{type:'detail',title:'Editions',path:`reading/${data.item.id}/editions`,href:rowHref('editions'),layout:section?'grid':'row',mediaKind:'reading',page:Number(detailUrl.searchParams.get('page')??1)}} />{/if}
    {#if !section||section==='related'}<Shelf source={{type:'detail',title:'Related titles',path:`reading/${data.item.id}/related`,href:rowHref('related'),layout:section?'grid':'row',mediaKind:'reading',page:Number(detailUrl.searchParams.get('page')??1)}} />{/if}
  {/if}
</MediaDetails>
