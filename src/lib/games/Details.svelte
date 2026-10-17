<script lang="ts">
  import { replaceState, afterNavigate } from '$app/navigation';
  import {navigateMedia} from '$lib/ui/media-navigation';
  import { page } from '$app/state';
  import {setContext} from 'svelte';
  import { untrack } from 'svelte';
  import { message } from '$lib/ui/client';
  import { displayLabel } from '$lib/ui/labels';
  import MediaDetails from '$lib/ui/components/MediaDetails.svelte';
  import { gameHero, gameFacts, gameMinutes } from '$lib/games/presentation';
  import Button from '$lib/ui/components/Button.svelte';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import SegmentedControl from '$lib/ui/components/SegmentedControl.svelte';
  import type {DetailRowsModel} from '$lib/ui/pages/detail-rows';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import ChartView from '$lib/ui/charts/ChartView.svelte';
  import { targetModel } from '$lib/ui/charts/insights';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';

  import WorkMenu from '$lib/ui/components/WorkMenu.svelte';
  import { gameCard } from '$lib/games/presentation';
  import {useClient} from '$lib/ui/client-context';
  let { data,modal=false,detailHref }: {modal?:boolean;detailHref?:string;data:{item:Awaited<ReturnType<typeof import('$lib/core/games/service.server').gameDetails>>;playthrough:Awaited<ReturnType<typeof import('$lib/core/games/service.server').playthroughSummary>>|null;sources:Awaited<ReturnType<typeof import('$lib/providers/instances.server').listProviders>>}} = $props();
  const detailUrl=$derived(modal?new URL(detailHref??`/games/${data.item.id}`,page.url):page.url);
  const {change,preview}=useClient();
  setContext('profile-read-only',()=>!page.data.user);
  const section=$derived(detailUrl.searchParams.get('section'));
  let insight=$state(untrack(()=>detailUrl.searchParams.get('insight')==='progress'?'progress':'overview'));
  const rowHref=(name:string)=>`/games/${data.item.id}?${new URLSearchParams({section:name,...(data.playthrough?{playthrough:data.playthrough.id}:{})})}`;
  const overview = $derived([...overviewPanels(data.item.overview,gameFacts(data.item)),...data.item.steam.map(account=>({
    title:`Steam · ${account.username}`,description:account.owned?'Owned on Steam · installation unknown':'Last imported Steam progress',
    content:{kind:'metrics' as const,props:{items:[{label:'Steam playtime',value:gameMinutes(account.minutes_played)},{label:'Last two weeks',value:gameMinutes(account.recent_minutes)},
      ...(account.achievements_at?[{label:'Achievements',value:`${account.unlocked} / ${account.total}`,detail:`Updated ${new Date(account.achievements_at).toLocaleDateString()}`}]:[])]}},
    footerText:`Ownership checked ${new Date(account.observed_at).toLocaleDateString()}`,
  }))]);
  let busy = $state(false), failure = $state('');
  let menu = $state<WorkMenu>();
  let refreshInstance = $state(untrack(() => data.sources[0]?.id ?? ''));
  const playthrough = $derived(data.playthrough);
  const identity = $derived(data.item.identities.find((item) => item.provider === 'igdb'));
  const loggingAllowed = $derived(!!playthrough && ['planned', 'in-progress'].includes(playthrough.status));
  $effect(() => {
    if (!data.sources.some((source) => source.id === refreshInstance)) refreshInstance = data.sources[0]?.id ?? '';
  });
  async function act(work: () => Promise<unknown>) {
    if (busy) return;
    busy = true; failure = '';
    try { await work(); } catch (cause) { failure = message(cause); } finally { busy = false; }
  }
  afterNavigate(() => {
    const action = page.url.searchParams.get('action');
    if (!action || !menu) return;
    untrack(() => {
      if (action === 'start') void menu?.gameAction('start');
      else if (action === 'progress' && playthrough) void menu?.gameAction('progress');
      else if (action === 'log' && loggingAllowed) void menu?.gameAction('log');
      const url = new URL(page.url);
      url.searchParams.delete('action');
      replaceState(url, page.state);
    });
  });
  function selectedUrl(id: string, page = 1) { return `/games/${data.item.id}?${new URLSearchParams({ playthrough: id, page: String(page),...(section?{section}:{}),insight })}`; }
  async function refresh() {
    if (preview || !identity || !refreshInstance) return;
    await act(async () => {
      await change('games/import', { instanceId: refreshInstance, externalId: identity.externalId });
    });
  }
  const model=$derived<DetailRowsModel>({insights:{selection:insight,select:value=>insight=value,tabs:[{value:'overview',label:'Overview',panels:overview},{value:'progress',label:'Your progress',content:progress}],href:`${rowHref('insights')}&insight=${insight}`}});
</script>
{#snippet activityControls()}{#if identity&&data.sources.length>1}<select aria-label="Metadata refresh source" bind:value={refreshInstance}>{#each data.sources as source}<option value={source.id}>{source.name}</option>{/each}</select>{/if}{/snippet}
{#snippet activitySelection()}<SegmentedControl material="clear" presentation="navigation" label="Playthrough" value={playthrough?.id??''}
 options={data.item.playthroughs.map((entry,index)=>({value:entry.id,label:`${entry.repeat?'Replay':'Playthrough'} · ${entry.platform||'All platforms'} · ${displayLabel(entry.status)} · ${data.item.playthroughs.length-index}`}))}
 onchange={value=>{if(!preview)void navigateMedia(selectedUrl(value),{noScroll:true,keepFocus:true});}} />{/snippet}
{#snippet progress()}
 <DetailCard title="Playthrough">{@render activitySelection()}{@render activityControls()}</DetailCard>
    {#if playthrough}
        <DetailCard title={displayLabel(playthrough.status)} description={playthrough.repeat ? 'Replaying' : 'Current playthrough'}>
          <ChartView model={targetModel({label:'Game completion',items:[{ label: 'Completion', value: playthrough.progressPercent, total: 100 }]})} compact />
        </DetailCard>
        <DetailCard title="At a glance"><MetricGrid items={[
          { label: 'Time played', value: gameMinutes(playthrough.minutesPlayed) },
          { label: 'Play sessions', value: playthrough.total },
          { label: 'Started', value: playthrough.startedAt ? new Date(playthrough.startedAt).toLocaleDateString() : 'Not started', text: true },
          { label: 'Completed', value: playthrough.completedAt ? new Date(playthrough.completedAt).toLocaleDateString() : 'Unfinished', text: true },
        ]} /></DetailCard>
    {:else}<EmptyState title="Start your first playthrough" description="Track completion and log the time you spend playing." icon="library">
      <Button icon="plus" href={!page.data.user?'/login':undefined} onclick={() => menu?.gameAction('start')}>{page.data.user?'Start playthrough':'Sign in to track'}</Button>
    </EmptyState>{/if}
{/snippet}
<svelte:head><title>{data.item.title} · Games · Coast</title></svelte:head>
<MediaDetails {detailHref} view={{hero:!section,item:gameHero(data.item)}} {model} {section}>
  {#if section&&!modal}<Button emphasis="subtle" href={`/games/${data.item.id}`} icon="left">{data.item.title}</Button>{/if}
    {#snippet heroActions()}{#if page.data.user}
      <Button emphasis="subtle" href="/games" icon="left">Games</Button>
      {#if loggingAllowed}<Button size="hero" icon="plus" disabled={busy||menu?.isBusy()} onclick={() => menu?.gameAction('log')}>Log a play session</Button>
      {:else if playthrough && playthrough.status !== 'completed'}<Button size="hero" icon="play" disabled={busy||menu?.isBusy()} onclick={() => menu?.updateGame('in-progress')}>Resume playthrough</Button>
      {:else}<Button size="hero" icon="plus" disabled={busy||menu?.isBusy()} onclick={() => menu?.gameAction('start')}>Start {playthrough ? 'replaying' : 'playthrough'}</Button>{/if}
      <WorkMenu bind:this={menu} item={gameCard(data.item)} showTrigger hero menuOnly
        gameState={{ platforms: data.item.platforms, playthrough: data.playthrough }} selectedPlaythrough={playthrough?.id}
        ongamecreated={id => preview?Promise.resolve():navigateMedia(selectedUrl(id), { invalidateAll: true })}
        refreshGame={identity && data.sources.length ? refresh : undefined} />
    {:else}<Button href="/login" size="hero">Sign in to track</Button>{/if}{/snippet}

  {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}

</MediaDetails>
