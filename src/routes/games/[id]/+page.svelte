<script lang="ts">
  import { goto, invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import {setContext} from 'svelte';
  import { untrack } from 'svelte';
  import { randomId } from '$lib/diagnostics';
  import { api, message } from '$lib/ui/client';
  import { gameStatuses, type GameStatus } from '$lib/games/model';
  import { gameMinutes } from '$lib/games/presentation';
  import { displayLabel } from '$lib/ui/labels';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import { gameHero } from '$lib/games/presentation';
  import Button from '$lib/ui/components/Button.svelte';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import { gameFacts } from '$lib/games/presentation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import ProgressChart from '$lib/ui/components/ProgressChart.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import ContextMenu from '$lib/ui/components/ContextMenu.svelte';
  import MenuAction from '$lib/ui/components/MenuAction.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import RecommendAction from '$lib/ui/components/RecommendAction.svelte';
  import ReactionActions from '$lib/ui/components/ReactionActions.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  let { data } = $props();
  setContext('profile-read-only',()=>!page.data.user);
  const overview = $derived(overviewPanels(data.item.overview,gameFacts(data.item)));
  let busy = $state(false), failure = $state('');
  let startOpen = $state(false), progressOpen = $state(false), sessionOpen = $state(false);
  let platform = $state(''), repeat = $state(false), percent = $state(0), status = $state<GameStatus>('in-progress');
  let minutes = $state(60), playedAt = $state(''), note = $state(''), sessionId = $state('');
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
  function openStart(isRepeat = false) {
    repeat = isRepeat; platform = data.item.platforms[0] ?? ''; failure = ''; startOpen = true;
  }
  function openProgress() {
    if (!playthrough) return;
    percent = playthrough.progressPercent; status = playthrough.status; failure = ''; progressOpen = true;
  }
  function openSession() {
    const now = new Date();
    playedAt = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    sessionId = randomId(); minutes = 60; note = ''; failure = ''; sessionOpen = true;
  }
  $effect(() => {
    const action = page.url.searchParams.get('action');
    if (!action) return;
    untrack(() => {
      if (action === 'start') openStart(!!playthrough);
      else if (action === 'progress' && playthrough) openProgress();
      else if (action === 'log' && loggingAllowed) openSession();
      const url = new URL(page.url);
      url.searchParams.delete('action');
      replaceState(url, page.state);
    });
  });
  function selectedUrl(id: string, page = 1) { return `/games/${data.item.id}?${new URLSearchParams({ playthrough: id, page: String(page) })}`; }
  async function start() {
    await act(async () => {
      const created = await api<{ id: string }>(`games/${data.item.id}/playthroughs`, { platform: platform || undefined, repeat, status: 'in-progress' });
      startOpen = false;
      await goto(selectedUrl(created.id), { invalidateAll: true });
    });
  }
  async function update(nextStatus: GameStatus, progressPercent?: number) {
    if (!playthrough) return;
    await act(async () => {
      await api(`game-playthroughs/${playthrough.id}`, { status: nextStatus, progressPercent }, 'PATCH');
      progressOpen = false;
      await invalidateAll();
    });
  }
  async function log() {
    if (!playthrough) return;
    await act(async () => {
      await api(`game-playthroughs/${playthrough.id}/sessions`, { id: sessionId, minutesPlayed: minutes, playedAt: new Date(playedAt).toISOString(), note: note || undefined });
      sessionOpen = false;
      await invalidateAll();
    });
  }
  async function refresh() {
    if (!identity || !refreshInstance) return;
    await act(async () => {
      await api('games/import', { instanceId: refreshInstance, externalId: identity.externalId });
      await invalidateAll();
    });
  }
</script>
<svelte:head><title>{data.item.title} · Games · Coast</title></svelte:head>
<MediaPage details item={gameHero(data.item)}>
    {#snippet heroActions()}{#if page.data.user}
      <Button variant="ghost" href="/games" icon="left">Games</Button>
      {#if loggingAllowed}<Button variant="hero" icon="plus" disabled={busy} onclick={openSession}>Log a play session</Button>
      {:else if playthrough && playthrough.status !== 'completed'}<Button variant="hero" icon="play" disabled={busy} onclick={() => update('in-progress')}>Resume playthrough</Button>
      {:else}<Button variant="hero" icon="plus" disabled={busy} onclick={() => openStart(!!playthrough)}>Start {playthrough ? 'replaying' : 'playthrough'}</Button>{/if}
      <ContextMenu label="Game actions" disabled={busy}>
        <RecommendAction workId={data.item.id} disabled={busy} /><ReactionActions targetId={data.item.id} disabled={busy} />
        <MenuAction icon="plus" keepOpen={false} onclick={() => openStart(!!playthrough)}>Start another playthrough</MenuAction>
        {#if playthrough}
          <MenuAction icon="clock" keepOpen={false} onclick={openProgress}>Update progress…</MenuAction>
          <MenuAction icon="check" keepOpen={false} onclick={() => update(playthrough!.status === 'completed' ? 'in-progress' : 'completed')}>
            {playthrough.status === 'completed' ? 'Mark unfinished' : 'Mark completed'}
          </MenuAction>
          {#if playthrough.status === 'in-progress'}<MenuAction icon="pause" keepOpen={false} onclick={() => update('paused')}>Pause playthrough</MenuAction>{/if}
          {#if playthrough.status !== 'dropped'}<MenuAction icon="close" keepOpen={false} onclick={() => update('dropped')}>Drop playthrough</MenuAction>{/if}
        {/if}
        {#if identity && data.sources.length}<MenuAction icon="refresh" keepOpen={false} onclick={refresh}>Refresh metadata</MenuAction>{/if}
      </ContextMenu>
    {:else}<Button href="/login" variant="hero">Sign in to track</Button>{/if}{/snippet}


  {#if failure && !startOpen && !progressOpen && !sessionOpen}<div class="notice error" role="alert">{failure}</div>{/if}
  {#if overview.length}<Shelf title="Overview" size="panel" artworkOptions={false} panels={overview} />{/if}
  <section class="section" aria-label="Playthroughs">
    <Heading title="Playthroughs">
      {#snippet filters()}{#if data.item.playthroughs.length}
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
      <Heading title="Play history" />
      {#if playthrough.sessions.length}<div class="overflow"><table class="table">
        <thead><tr><th scope="col">Date</th><th scope="col">Time played</th><th scope="col">Note</th></tr></thead>
        <tbody>{#each playthrough.sessions as session (session.id)}<tr><td>{new Date(session.playedAt).toLocaleString()}</td><td>{gameMinutes(session.minutesPlayed)}</td><td>{session.note || '—'}</td></tr>{/each}</tbody>
      </table></div>
      <Pagination page={playthrough.page} pages={playthrough.pages} pageUrl={(page) => selectedUrl(playthrough!.id, page)} label="Play history pages" />
      {:else}<EmptyState title="No play sessions yet" description="Log a session to record your time played." icon="clock" />{/if}
    {:else}<EmptyState title="Start your first playthrough" description="Track completion and log the time you spend playing." icon="library">
      <Button variant="secondary" icon="plus" onclick={() => openStart()}>Start playthrough</Button>
    </EmptyState>{/if}
  </section>
</MediaPage>
<Dialog bind:open={startOpen} title={repeat ? 'Start replaying' : 'Start a playthrough'}>
  <form class="stack" onsubmit={(event) => { event.preventDefault(); void start(); }}>
    {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}
    <label class="field">Platform<input bind:value={platform} maxlength="250" list="game-platforms" placeholder="Choose a platform" /></label>
    <datalist id="game-platforms">{#each data.item.platforms as entry}<option value={entry}></option>{/each}</datalist>
    <label class="check"><input type="checkbox" bind:checked={repeat} />This is a replay</label>
    <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Start playthrough'}</Button>
  </form>
</Dialog>
<Dialog bind:open={progressOpen} title="Update progress">
  <form class="stack" onsubmit={(event) => { event.preventDefault(); void update(status, percent); }}>
    {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}
    <label class="field">Completion percentage<input type="number" bind:value={percent} required min="0" max="100" step="0.1" /></label>
    <label class="field">Status<select bind:value={status}>{#each gameStatuses as entry}<option value={entry}>{displayLabel(entry)}</option>{/each}</select></label>
    <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save progress'}</Button>
  </form>
</Dialog>
<Dialog bind:open={sessionOpen} title="Log a play session">
  <form class="stack" onsubmit={(event) => { event.preventDefault(); void log(); }}>
    {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}
    <label class="field">Time played (minutes)<input type="number" bind:value={minutes} required min="1" max="1440" step="1" /></label>
    <label class="field">Played at<input type="datetime-local" bind:value={playedAt} required /></label>
    <label class="field">Note<textarea bind:value={note} maxlength="2000" rows="3"></textarea></label>
    <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save session'}</Button>
  </form>
</Dialog>
