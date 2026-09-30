<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { MediaCardPresentation } from '$lib/ui/types';
  import type { MusicItem } from '$lib/music/model';
  import type { GameStatus } from '$lib/games/model';
  import { api, message } from '$lib/ui/client';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  let { item }: { item: MediaCardPresentation } = $props();
  let menu = $state<ContextMenu>();
  let music = $state<MusicItem>();
  let playthrough = $state<{ id: string; status: GameStatus }>();
  let loading = $state(false),
    busy = $state(false),
    failure = $state('');
  let generation = 0;
  const storedGame = $derived(item.kind === 'game' && item.href === `/games/${item.id}`);
  const musicPath = $derived(
    item.connectionId ? `providers/${item.connectionId}/music/${item.id}` : ''
  );
  export function openAt(point: { x: number; y: number }) {
    menu?.openAt(point);
  }
  async function load() {
    const token = ++generation;
    loading = true;
    failure = '';
    music = undefined;
    playthrough = undefined;
    try {
      if (musicPath) {
        const result = await api<{ item: MusicItem }>(musicPath, undefined, 'GET');
        if (token === generation) music = result.item;
      } else if (storedGame) {
        const result = await api<{ playthroughs: { id: string; status: GameStatus }[] }>(
          `games/${item.id}`,
          undefined,
          'GET'
        );
        if (token === generation) playthrough = result.playthroughs[0];
      }
    } catch (cause) {
      if (token === generation) failure = message(cause);
    } finally {
      if (token === generation) loading = false;
    }
  }
  function gameAction(action: 'start' | 'progress' | 'log') {
    const params = new URLSearchParams({ action });
    if (action !== 'start' && playthrough) params.set('playthrough', playthrough.id);
    return `${item.href}?${params}`;
  }
  async function save(task: () => Promise<unknown>, label: string) {
    if (busy) return;
    busy = true;
    failure = '';
    try {
      await task();
      await load();
      await invalidateAll();
      notifyAction(label);
    } catch (cause) {
      failure = message(cause);
    } finally {
      busy = false;
    }
  }
  async function favourite() {
    if (!music || !musicPath) return;
    const value = !music.favourite;
    await save(
      () => api(`${musicPath}/favourite`, { favourite: value }),
      value ? 'Added to Jellyfin favourites.' : 'Removed from Jellyfin favourites.'
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
  {#if failure}<p class="menu-status notice error" role="alert">{failure}</p>
    <MenuAction icon="refresh" disabled={busy} onclick={load}>Try again</MenuAction>{/if}
</ContextMenu>

<style>
  .menu-status {
    max-width: 260px;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--muted);
  }
</style>
