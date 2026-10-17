<script lang="ts">
  import { goto, replaceState, afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import {setContext} from 'svelte';
  import { untrack } from 'svelte';
  import { message } from '$lib/ui/client';
  import { displayLabel } from '$lib/ui/labels';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import { gameHero, gameFacts, gameMinutes } from '$lib/games/presentation';
  import Button from '$lib/ui/components/Button.svelte';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import ChartView from '$lib/ui/charts/ChartView.svelte';
  import { targetModel } from '$lib/ui/charts/insights';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';

  import WorkMenu from '$lib/ui/components/WorkMenu.svelte';
  import { gameCard } from '$lib/games/presentation';
  import {onDestroy} from 'svelte';
  import {useClient} from '$lib/ui/client-context';
  import {createResource} from '$lib/ui/resource.svelte';
  import {lazyContent} from '$lib/ui/lazy-content';
  let { data }: {data:{item:Awaited<ReturnType<typeof import('$lib/core/games/service.server').gameDetails>>;playthrough:Awaited<ReturnType<typeof import('$lib/core/games/service.server').playthroughSummary>>|null;sources:Awaited<ReturnType<typeof import('$lib/providers/instances.server').listProviders>>}} = $props();
  const {api,change,preview}=useClient();
  const history=createResource<Awaited<ReturnType<typeof import('$lib/core/games/service.server').playthroughDetails>>|null>(null);
  onDestroy(history.dispose);
  async function loadHistory(number=1){const id=data.playthrough?.id;if(id)await history.load(signal=>api(`game-playthroughs/${id}?page=${number}`,undefined,'GET',{signal}));}
  $effect(()=>{const id=data.playthrough?.id;untrack(()=>{id;history.cancel();history.replace(null);});});
  setContext('profile-read-only',()=>!page.data.user);
  const section=$derived(page.url.searchParams.get('section'));
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
  function selectedUrl(id: string, page = 1) { return `/games/${data.item.id}?${new URLSearchParams({ playthrough: id, page: String(page),...(section?{section}:{}) })}`; }
  async function refresh() {
    if (preview || !identity || !refreshInstance) return;
    await act(async () => {
      await change('games/import', { instanceId: refreshInstance, externalId: identity.externalId });
    });
  }
</script>
<svelte:head><title>{data.item.title} · Games · Coast</title></svelte:head>
<MediaPage details hero={!section} item={gameHero(data.item)}>
  {#if section}<Button emphasis="subtle" href={`/games/${data.item.id}`} icon="left">{data.item.title}</Button>{/if}
    {#snippet heroActions()}{#if page.data.user}
      <Button emphasis="subtle" href="/games" icon="left">Games</Button>
      {#if loggingAllowed}<Button size="hero" icon="plus" disabled={busy||menu?.isBusy()} onclick={() => menu?.gameAction('log')}>Log a play session</Button>
      {:else if playthrough && playthrough.status !== 'completed'}<Button size="hero" icon="play" disabled={busy||menu?.isBusy()} onclick={() => menu?.updateGame('in-progress')}>Resume playthrough</Button>
      {:else}<Button size="hero" icon="plus" disabled={busy||menu?.isBusy()} onclick={() => menu?.gameAction('start')}>Start {playthrough ? 'replaying' : 'playthrough'}</Button>{/if}
      <WorkMenu bind:this={menu} item={gameCard(data.item)} showTrigger hero menuOnly
        gameState={{ platforms: data.item.platforms, playthrough: data.playthrough }} selectedPlaythrough={playthrough?.id}
        ongamecreated={id => preview?Promise.resolve():goto(selectedUrl(id), { invalidateAll: true })}
        onchanged={()=>{if(history.activated)void loadHistory(history.data?.page??1);}}
        refreshGame={identity && data.sources.length ? refresh : undefined} />
    {:else}<Button href="/login" size="hero">Sign in to track</Button>{/if}{/snippet}

  {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}
  {#if overview.length&&(!section||section==='insights')}<Shelf title="Insights" href={!section?rowHref('insights'):undefined} layout={section?'grid':'row'} size="panel" artworkOptions={false} panels={overview} />{/if}
  {#if !section||section==='activity'}<section class="section" aria-label="Playthroughs">
    <Heading title="Your activity" href={!section?rowHref('activity'):undefined}>
      {#snippet segments()}{#if data.item.playthroughs.length}
        <select aria-label="Playthrough" value={playthrough?.id ?? ''} onchange={(event) => {if(!preview)void goto(selectedUrl(event.currentTarget.value), { noScroll: true, keepFocus: true });}}>
          {#each data.item.playthroughs as entry, index}<option value={entry.id}>{entry.repeat ? 'Replay' : 'Playthrough'} · {entry.platform || 'All platforms'} · {displayLabel(entry.status)} · {data.item.playthroughs.length - index}</option>{/each}
        </select>
      {/if}{/snippet}
      {#snippet actions()}{#if identity && data.sources.length > 1}<select aria-label="Metadata refresh source" bind:value={refreshInstance}>{#each data.sources as source}<option value={source.id}>{source.name}</option>{/each}</select>{/if}{/snippet}
    </Heading>
    {#if playthrough}
      <Shelf title="Progress" size="panel" artworkOptions={false}>
        <DetailCard title={displayLabel(playthrough.status)} description={playthrough.repeat ? 'Replaying' : 'Current playthrough'}>
          <ChartView model={targetModel({label:'Game completion',items:[{ label: 'Completion', value: playthrough.progressPercent, total: 100 }]})} compact />
        </DetailCard>
        <DetailCard title="At a glance"><MetricGrid items={[
          { label: 'Time played', value: gameMinutes(playthrough.minutesPlayed) },
          { label: 'Play sessions', value: playthrough.total },
          { label: 'Started', value: playthrough.startedAt ? new Date(playthrough.startedAt).toLocaleDateString() : 'Not started', text: true },
          { label: 'Completed', value: playthrough.completedAt ? new Date(playthrough.completedAt).toLocaleDateString() : 'Unfinished', text: true },
        ]} /></DetailCard>
      </Shelf>
      {#key playthrough.id}<div id="play-history" use:lazyContent={{load:()=>void loadHistory()}}>
        <Shelf title="Play history" size="panel" artworkOptions={false} hideEmpty={false}
          busy={history.busy||!history.data&&!history.error} error={history.error} retry={()=>void loadHistory()}
          itemCount={history.data?.sessions.length??0} pageNumber={history.data?.page??1} pages={history.data?.pages??1} onpage={number=>void loadHistory(number)}>
          {#each history.data?.sessions??[] as session(session.id)}<DetailCard title={new Date(session.playedAt).toLocaleString()} description={gameMinutes(session.minutesPlayed)}><p class="small quiet">{session.note||'Play session'}</p></DetailCard>{/each}
          {#snippet empty()}<EmptyState title="No play sessions yet" description="Log a session to record your time played." icon="clock" />{/snippet}
        </Shelf>
      </div>{/key}
    {:else}<EmptyState title="Start your first playthrough" description="Track completion and log the time you spend playing." icon="library">
      <Button icon="plus" href={!page.data.user?'/login':undefined} onclick={() => menu?.gameAction('start')}>{page.data.user?'Start playthrough':'Sign in to track'}</Button>
    </EmptyState>{/if}
  </section>{/if}
</MediaPage>
