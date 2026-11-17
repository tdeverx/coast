<script lang="ts">
  import { menuCondition, useMenuPreview } from '#lib/ui/controls/menu-preview.js';
  import { useRetention } from '#lib/ui/retention.js';
  import { reportFailure } from '#lib/ui/client-context.js';
  import { page } from '$app/state';
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import PlanAction from '#lib/experiments/PlanAction.svelte';
  import ShareAction from '#lib/sharing/ShareAction.svelte';
  import MetadataEditor from '../components/MetadataEditor.svelte';
  import ReadingLaunch from '#lib/reading/ReadingLaunch.svelte';
  import MusicCommands from './MusicCommands.svelte';
  import {detailHref} from '../pages/detail-rows';
  import GameCommands from './GameCommands.svelte';
  import ReadingCommands from './ReadingCommands.svelte';
  import WorkActions from '../components/WorkActions.svelte';
  import WorkListActions from '../components/WorkListActions.svelte';
  import Button from '../components/Button.svelte';
  import CheckInActions from '../components/CheckInActions.svelte';
  import { createWorkActions, workMenuScope } from '../controls/work.svelte';
  import { createMenuResource } from '../controls/menu-resource.svelte';
  import { retryMenuRead } from '../controls/menu-read-retry';
  import { displayLabel } from '../labels';
  import { relationshipControls } from '../controls/actions';
  import { playMusic, playMusicArtist } from '#lib/playback/client.svelte.js';
  import type { MediaCardPresentation } from '../types';
  import type { MusicItem } from '#lib/music/model.js';
  import type { GameStatus } from '#lib/games/model.js';
  import type { ReadingState } from '#lib/reading/model.js';
  import type { WorkList, GameActionState, ReadingActionState } from '#lib/media/work-actions.js';
  import { useClient } from '../client-context';
  import { createMutation } from '../mutation.svelte';
  import { createResource } from '../resource.svelte';
  import { createOperation } from '../operation.svelte';
  import type { Relationship } from '../relationships';

  let { item, showTrigger = false, hero = false, gameState, readingState, selectedPlaythrough, ongamecreated, onchanged, refreshGame, primary = false, entryActions }: {
    item: MediaCardPresentation; showTrigger?: boolean; hero?: boolean; primary?: boolean; gameState?: GameActionState;
    readingState?: ReadingActionState | null; selectedPlaythrough?: string; ongamecreated?: (id: string) => Promise<void>;
    onchanged?: () => void; refreshGame?: () => Promise<void>; entryActions?: Snippet;
  } = $props();
  const { preview, api, change } = useClient();
  const fixture = preview ? useMenuPreview() : undefined;
  const allowed = (id: Parameters<typeof menuCondition>[0], actual: boolean) => menuCondition(id, actual, preview, fixture);
  const playbackAllowed = $derived(allowed('playback', page.data.capabilities?.playback !== false));
  const socialAllowed = $derived(allowed('social', page.data.capabilities?.social !== false));
  const planningAllowed = $derived(allowed('planning', !!page.data.experiments?.planning));
  const readerAllowed = $derived(allowed('reader', page.data.capabilities?.reader !== false));
  let musicCommands = $state<MusicCommands>(), ratingActions=$state<WorkActions>();
  let menu = $state<Button>(), gameCommands = $state<GameCommands>(), readingCommands = $state<ReadingCommands>(), readingLaunch = $state<ReadingLaunch>();
  let editOpen = $state(false);
  let planningOpen = $state(false), sharingOpen = $state(false);
  const sourcePath = $derived(item.connectionId ? `providers/${item.connectionId}/music/${item.id}` : '');
  const identity = createMenuResource<MusicItem | null>(() => null, () => workMenuScope([item.id, item.workId, item.connectionId]),
    async signal => (await api<{ item: MusicItem }>(sourcePath, undefined, 'GET', { signal })).item);
  const workId = $derived(identity.data?.workId ?? item.workId);
  const activityHref=$derived(detailHref(workId?`/media/${workId}`:item.href,{section:'activity',relationship:'consumed'}));
  const reading = $derived(item.kind === 'book' || item.kind === 'comic');
  const music = $derived(item.kind === 'track' || item.kind === 'album');
  const artist = $derived(item.kind === 'artist');
  const canPlay = $derived(playbackAllowed
    && ((music || artist) && !!item.available));
  const canRead = $derived(reading && !!workId && !!item.available && readerAllowed);
  const canShare = $derived((item.kind === 'track' && !!item.available || reading && canRead)
    && allowed('sharing', !!page.data.playbackSharing));
  const canAdmin = $derived(allowed('admin', page.data.user?.role === 'admin'));
  const profileBackground = $derived(fixture?.profileBackground(workId,workId !== undefined && page.data.user?.settings?.profile?.backgroundMediaId === workId)
    ?? (workId !== undefined && page.data.user?.settings?.profile?.backgroundMediaId === workId));
  let chosenPlaythrough = $state<string>(), playthroughPage = $state(1);
  const activePlaythrough = $derived(chosenPlaythrough ?? selectedPlaythrough);
  const work = createWorkActions(() => workId, () => [item.kind, item.connectionId, item.listContext], () => activePlaythrough,
    () => mutation.busy || !!gameCommands?.isBusy() || !!readingCommands?.isBusy() || !!musicCommands?.isBusy() || !!ratingActions?.isBusy());
  const playthroughs = createMenuResource<{items:{id:string;platform:string|null;status:GameStatus;progressPercent:number;createdAt:string}[];hasMore:boolean}>(
    () => ({items:[],hasMore:false}),() => workMenuScope([workId,playthroughPage]),
    signal => api(`games/${workId}/playthroughs?page=${playthroughPage}`,undefined,'GET',{signal}),retryMenuRead);
  $effect(()=>{const scope=workMenuScope([workId,playthroughPage]);untrack(()=>{playthroughs.sync(scope);if(playthroughs.active)void playthroughs.load();});});
  onDestroy(playthroughs.dispose);
  const game = $derived(work.data.game ?? (chosenPlaythrough ? undefined : gameState));
  const progress = $derived(work.data.reading ?? readingState);
  const readingLabel = $derived(progress?.hasBookmark || !!progress?.page ? 'Continue reading' : 'Read');
  const relationships = $derived(work.relationships);
  const mutation = createMutation(async () => { await work.refresh(); onchanged?.(); }, useClient().feedback.notify, useRetention());
  const playback = createOperation(useRetention());
  const playIdentity = createResource<MusicItem | null>(null);
  let alive = true;
  onDestroy(() => { alive = false; playIdentity.dispose(); });
  const busy = $derived(mutation.busy || playback.busy || !!gameCommands?.isBusy() || !!readingCommands?.isBusy() || !!readingLaunch?.isBusy() || !!musicCommands?.isBusy());
  const error = $derived(mutation.error || work.error || identity.error || gameCommands?.failure() || readingCommands?.failure() || musicCommands?.failure());
  $effect(() => { const key = workMenuScope([item.id, item.workId, item.connectionId]); untrack(() => { key; identity.sync(key); }); });
  onDestroy(identity.dispose);
  function open() { if (workId) void work.open(); }
  function close() { work.close(); identity.close(); }
  async function resolve() {
    if (!sourcePath) return;
    await identity.load();
    if (workId) await work.load();
  }
  export function openAt(point: { x: number; y: number }) { menu?.openAt(point); }
  export async function start(shuffle = false) {
    if (preview || busy || !canPlay) return;
    const targetId = workId;
    const path = sourcePath, artistAction = artist;
    await playback.run(async () => {
      // Playback preparation owns provider identity resolution even after the menu closes.
      const resolved = !targetId && path ? await playIdentity.load(async signal =>
        (await api<{ item: MusicItem }>(path, undefined, 'GET', { signal })).item) : null;
      if (!alive) return false;
      const id = targetId ?? resolved?.workId;
      if (!id) throw new Error(playIdentity.error || 'This music is not available to play.');
      if (artistAction) await playMusicArtist(id, shuffle);
      else await playMusic(id, false, shuffle);
    });
  }

  export function gameAction(action: 'start' | 'progress' | 'log') { return gameCommands?.open(action); }
  export function updateGame(status: GameStatus) { return gameCommands?.update(status); }
  export function isBusy() { return busy; }
  export function startReading() { if (item.available && readerAllowed) return readingLaunch?.show(); }
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
  function toggleBackground() {
    const mediaId = workId, selected = profileBackground;
    if (!mediaId) return;
    void mutation.run(async () => {
      const result=await change('profile', { action: 'background', mediaId: selected ? null : mediaId });
      fixture?.setProfileBackground(selected ? null : mediaId);
      return result;
    },
      selected ? 'Profile background cleared.' : 'Profile background set.');
  }
  async function changed() { await work.refresh(); onchanged?.(); }

  reportFailure(()=>error);
  reportFailure(()=>playback.error);
  reportFailure(()=>playthroughs.error);
</script>

{#if primary && canPlay}<Button size="hero" icon="play" disabled={busy || preview} onclick={() => start()}>Play</Button>{:else if primary}<Button size="hero" icon="arrow" href={item.href}>View {item.kind}</Button>{/if}
<Button menu panel bind:this={menu} label={`Actions for ${item.title}`} hideTrigger={!showTrigger} upward={hero}
  triggerClass={hero ? 'icon-button hero-icon-action' : 'icon-button'}
  onopen={entryActions ? undefined : open} onclose={entryActions ? undefined : close}>
  {#if entryActions}
    {@render entryActions()}
    <div class="menu-divider" role="separator"></div>
    <Button menu label="Title actions" icon="more" panel onopen={open} onclose={close}>
      {@render titleActions()}
    </Button>
  {:else}
    {@render titleActions()}
  {/if}
</Button>

{#snippet titleActions()}
  {#if canPlay}
    {#if item.kind === 'track'}
      <Button item icon="play" disabled={busy} onclick={() => start()}>Play track</Button>
    {:else}
      <Button menu icon="play" panel label={`Play ${item.kind}`} disabled={busy} primaryAction={() => start()}>
        <Button item icon="play" onclick={() => start()}>Play {item.kind}</Button>
        <Button item icon="shuffle" onclick={() => start(true)}>Shuffle {item.kind}</Button>
      </Button>
    {/if}
  {:else if music || artist}
    <Button item icon="clock" disabled disabledReason="A connected playback source is required.">Playback unavailable</Button>
  {:else if reading}
    {#if canRead && (progress?.hasBookmark || !!progress?.page)}
      <Button menu label={readingLabel} icon="library" panel disabled={busy} primaryAction={startReading}>
        <Button item icon="library" onclick={startReading}>{readingLabel}</Button>
        <Button item icon="rewind" onclick={()=>readingLaunch?.show(true)}>Read from beginning</Button>
      </Button>
    {:else if canRead}<Button item icon="library" disabled={busy} onclick={startReading}>Read</Button>
    {:else}<Button item icon="clock" disabled disabledReason="A connected reading source is required.">File unavailable</Button>{/if}
  {/if}
  {#if !workId && sourcePath}<Button item icon="refresh" keepOpen disabled={identity.busy} onclick={resolve}>Prepare music actions</Button>{/if}
  {#if workId}
    {#if allowed('presence', page.data.capabilities?.presence !== false)}
      <CheckInActions {workId} kind={item.kind} active={work.data.activeCheckin} disabled={busy || work.busy} />
    {/if}
    {#if music || artist || reading}<div class="menu-divider" role="separator"></div>{/if}
    <WorkActions bind:this={ratingActions} section="rating" {workId} rating={work.data.rating} onrated={value => work.rate(value)} />
    <div class="menu-divider" role="separator"></div>
    {#if item.kind === 'game' && game?.playthrough}
      <Button menu icon="check" panel label="Mark as finished" disabled={busy || work.busy} primaryAction={() => gameCommands?.finish()}>
        <Button item icon="check" onclick={() => gameCommands?.finish()}>Now</Button>
        <Button item icon="calendar" onclick={() => gameCommands?.chooseFinishDate()}>Choose date…</Button>
      </Button>
    {:else if reading}
      <Button menu icon="check" panel label="Mark as read" disabled={busy || work.busy} primaryAction={() => readingCommands?.complete()}>
        <Button item icon="check" onclick={() => readingCommands?.complete()}>Now</Button>
        <Button item icon="calendar" onclick={() => readingCommands?.chooseDate('complete')}>Choose date…</Button>
      </Button>
      {#if progress?.rereadId}
        <Button menu icon="replay" panel label="Reread" disabled={busy}>
          <Button item icon="close" onclick={() => readingCommands?.endReread()}>End reread</Button>
        </Button>
      {:else if progress?.state === 'completed'}
        <Button menu icon="replay" panel label="Start reread" disabled={busy} primaryAction={() => readingCommands?.startReread()}>
          <Button item icon="replay" onclick={() => readingCommands?.startReread()}>Now</Button>
          <Button item icon="calendar" onclick={() => readingCommands?.chooseDate('reread')}>Choose date…</Button>
        </Button>
      {/if}
    {:else if music || artist}
      <Button menu label={item.kind === 'album' ? 'Log album' : 'Log listen'} icon="clock" panel disabled={busy} primaryAction={() => musicCommands?.log()}>
        <Button item icon="check" onclick={() => musicCommands?.log()}>Now</Button>
        <Button item icon="calendar" onclick={() => musicCommands?.showDate()}>Choose date…</Button>
      </Button>
    {/if}
    {#if item.kind === 'game'}
      <Button menu label="Playthrough" icon="play" panel disabled={busy} onopen={playthroughs.open} onclose={playthroughs.close}>
        {#each playthroughs.data.items as choice (choice.id)}
          <Button item selection="radio" checked={choice.id===(activePlaythrough??game?.playthrough?.id)} keepOpen
            disabled={busy||work.busy} onclick={()=>{chosenPlaythrough=choice.id;}}>
            <span class="menu-detail"><span>{choice.platform || 'Playthrough'}</span>
              <small>{displayLabel(choice.status)} · {choice.progressPercent}% · {new Date(choice.createdAt).toLocaleDateString()}</small></span>
          </Button>
        {/each}
        {#if playthroughs.busy}<div class="menu-label" role="status">Loading playthroughs…</div>{/if}
        {#if playthroughPage>1||playthroughs.data.hasMore}
          {#if playthroughPage>1}<Button item icon="left" keepOpen disabled={playthroughs.busy} onclick={()=>{playthroughPage-=1;}}>Previous playthroughs</Button>{/if}
          {#if playthroughs.data.hasMore}<Button item icon="right" keepOpen disabled={playthroughs.busy} onclick={()=>{playthroughPage+=1;}}>More playthroughs</Button>{/if}
        {/if}
        <div class="menu-divider" role="separator"></div>
        <Button item icon="plus" onclick={()=>gameAction('start')}>Start {game?.playthrough?'another ':''}playthrough…</Button>
        {#if game?.playthrough && ['planned','in-progress'].includes(game.playthrough.status)}
          <Button item icon="clock" onclick={()=>gameAction('log')}>Log a play session…</Button>
        {/if}
      </Button>
    {/if}
    {#if socialAllowed}<WorkActions section="reaction" {workId} disabled={busy} />{/if}
    <Button menu label="Manage" icon="sliders" panel disabled={busy || work.busy}>
      <Button menu label="Tracking" icon="checklist" panel>
        {#if item.kind === 'game' && game?.playthrough}
          {@const state = game.playthrough.status}
          <Button item icon="clock" onclick={() => gameAction('progress')}>Update progress…</Button>
          {#if state === 'in-progress'}
            <Button item icon="pause" onclick={() => updateGame('paused')}>Pause playthrough</Button>
          {:else if state === 'paused'}
            <Button item icon="play" onclick={() => updateGame('in-progress')}>Resume playthrough</Button>
          {/if}
          <Button item icon="list" onclick={() => updateGame(state === 'dropped' ? 'in-progress' : 'dropped')}>
            {state === 'dropped' ? 'Show playthrough in Progress' : 'Hide playthrough from Progress'}
          </Button>
          <div class="menu-divider" role="separator"></div>
        {:else if reading}
          <Button item icon="clock" onclick={editReading}>Update progress…</Button>
          {#if progress?.state === 'reading' || progress?.state === 'paused'}
            <Button item icon={progress.state === 'paused' ? 'play' : 'pause'} onclick={() => setReading(progress?.state === 'paused' ? 'reading' : 'paused')}>
              {progress.state === 'paused' ? 'Resume tracking' : 'Pause tracking'}
            </Button>
          {/if}
          {#if progress}
            <Button item icon="list" onclick={() => setReading(progress?.state === 'dropped' ? 'reading' : 'dropped')}>
              {progress.state === 'dropped' ? 'Show in Progress' : 'Hide from Progress'}
            </Button>
          {/if}
        {/if}
        {#if !reading}<Button item icon="list" onclick={() => relationship('queued')}>{work.data.queued ? 'Remove from queue' : 'Add to queue'}</Button>{/if}
      </Button>
      <Button menu label="History" icon="history" panel>
        {#if music || artist}<Button item icon="history" onclick={()=>musicCommands?.showHistory()}>View history</Button>
        {:else if reading}<Button item icon="history" onclick={()=>readingCommands?.showHistory()}>View history</Button>
        {:else if item.kind==='game'}<Button item icon="history" disabled={!game?.playthrough||work.busy} onclick={()=>gameCommands?.showHistory()}>View history</Button>
        {:else}<Button item icon="history" href={activityHref}>View history</Button>{/if}
        {#if item.kind==='track'}
          <Button item icon="rewind" onclick={()=>musicCommands?.resetPosition()}>Reset playback position…</Button>
        {/if}
        {#if reading}
          <div class="menu-divider" role="separator"></div>
          <Button item icon="refresh" disabled={busy || !progress} onclick={() => readingCommands?.reset('unread')}>Mark unread…</Button>
          <Button item icon="rewind" disabled={busy || !progress} onclick={() => readingCommands?.reset('position')}>Reset reading position…</Button>
        {/if}
        {#if item.kind === 'game' && game?.playthrough?.status === 'completed'}
          <div class="menu-divider" role="separator"></div>
          <Button item icon="refresh" onclick={() => updateGame('in-progress')}>Mark unfinished</Button>
        {/if}
      </Button>
      <div class="menu-divider" role="separator"></div>
      <WorkListActions {workId} {reading} disabled={busy} select={toggleList} />
    </Button>
    <div class="menu-divider" role="separator"></div>
    <WorkActions section="quick" {workId} controls={[
      ...relationshipControls([
        { kind: 'watchlist', value: relationships.watchlist, icon: 'bookmark', label: `${relationships.watchlist ? 'Remove from' : 'Add to'} Watchlist` },
        { kind: 'collected', value: relationships.collected, icon: 'collection', label: `${relationships.collected ? 'Remove from' : 'Add to'} Collection` },
        { kind: 'favourite', value: relationships.favourite, icon: 'heart', label: `${relationships.favourite ? 'Remove from' : 'Add to'} Favourites` },
      ], relationship, busy || work.busy || !!work.error),
      { item: true, icon: 'image', checked: profileBackground, text: profileBackground ? 'Clear profile background' : 'Set as profile background',
        disabled: busy, onclick: toggleBackground },
    ]} />
    {#if canShare || socialAllowed || planningAllowed || canAdmin}
      <div class="menu-divider" role="separator"></div>
      {#if canShare || socialAllowed || planningAllowed}
        <Button menu label="Share" icon="share" panel disabled={busy}>
          {#if canShare}
            <Button item icon="link" onclick={() => { sharingOpen = true; }}>
              <span class="menu-detail"><span>Create disposable link…</span><small>No sign-in · expires</small></span>
            </Button>
            {#if socialAllowed || planningAllowed}<div class="menu-divider" role="separator"></div>{/if}
          {/if}
          {#if socialAllowed}<WorkActions section="recommend" {workId} disabled={busy} />{/if}
          {#if planningAllowed}
            <Button item icon="calendar" onclick={() => { planningOpen = true; }}>Plan to {reading ? 'read' : music || artist ? 'listen' : 'play'}…</Button>
          {/if}
        </Button>
      {/if}
      {#if canAdmin}
        <Button menu label="Admin" icon="shield" panel disabled={busy}>
          {#if refreshGame}<Button item icon="refresh" onclick={() => mutation.run(refreshGame!, 'Metadata refreshed.')}>Refresh metadata</Button>{/if}
          <Button item icon="settings" onclick={() => { editOpen = true; }}>Edit metadata…</Button>
        </Button>
      {/if}
    {/if}
  {/if}
  {#if work.busy}<div class="menu-label" role="status">Loading actions…</div>{/if}
{/snippet}

{#if workId && item.kind === 'game'}<GameCommands bind:this={gameCommands} {workId} gameData={game} ensure={() => work.load()} {changed} created={async id=>{chosenPlaythrough=id;await ongamecreated?.(id);}} />{/if}
{#if workId && reading}<ReadingCommands bind:this={readingCommands} {workId} progress={progress} ensure={() => work.load()} {changed} /><ReadingLaunch bind:this={readingLaunch} {workId} hideTrigger />{/if}
{#if workId && planningAllowed}<PlanAction bind:open={planningOpen} {workId} title={item.title} partyAllowed={page.data.experimentalParties && item.kind === 'track'} />{/if}
{#if workId && allowed('sharing', !!page.data.playbackSharing) && (item.kind === 'track' || reading)}<ShareAction bind:open={sharingOpen} {workId} title={item.title} {reading} allowProgressTracking={false} />{/if}



{#if workId}<MetadataEditor mediaId={workId} admin bind:open={editOpen} />{/if}

{#if workId && (music || artist)}<MusicCommands bind:this={musicCommands} {workId} {artist} album={item.kind === 'album'} {changed} />{/if}

<style>
  .menu-detail { display: grid; }
  .menu-detail small { color: var(--muted); font-weight: var(--weight-regular); }
</style>
