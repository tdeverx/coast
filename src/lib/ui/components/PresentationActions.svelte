<script lang="ts">
  import { playMusic } from '$lib/playback/client.svelte';
  import type { MediaCardPresentation } from '$lib/ui/types';
  import type { MusicItem } from '$lib/music/model';
  import type { GameStatus } from '$lib/games/model';
  import { api, message } from '$lib/ui/client';
  import { createMutation } from '$lib/ui/mutation.svelte';
  import { setRelationship, type Relationship } from '$lib/ui/relationships';
  import RelationshipActions from './RelationshipActions.svelte';
  import ListMembershipActions from './ListMembershipActions.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  import Rating from './Rating.svelte';
  let { item }: { item: MediaCardPresentation } = $props();
  let menu = $state<ContextMenu>();
  let music = $state<MusicItem>();
  let playthrough = $state<{ id: string; status: GameStatus }>();
  let relationships = $state({ collected: false, watchlist: false, favourite: false });
  let rating = $state<number | null>(null), queued = $state(false);
  let lists = $state<{ id: string; name: string; playlist: boolean; entryId: string | null }[]>([]);
  let loading = $state(false);
  const mutation = createMutation(load);
  const busy = $derived(mutation.busy);
  const failure = $derived(mutation.error);
  let generation = 0;
  const storedGame = $derived(item.kind === 'game' && item.href === `/games/${item.id}`);
  const workId = $derived(music?.workId ?? item.workId ?? (storedGame ? item.id : undefined));
  const musicPath = $derived(
    item.connectionId ? `providers/${item.connectionId}/music/${item.id}` : ''
  );
  const identity = $derived([item.id, item.workId, item.connectionId, item.href].join(':'));
  $effect(() => {
    identity;
    generation++;
    reset();
    loading = false;
    mutation.error = '';
  });
  function reset() {
    music = undefined;
    playthrough = undefined;
    relationships = { collected: false, watchlist: false, favourite: false };
    rating = null;
    queued = false;
    lists = [];
  }
  export function openAt(point: { x: number; y: number }) {
    menu?.openAt(point);
  }
  async function load() {
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
        const result = await api<{ item: MusicItem }>(path, undefined, 'GET');
        if (token !== generation) return;
        music = result.item;
        if (result.item.workId && result.item.workId !== knownWorkId)
          await loadRelationships(result.item.workId, token);
      } else if (isGame) {
        const result = await api<{ playthroughs: { id: string; status: GameStatus }[] }>(
          `games/${id}`,
          undefined,
          'GET'
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
    const result = await api<{
      reasons: { relationship: string; origin: string }[];
      rating: number | null;
      queued: boolean;
      lists: typeof lists;
    }>(`collection/${id}`, undefined, 'GET');
    if (token !== generation) return;
    const direct = new Set(result.reasons.filter(reason => reason.origin === 'direct').map(reason => reason.relationship));
    relationships = { collected: direct.has('collected'), watchlist: direct.has('watchlist'), favourite: direct.has('favourite') };
    rating = result.rating;
    queued = result.queued;
    lists = result.lists;
  }
  async function toggleList(list:typeof lists[number]){await save(()=>list.entryId&&!list.playlist?api(`lists/${list.id}/items`,{entryId:list.entryId},'DELETE'):api(`lists/${list.id}/items`,{mediaId:workId}),'List updated.');}
  async function relationship(kind: Relationship) {
    if (!workId) return;
    const id = workId;
    const previous = kind === 'queued' ? queued : relationships[kind];
    await save(() => setRelationship(id, kind, !previous), kind === 'queued' ? 'Queue updated.'
      : previous ? 'Relationship removed. History is preserved.' : 'Saved to Collection.');
  }
  async function listen(){if(workId)await save(()=>api(`music/${workId}/log`,{batchId:crypto.randomUUID()}),'Listen logged.');}
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
      () => api(`${musicPath}/favourite`, { favourite: value }),
      value ? 'Added to favourites.' : 'Removed from favourites.'
    );
  }
  async function updateState(status: GameStatus) {
    if (!playthrough) return;
    const id = playthrough.id;
    await save(() => api(`game-playthroughs/${id}`, { status }, 'PATCH'), 'Playthrough updated.');
  }
</script>

<ContextMenu bind:this={menu} label={`Actions for ${item.title}`} hideTrigger onopen={load}>
  <MenuAction icon="arrow" href={item.href}
    >Open {item.kind === 'game' ? 'game' : item.kind}</MenuAction
  >
  {#if storedGame}<MenuAction icon="plus" href={gameAction('start')}
      >Start {playthrough ? 'another ' : ''}playthrough…</MenuAction
    >{/if}
  {#if loading}<p class="menu-status" role="status">Loading actions…</p>
  {:else if music}<MenuAction
      icon="heart"
      checked={music.favourite === true}
      disabled={busy}
      onclick={favourite}>{music.favourite ? 'Remove from' : 'Add to'} favourites</MenuAction
    >
  {:else if playthrough}
    {#if ['planned', 'in-progress'].includes(playthrough.status)}<MenuAction
        icon="clock"
        href={gameAction('log')}>Log a play session…</MenuAction
      >{/if}
    <MenuAction icon="clock" href={gameAction('progress')}>Update progress…</MenuAction>
    <MenuAction
      icon="check"
      disabled={busy}
      onclick={() => updateState(playthrough!.status === 'completed' ? 'in-progress' : 'completed')}
      >{playthrough.status === 'completed' ? 'Mark unfinished' : 'Mark completed'}</MenuAction
    >
    {#if playthrough.status === 'in-progress'}<MenuAction
        icon="pause"
        disabled={busy}
        onclick={() => updateState('paused')}>Pause playthrough</MenuAction
      >{:else if ['paused', 'dropped'].includes(playthrough.status)}<MenuAction
        icon="play"
        disabled={busy}
        onclick={() => updateState('in-progress')}>Resume playthrough</MenuAction
      >{/if}
    {#if playthrough.status !== 'dropped'}<MenuAction
        icon="close"
        disabled={busy}
        onclick={() => updateState('dropped')}>Drop playthrough</MenuAction
      >{/if}
  {/if}
  {#if !loading && workId}
    <div class="menu-divider" role="separator"></div>
    {#if item.kind==='track'||item.kind==='album'}<MenuAction icon="play" disabled={busy} onclick={()=>playMusic(workId!).catch(e=>mutation.error = message(e))}>Play</MenuAction><MenuAction icon="clock" disabled={busy} onclick={listen}>Log {item.kind==='album'?'album':'listen'}</MenuAction>{/if}
    <RelationshipActions disabled={busy} onchange={relationship} items={[
      { kind: 'collected', value: relationships.collected, icon: 'plus', label: `${relationships.collected ? 'Remove from' : 'Add to'} Collection` },
      { kind: 'watchlist', value: relationships.watchlist, icon: 'list', label: `${relationships.watchlist ? 'Remove from' : 'Save for'} later` },
      ...(storedGame || !music ? [{ kind: 'favourite' as const, value: relationships.favourite, icon: 'heart' as const, label: `${relationships.favourite ? 'Remove from' : 'Add to'} favourites` }] : []),
      { kind: 'queued', value: queued, icon: 'list', label: `${queued ? 'Remove from' : 'Add to'} queue` },
    ]} />

    <Rating mediaId={workId} value={rating} menu onrated={value=>rating=value}/>
    <ContextMenu label="Lists" icon="list" panel disabled={busy}>
      <ListMembershipActions {lists} member={list => !!list.entryId} disabled={busy}
        playlistIcon="list" playlistLabel="Append to" onchange={toggleList}>
        {#snippet empty()}<MenuAction href="/lists">Create a list…</MenuAction>{/snippet}
      </ListMembershipActions>
    </ContextMenu>
  {/if}
  {#if failure}<p class="menu-status notice error" role="alert">{failure}</p>
    <MenuAction icon="refresh" disabled={busy} onclick={load}>Try again</MenuAction>{/if}
</ContextMenu>

<style>
  .menu-status {
    max-width: 260px;
    padding: 8px 12px;
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>
