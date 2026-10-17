<script lang="ts">
  import { reportFailure } from '$lib/ui/client-context';
  import { page } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import PlanAction from '$lib/experiments/PlanAction.svelte';
  import ShareAction from '$lib/sharing/ShareAction.svelte';
  import MetadataEditor from '../components/MetadataEditor.svelte';
  import ReadingLaunch from '$lib/reading/ReadingLaunch.svelte';
  import MusicCommands from './MusicCommands.svelte';
  import GameCommands from './GameCommands.svelte';
  import ReadingCommands from './ReadingCommands.svelte';
  import WorkActions from '../components/WorkActions.svelte';
  import WorkListActions from '../components/WorkListActions.svelte';
  import Button from '../components/Button.svelte';
  import Dialog from '../components/Dialog.svelte';
  import { createWorkActions, workMenuScope } from '../controls/work.svelte';
  import { createMenuResource } from '../controls/menu-resource.svelte';
  import { relationshipControls } from '../controls/actions';
  import { playMusic } from '$lib/playback/client.svelte';
  import type { MediaCardPresentation } from '../types';
  import type { MusicItem } from '$lib/music/model';
  import type { GameStatus } from '$lib/games/model';
  import type { ReadingState } from '$lib/reading/model';
  import type { WorkList, GameActionState, ReadingActionState } from '$lib/media/work-actions';
  import { useClient } from '../client-context';
  import { createMutation } from '../mutation.svelte';
  import { createResource } from '../resource.svelte';
  import { createOperation } from '../operation.svelte';
  import type { Relationship } from '../relationships';

  let { item, showTrigger = false, hero = false, gameState, readingState, selectedPlaythrough, ongamecreated, onchanged, refreshGame, primary = false }: {
    item: MediaCardPresentation; showTrigger?: boolean; hero?: boolean; primary?: boolean; gameState?: GameActionState;
    readingState?: ReadingActionState | null; selectedPlaythrough?: string; ongamecreated?: (id: string) => Promise<void>;
    onchanged?: () => void; refreshGame?: () => Promise<void>;
  } = $props();
  const { preview, api, change } = useClient();
  let musicCommands = $state<MusicCommands>();
  let menu = $state<Button>(), gameCommands = $state<GameCommands>(), readingCommands = $state<ReadingCommands>(), readingLaunch = $state<ReadingLaunch>();
  let editOpen = $state(false);
  let planningOpen = $state(false), sharingOpen = $state(false), playbackErrorOpen = $state(false), removeOpen = $state(false);
  let artistFavourite = $state<boolean | undefined>();
  let removal = $state<{ listId: string; entryId: string }>();
  const sourcePath = $derived(item.connectionId ? `providers/${item.connectionId}/music/${item.id}` : '');
  const identity = createMenuResource<MusicItem | null>(() => null, () => workMenuScope([item.id, item.workId, item.connectionId]),
    async signal => (await api<{ item: MusicItem }>(sourcePath, undefined, 'GET', { signal })).item);
  const workId = $derived(identity.data?.workId ?? item.workId);
  const reading = $derived(item.kind === 'book' || item.kind === 'comic');
  const music = $derived(item.kind === 'track' || item.kind === 'album');
  const work = createWorkActions(() => workId, () => [item.kind, item.connectionId, item.listContext], () => selectedPlaythrough, () => mutation.busy);
  const game = $derived(work.data.game ?? gameState);
  const progress = $derived(work.data.reading ?? readingState);
  const relationships = $derived(work.relationships);
  const mutation = createMutation(async () => { await work.refresh(); onchanged?.(); }, useClient().feedback.notify);
  const playback = createOperation();
  const playIdentity = createResource<MusicItem | null>(null);
  let alive = true;
  onDestroy(() => { alive = false; playIdentity.dispose(); });
  const busy = $derived(mutation.busy || playback.busy || !!gameCommands?.isBusy() || !!readingCommands?.isBusy() || !!musicCommands?.isBusy());
  const error = $derived(mutation.error || work.error || identity.error || gameCommands?.failure() || readingCommands?.failure() || musicCommands?.failure());
  $effect(() => { const key = workMenuScope([item.id, item.workId, item.connectionId]); untrack(() => { key; identity.sync(); }); });
  onDestroy(identity.dispose);
  function open() { if (workId) void work.open(); }
  function close() { work.close(); identity.close(); }
  async function resolve() {
    if (!sourcePath) return;
    await identity.load();
    if (workId) await work.load();
  }
  export function openAt(point: { x: number; y: number }) { menu?.openAt(point); }
  export async function start(continuing = false) {
    if (preview || busy || !music || page.data.capabilities?.playback===false) return;
    const targetId = workId, path = sourcePath;
    const played = await playback.run(async () => {
      // Playback owns this read independently of the transient menu.
      const resolved = !targetId && path ? await playIdentity.load(async signal =>
        (await api<{ item: MusicItem }>(path, undefined, 'GET', { signal })).item) : null;
      if (!alive) return false;
      const id = targetId ?? resolved?.workId;
      if (!id) throw new Error(playIdentity.error || 'This music is not available to play.');
      await playMusic(id, continuing);
    });
    if (!played && alive) playbackErrorOpen = true;
  }

  export function gameAction(action: 'start' | 'progress' | 'log') { return gameCommands?.open(action); }
  export function updateGame(status: GameStatus) { return gameCommands?.update(status); }
  export function isBusy() { return busy; }
  export function startReading() { return readingLaunch?.show(); }
  export function editReading() { return readingCommands?.edit(); }
  export function setReading(state: ReadingState, restart = false) { return readingCommands?.setState(state, restart); }
  async function relationship(kind: Relationship) {
    const previous = kind === 'queued' ? work.data.queued : relationships[kind];
    await mutation.run(() => work.set(kind, !previous), previous ? 'Relationship removed. History is preserved.' : 'Saved to Collection.');
  }
  async function toggleList(list: WorkList) {
    const id = workId;
    await mutation.run(() => list.entries.length && !list.playlist
      ? change(`lists/${list.id}/items`, { entryId: list.entries[0].id }, 'DELETE')
      : change(`lists/${list.id}/items`, { mediaId: id }), 'List updated.');
  }
  async function move(direction: number) {
    const entry = item.listContext;
    if (entry) await mutation.run(() => change(`lists/${entry.listId}/move`, { entryId: entry.entryId, direction }), 'Entry moved.');
  }
  async function remove() {
    const entry = removal;
    if (entry && await mutation.run(() => change(`lists/${entry.listId}/items`, { entryId: entry.entryId }, 'DELETE'), 'Entry removed.')) removeOpen = false;
  }
  async function favouriteArtist() {
    if (!sourcePath) return;
    const value = !(artistFavourite ?? item.favourite);
    if (await mutation.run(() => change(`${sourcePath}/favourite`, { favourite: value }), value ? 'Added to favourites.' : 'Removed from favourites.')) artistFavourite = value;
  }
  async function changed() { await work.refresh(); onchanged?.(); }

  reportFailure(()=>error);
</script>

{#if primary && music && page.data.capabilities?.playback!==false}<Button size="hero" icon="play" disabled={busy || preview} onclick={() => start()}>Play</Button>{:else if primary}<Button size="hero" icon="arrow" href={item.href}>View {item.kind}</Button>{/if}
<Button menu panel bind:this={menu} label={`Actions for ${item.title}`} hideTrigger={!showTrigger} upward={hero} triggerClass={hero ? 'icon-button hero-icon-action' : 'icon-button'} onopen={open} onclose={close}>
  {#if music && page.data.capabilities?.playback!==false}<Button item icon="play" disabled={busy || preview} onclick={() => start()}>Play</Button>
    {#if item.kind === 'album' || item.trackingProgress?.value}<Button item icon="play" disabled={busy || preview} onclick={() => start(true)}>Continue</Button>{/if}{/if}
  {#if reading && workId && page.data.capabilities?.reader!==false}<Button item icon="library" disabled={busy} onclick={() => readingLaunch?.show()}>Read</Button>{/if}
  <Button item icon="arrow" href={item.href}>Open {item.kind === 'game' ? 'game' : item.kind}</Button>
  {#if !workId && sourcePath && item.kind !== 'artist'}<Button item icon="refresh" keepOpen disabled={identity.busy} onclick={resolve}>Prepare music actions</Button>{/if}
  {#if item.kind === 'artist' && sourcePath}<Button item icon="heart" checked={artistFavourite ?? item.favourite ?? false} disabled={busy} onclick={favouriteArtist}>{(artistFavourite ?? item.favourite) ? 'Remove from' : 'Add to'} favourites</Button>{/if}
  {#if workId}
    {#if page.data.experiments?.planning}<Button item icon="list" onclick={() => planningOpen = true}>Plan</Button>{/if}
    {#if page.data.playbackSharing && item.kind === 'track'}<Button item icon="friends" onclick={() => sharingOpen = true}>Share</Button>{/if}
    {#if item.recommendationIds?.length}<WorkActions section="recommendations" {workId} recommendationIds={item.recommendationIds} disabled={busy} />{/if}
    <WorkActions section="social" {workId} disabled={busy} />
    <div class="menu-divider" role="separator"></div>
    {#if item.kind === 'game'}
      <Button menu label={selectedPlaythrough ? 'Playthrough' : game?.playthrough ? 'Latest playthrough' : 'Playthrough'} icon="play" panel disabled={busy || work.busy}>
        {#if game?.playthrough && !selectedPlaythrough}<Button item icon="list" href={item.href}>Choose a playthrough…</Button>{/if}
        <Button item icon="plus" onclick={() => gameAction('start')}>Start {game?.playthrough ? 'another ' : ''}playthrough…</Button>
        {#if game?.playthrough}
          {#if ['planned', 'in-progress'].includes(game.playthrough.status)}<Button item icon="clock" onclick={() => gameAction('log')}>Log a play session…</Button>{/if}
          <Button item icon="clock" onclick={() => gameAction('progress')}>Update progress…</Button>
          <Button item icon="check" onclick={() => updateGame(game!.playthrough!.status === 'completed' ? 'in-progress' : 'completed')}>{game.playthrough.status === 'completed' ? 'Mark unfinished' : 'Mark completed'}</Button>
          {#if game.playthrough.status === 'in-progress'}<Button item icon="pause" onclick={() => updateGame('paused')}>Pause playthrough</Button>{:else if ['paused', 'dropped'].includes(game.playthrough.status)}<Button item icon="play" onclick={() => updateGame('in-progress')}>Resume playthrough</Button>{/if}
          {#if game.playthrough.status !== 'dropped'}<Button item icon="close" onclick={() => updateGame('dropped')}>Drop playthrough</Button>{/if}
        {/if}
      </Button>
      <Button item icon="clock" href={`${item.href}#play-history`}>View history</Button>
    {:else if reading}
      <Button menu label="Reading" icon="library" panel disabled={busy || work.busy}>
        <Button item icon="clock" onclick={editReading}>Update progress…</Button>
        <Button item icon="check" onclick={() => setReading(progress?.state === 'completed' ? 'reading' : 'completed')}>{progress?.state === 'completed' ? 'Mark unfinished' : 'Mark completed'}</Button>
        {#if progress?.state === 'completed'}<Button item icon="refresh" onclick={() => setReading('reading', true)}>Reread</Button>{/if}
        {#if progress?.state === 'reading'}<Button item icon="pause" onclick={() => setReading('paused')}>Pause tracking</Button>{:else if progress && ['paused','dropped'].includes(progress.state)}<Button item icon="play" onclick={() => setReading('reading')}>Resume tracking</Button>{/if}
        {#if progress?.state !== 'dropped'}<Button item icon="close" onclick={() => setReading('dropped')}>Drop reading</Button>{/if}
      </Button>
      <Button item icon="clock" href={`${item.href}#reading-history`}>View history</Button>
    {:else if music}<Button menu label={item.kind === 'album' ? 'Log album' : 'Log listen'} icon="clock" panel disabled={busy}>
      <Button item icon="check" onclick={() => musicCommands?.log()}>Right now</Button>
      <Button item icon="clock" onclick={() => musicCommands?.showDate()}>Choose date…</Button>
    </Button><Button item icon="clock" onclick={() => musicCommands?.showHistory()}>View history</Button>{/if}
    <WorkActions section="rating" {workId} rating={work.data.rating} onrated={value => work.rate(value)} />
    <div class="menu-divider" role="separator"></div>
    <WorkActions section="relationships" {workId} controls={relationshipControls([
      { kind: 'watchlist', value: relationships.watchlist, icon: 'bookmark', label: `${relationships.watchlist ? 'Remove from' : 'Add to'} Watchlist`, showCheckmark: false },
      { kind: 'collected', value: relationships.collected, icon: 'plus', label: `${relationships.collected ? 'Remove from' : 'Add to'} Collection` },
      { kind: 'favourite', value: relationships.favourite, icon: 'heart', label: `${relationships.favourite ? 'Remove from' : 'Add to'} Favourites`, showCheckmark: false },
      ...(!reading ? [{ kind: 'queued' as const, value: work.data.queued, icon: 'list' as const, label: `${work.data.queued ? 'Remove from' : 'Add to'} queue` }] : []),
    ], relationship, busy || work.busy || !!work.error)} />
    <WorkListActions {workId} {reading} disabled={busy} select={toggleList}>
      {#if item.listContext}<div class="menu-divider" role="separator"></div>
        <Button menu label="This list entry" icon="list" panel>
          <Button item icon="left" disabled={busy} onclick={() => move(-1)}>Move this entry earlier</Button>
          <Button item icon="right" disabled={busy} onclick={() => move(1)}>Move this entry later</Button>
          <Button item icon="close" danger disabled={busy} onclick={() => { removal = { ...item.listContext! }; removeOpen = true; }}>Remove from this list…</Button>
        </Button>
      {/if}
    </WorkListActions>
    <div class="menu-divider" role="separator"></div>
    <Button menu label="Personalise" icon="film" panel>
      <Button item icon="film" onclick={() => editOpen = true}>Change artwork or title…</Button>
    </Button>
    {#if refreshGame}<div class="menu-divider" role="separator"></div><Button item icon="refresh" disabled={busy} onclick={() => mutation.run(refreshGame!, 'Metadata refreshed.')}>Refresh metadata</Button>{/if}
  {/if}
  {#if work.busy}<div class="menu-label" role="status">Loading actions…</div>{/if}
  {#if error}<Button item keepOpen icon="refresh" disabled={busy} onclick={() => workId ? work.load(true) : identity.load(true)}>Retry</Button>{/if}
</Button>

{#if workId && item.kind === 'game'}<GameCommands bind:this={gameCommands} {workId} gameData={game} ensure={() => work.load()} {changed} created={ongamecreated} />{/if}
{#if workId && reading}<ReadingCommands bind:this={readingCommands} {workId} progress={progress} ensure={() => work.load()} {changed} /><ReadingLaunch bind:this={readingLaunch} {workId} title={item.title} hideTrigger />{/if}
{#if workId && page.data.experiments?.planning}<PlanAction bind:open={planningOpen} {workId} title={item.title} partyAllowed={page.data.experimentalParties && item.kind === 'track'} />{/if}
{#if workId && page.data.playbackSharing && item.kind === 'track'}<ShareAction bind:open={sharingOpen} {workId} title={item.title} />{/if}
<Dialog bind:open={playbackErrorOpen} title="Playback unavailable"><p>{playback.error}</p></Dialog>
<Dialog bind:open={removeOpen} title="Remove this entry?" message="Only this occurrence will be removed. Your history is kept.">
  {#snippet footer()}<Button danger disabled={busy} onclick={remove}>Remove</Button><Button onclick={() => removeOpen = false}>Cancel</Button>{/snippet}
</Dialog>

{#if workId}<MetadataEditor mediaId={workId} bind:open={editOpen} />{/if}

{#if workId && music}<MusicCommands bind:this={musicCommands} {workId} album={item.kind === 'album'} {changed} />{/if}
