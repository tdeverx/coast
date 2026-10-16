<script lang="ts">
  import { goto, replaceState, afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import {setContext} from 'svelte';
  import { untrack } from 'svelte';
  import { change, message } from '$lib/ui/client';
  import { displayLabel } from '$lib/ui/labels';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import { gameHero, gameFacts, gameMinutes } from '$lib/games/presentation';
  import Button from '$lib/ui/components/Button.svelte';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import ProgressChart from '$lib/ui/components/ProgressChart.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';

  import WorkMenu from '$lib/ui/components/WorkMenu.svelte';
  import { gameCard } from '$lib/games/presentation';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  let { data } = $props();
  setContext('profile-read-only',()=>!page.data.user);
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
  function selectedUrl(id: string, page = 1) { return `/games/${data.item.id}?${new URLSearchParams({ playthrough: id, page: String(page) })}`; }
  async function refresh() {
    if (!identity || !refreshInstance) return;
    await act(async () => {
      await change('games/import', { instanceId: refreshInstance, externalId: identity.externalId });
    });
  }
</script>
<svelte:head><title>{data.item.title} · Games · Coast</title></svelte:head>
<MediaPage details item={gameHero(data.item)}>
    {#snippet heroActions()}{#if page.data.user}
      <Button emphasis="subtle" href="/games" icon="left">Games</Button>
      {#if loggingAllowed}<Button size="hero" icon="plus" disabled={busy} onclick={() => menu?.gameAction('log')}>Log a play session</Button>
      {:else if playthrough && playthrough.status !== 'completed'}<Button size="hero" icon="play" disabled={busy} onclick={() => menu?.updateGame('in-progress')}>Resume playthrough</Button>
      {:else}<Button size="hero" icon="plus" disabled={busy} onclick={() => menu?.gameAction('start')}>Start {playthrough ? 'replaying' : 'playthrough'}</Button>{/if}
      <WorkMenu bind:this={menu} item={gameCard(data.item)} showTrigger hero menuOnly
        gameState={{ platforms: data.item.platforms, playthrough: data.playthrough }} selectedPlaythrough={playthrough?.id}
        ongamecreated={id => goto(selectedUrl(id), { invalidateAll: true })}
        refreshGame={identity && data.sources.length ? refresh : undefined} />
    {:else}<Button href="/login" size="hero">Sign in to track</Button>{/if}{/snippet}

  {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}
  {#if overview.length}<Shelf title="Overview" size="panel" artworkOptions={false} panels={overview} />{/if}
  <section class="section" aria-label="Playthroughs">
    <Heading title="Playthroughs">
      {#snippet segments()}{#if data.item.playthroughs.length}
        <select aria-label="Playthrough" value={playthrough?.id ?? ''} onchange={(event) => goto(selectedUrl(event.currentTarget.value), { noScroll: true, keepFocus: true })}>
          {#each data.item.playthroughs as entry, index}<option value={entry.id}>{entry.repeat ? 'Replay' : 'Playthrough'} · {entry.platform || 'All platforms'} · {displayLabel(entry.status)} · {data.item.playthroughs.length - index}</option>{/each}
        </select>
      {/if}{/snippet}
      {#snippet actions()}{#if identity && data.sources.length > 1}<select aria-label="Metadata refresh source" bind:value={refreshInstance}>{#each data.sources as source}<option value={source.id}>{source.name}</option>{/each}</select>{/if}{/snippet}
    </Heading>
    {#if playthrough}
      <Shelf title="Progress" size="panel" artworkOptions={false}>
        <DetailCard title={displayLabel(playthrough.status)} description={playthrough.repeat ? 'Replaying' : 'Current playthrough'}>
          <ProgressChart label="Game completion" items={[{ label: 'Completion', value: playthrough.progressPercent, total: 100 }]} />
        </DetailCard>
        <DetailCard title="At a glance"><MetricGrid items={[
          { label: 'Time played', value: gameMinutes(playthrough.minutesPlayed) },
          { label: 'Play sessions', value: playthrough.total },
          { label: 'Started', value: playthrough.startedAt ? new Date(playthrough.startedAt).toLocaleDateString() : 'Not started', text: true },
          { label: 'Completed', value: playthrough.completedAt ? new Date(playthrough.completedAt).toLocaleDateString() : 'Unfinished', text: true },
        ]} /></DetailCard>
      </Shelf>
      <div id="play-history"><Heading title="Play history" /></div>
      {#if playthrough.sessions.length}<div class="overflow"><table class="table">
        <thead><tr><th scope="col">Date</th><th scope="col">Time played</th><th scope="col">Note</th></tr></thead>
        <tbody>{#each playthrough.sessions as session (session.id)}<tr><td>{new Date(session.playedAt).toLocaleString()}</td><td>{gameMinutes(session.minutesPlayed)}</td><td>{session.note || '—'}</td></tr>{/each}</tbody>
      </table></div>
      <Pagination page={playthrough.page} pages={playthrough.pages} pageUrl={(page) => selectedUrl(playthrough!.id, page)} label="Play history pages" />
      {:else}<EmptyState title="No play sessions yet" description="Log a session to record your time played." icon="clock" />{/if}
    {:else}<EmptyState title="Start your first playthrough" description="Track completion and log the time you spend playing." icon="library">
      <Button  icon="plus" onclick={() => menu?.gameAction('start')}>Start playthrough</Button>
    </EmptyState>{/if}
  </section>
</MediaPage>
