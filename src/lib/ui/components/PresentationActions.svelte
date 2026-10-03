<script lang="ts">
  import { page } from '$app/state';
  import PlanAction from '$lib/experiments/PlanAction.svelte';
  import ShareAction from '$lib/sharing/ShareAction.svelte';
  import RowFeedback from './RowFeedback.svelte';
  import { createWorkActions } from '$lib/ui/controls/work.svelte';
  import { onDestroy } from 'svelte';
  import WorkActions from './WorkActions.svelte';
  import { relationshipControls, listMembershipControls } from '$lib/ui/controls/actions';
  import Button from '$lib/ui/components/Button.svelte';
  import { playMusic } from '$lib/playback/client.svelte';
  import type { MediaCardPresentation } from '$lib/ui/types';
  import type { MusicItem } from '$lib/music/model';
  import type { GameStatus } from '$lib/games/model';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import { createMutation } from '$lib/ui/mutation.svelte';
  import { type Relationship } from '$lib/ui/relationships';


  const { preview, api, change } = useClient();

  let { item }: { item: MediaCardPresentation } = $props();
  let menu = $state<Button>();
  let planningOpen=$state(false),sharingOpen=$state(false);
  let music = $state<MusicItem>();
  let playthrough = $state<{ id: string; status: GameStatus }>();
  const work = createWorkActions(() => workId);
  const relationships = $derived(work.relationships);
  const rating = $derived(work.data.rating), queued = $derived(work.data.queued);
  const lists = $derived(work.data.lists);
  let loading = $state(false);
  const mutation = createMutation(load);
  const busy = $derived(mutation.busy);
  const failure = $derived(mutation.error);
  let generation = 0;
  let controller: AbortController | undefined;
  onDestroy(() => { generation++; controller?.abort(); });
  const storedGame = $derived(item.kind === 'game' && item.href === `/games/${item.id}`);
  const workId = $derived(music?.workId ?? item.workId ?? (storedGame ? item.id : undefined));
  const musicPath = $derived(
    item.connectionId ? `providers/${item.connectionId}/music/${item.id}` : ''
  );
  const identity = $derived([item.id, item.workId, item.connectionId, item.href].join(':'));
  $effect(() => {
    identity;
    generation++;
    controller?.abort();
    reset();
    loading = false;
    mutation.error = '';
  });
  function reset() {
    music = undefined;
    playthrough = undefined;
    work.reset();
  }
  export function openAt(point: { x: number; y: number }) {
    menu?.openAt(point);
  }
  async function load() {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const token = ++generation;
    const path = musicPath, id = item.id, isGame = storedGame;
    const knownWorkId = item.workId ?? (isGame ? id : undefined);
    loading = true;
    mutation.error = '';
    reset();
    try {
      if (knownWorkId) await loadRelationships(knownWorkId, token);
      if (token !== generation) return;
      if (path) {
        const result = await api<{ item: MusicItem }>(path, undefined, 'GET', { signal });
        if (token !== generation) return;
        music = result.item;
        if (result.item.workId && result.item.workId !== knownWorkId)
          await loadRelationships(result.item.workId, token);
      } else if (isGame) {
        const result = await api<{ playthroughs: { id: string; status: GameStatus }[] }>(
          `games/${id}`,
          undefined,
          'GET', { signal }
        );
        if (token === generation) playthrough = result.playthroughs[0];
      }
    } catch (cause) {
      if (token === generation) mutation.error = message(cause);
    } finally {
      if (token === generation) loading = false;
    }
  }
  async function loadRelationships(id: string, token: number) {
    await work.load(id);
    if (token === generation && work.error) throw new Error(work.error);
  }
  async function toggleList(list:typeof lists[number]){await save(()=>list.entryId&&!list.playlist?change(`lists/${list.id}/items`,{entryId:list.entryId},'DELETE'):change(`lists/${list.id}/items`,{mediaId:workId}),'List updated.');}
  async function relationship(kind: Relationship) {
    if (!workId) return;
    const previous = kind === 'queued' ? queued : relationships[kind];
    await save(() => work.set(kind, !previous), kind === 'queued' ? 'Queue updated.'
      : previous ? 'Relationship removed. History is preserved.' : 'Saved to Collection.');
  }
  async function listen(){if(workId)await save(()=>change(`music/${workId}/log`,{batchId:crypto.randomUUID()}),'Listen logged.');}
  function gameAction(action: 'start' | 'progress' | 'log') {
    const params = new URLSearchParams({ action });
    if (action !== 'start' && playthrough) params.set('playthrough', playthrough.id);
    return `${item.href}?${params}`;
  }
  const save = mutation.run;
  async function favourite() {
    if (!music || !musicPath) return;
    const value = !music.favourite;
    await save(
      () => change(`${musicPath}/favourite`, { favourite: value }),
      value ? 'Added to favourites.' : 'Removed from favourites.'
    );
  }
  async function updateState(status: GameStatus) {
    if (!playthrough) return;
    const id = playthrough.id;
    await save(() => change(`game-playthroughs/${id}`, { status }, 'PATCH'), 'Playthrough updated.');
  }
</script>

<Button menu bind:this={menu} label={`Actions for ${item.title}`} hideTrigger onopen={load}>
  <Button item icon="arrow" href={item.href}
    >Open {item.kind === 'game' ? 'game' : item.kind}</Button>
  {#if item.recommendationIds?.length}<WorkActions section="recommendations" workId={workId??item.id} recommendationIds={item.recommendationIds} disabled={busy||loading} />{/if}
  {#if workId&&page.data.experiments?.planning}<Button item icon="list" onclick={()=>planningOpen=true}>Plan</Button>{/if}
  {#if workId&&page.data.playbackSharing&&item.kind==='track'}<Button item icon="friends" onclick={()=>sharingOpen=true}>Share</Button>{/if}
  {#if workId}<WorkActions section="social" {workId} disabled={busy||loading} />{/if}
  {#if storedGame}<Button item icon="plus" href={gameAction('start')}
      >Start {playthrough ? 'another ' : ''}playthrough…</Button>{/if}
  {#if loading}<p class="menu-status" role="status">Loading actions…</p>
  {:else if music}<Button item
      icon="heart"
      checked={music.favourite === true}
      disabled={busy}
      onclick={favourite}>{music.favourite ? 'Remove from' : 'Add to'} favourites</Button>
  {:else if playthrough}
    {#if ['planned', 'in-progress'].includes(playthrough.status)}<Button item
        icon="clock"
        href={gameAction('log')}>Log a play session…</Button>{/if}
    <Button item icon="clock" href={gameAction('progress')}>Update progress…</Button>
    <Button item
      icon="check"
      disabled={busy}
      onclick={() => updateState(playthrough!.status === 'completed' ? 'in-progress' : 'completed')}
      >{playthrough.status === 'completed' ? 'Mark unfinished' : 'Mark completed'}</Button>
    {#if playthrough.status === 'in-progress'}<Button item
        icon="pause"
        disabled={busy}
        onclick={() => updateState('paused')}>Pause playthrough</Button>{:else if ['paused', 'dropped'].includes(playthrough.status)}<Button item
        icon="play"
        disabled={busy}
        onclick={() => updateState('in-progress')}>Resume playthrough</Button>{/if}
    {#if playthrough.status !== 'dropped'}<Button item
        icon="close"
        disabled={busy}
        onclick={() => updateState('dropped')}>Drop playthrough</Button>{/if}
  {/if}
  {#if !loading && workId}
    <div class="menu-divider" role="separator"></div>
    {#if item.kind==='track'||item.kind==='album'}<Button item icon="play" disabled={busy || preview} onclick={()=>playMusic(workId!).catch(e=>mutation.error = message(e))}>Play</Button><Button item icon="clock" disabled={busy} onclick={listen}>Log {item.kind==='album'?'album':'listen'}</Button>{/if}
    <WorkActions section="relationships" workId={workId} controls={relationshipControls([
      { kind: 'collected', value: relationships.collected, icon: 'plus', label: `${relationships.collected ? 'Remove from' : 'Add to'} Collection` },
      { kind: 'watchlist', value: relationships.watchlist, icon: 'list', label: `${relationships.watchlist ? 'Remove from' : 'Save for'} later` },
      ...(storedGame || !music ? [{ kind: 'favourite' as const, value: relationships.favourite, icon: 'heart' as const, label: `${relationships.favourite ? 'Remove from' : 'Add to'} favourites` }] : []),
      { kind: 'queued', value: queued, icon: 'list', label: `${queued ? 'Remove from' : 'Add to'} queue` },
    ], relationship, busy)} />

    <WorkActions section="rating" {workId} {rating} onrated={value=>work.rate(value)}/>
    <Button menu label="Lists" icon="list" panel disabled={busy}>
      <WorkActions section="lists" workId={workId} controls={listMembershipControls(lists, list => !!list.entryId, toggleList, busy, "Append to", "list")}>{#snippet empty()}<Button item href="/lists">Create a list…</Button>{/snippet}</WorkActions>
    </Button>
  {/if}
  {#if failure}<RowFeedback error={failure} tag="p" class="menu-status notice error" />
    <Button item icon="refresh" disabled={busy} onclick={load}>Try again</Button>{/if}
</Button>

{#if workId&&page.data.experiments?.planning}<PlanAction bind:open={planningOpen} {workId} title={item.title} partyAllowed={page.data.experimentalFeatures&&item.kind==='track'}/>{/if}
{#if workId&&page.data.playbackSharing&&item.kind==='track'}<ShareAction bind:open={sharingOpen} {workId} title={item.title}/>{/if}

<style>
  :global(.menu-status) {
    max-width: 260px;
    padding: 8px 12px;
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>
