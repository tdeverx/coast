<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import ScreenActions from '../work-menu/ScreenActions.svelte';
  import CatalogueActions from '../work-menu/CatalogueActions.svelte';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import { useClient, reportFailure } from '#lib/ui/client-context.js';
  import { createOperation } from '#lib/ui/operation.svelte.js';
  import { useRetention } from '#lib/ui/retention.js';
  import type { MediaView, MediaCardPresentation } from '../types';
  import { isScreenWork } from '#lib/media/model.js';
  import type { GameActionState, ReadingActionState } from '#lib/media/work-actions.js';
  import type { GameStatus } from '#lib/games/model.js';
  let { item, context = 'details', next = null, requestable = false, hero = false,
    menuOnly = false, showTrigger = false, gameState, readingState,
    editionName,selectedPlaythrough, ongamecreated, onchanged, refreshGame }: {
    editionName?:string;item: MediaView | MediaCardPresentation; context?: 'discover' | 'details' | 'home';
    next?: MediaView | null; requestable?: boolean; hero?: boolean; menuOnly?: boolean;
    showTrigger?: boolean; gameState?: GameActionState; readingState?: ReadingActionState | null;
    selectedPlaythrough?: string; ongamecreated?: (id: string) => Promise<void>;
    onchanged?: () => void; refreshGame?: () => Promise<void>;
  } = $props();
  let screen = $state<ScreenActions>(), catalogue = $state<CatalogueActions>();
  const readOnly = getContext<() => boolean>('profile-read-only') ?? (() => false);
  const { change, feedback } = useClient();
  const entryOperation = createOperation(useRetention());
  const entry = $derived(menuOnly ? item.listContext : undefined);
  let removal = $state<NonNullable<MediaView['listContext']>>();
  reportFailure(() => entryOperation.error);

  async function moveEntry(direction: -1 | 1) {
    const target = entry;
    if (!target) return;
    await entryOperation.run(async () => {
      await change(`lists/${target.listId}/move`, { entryId: target.entryId, direction });
      feedback.notify('Entry moved.');
    });
  }

  async function removeEntry() {
    const target = removal;
    if (!target || target.listId !== entry?.listId || target.entryId !== entry.entryId) return;
    if (await entryOperation.run(async () => {
      await change(`lists/${target.listId}/items`, { entryId: target.entryId }, 'DELETE');
      feedback.notify('Entry removed.');
    })) removal = undefined;
  }

  const identity = $derived(JSON.stringify([page.data.user?.id, item.kind, isScreenWork(item) ? item.id : item.workId, item.id,
    'connectionId' in item ? item.connectionId : undefined, item.listContext]));
  export function openAt(point: { x: number; y: number }) { if (isScreenWork(item)) screen?.openAt(point); else catalogue?.openAt(point); }
  export async function start() { if (isScreenWork(item)) await screen?.start(); else await catalogue?.start(); }
  export function request() { screen?.request(); }
  export function gameAction(action: 'start' | 'progress' | 'log') { return catalogue?.gameAction(action); }
  export function updateGame(status: GameStatus) { return catalogue?.updateGame(status); }
  export function isBusy() { return catalogue?.isBusy() ?? false; }
  export function startReading() { return catalogue?.startReading(); }
  export function editReading() { return catalogue?.editReading(); }
  export function setReading(state: import('#lib/reading/model.js').ReadingState, restart = false) { return catalogue?.setReading(state, restart); }
</script>
{#key identity}
  {#if !page.data.user || readOnly()}<Button href={isScreenWork(item) ? `/media/${item.id}` : item.href} size={hero ? 'hero' : undefined}>{isScreenWork(item) ? 'Learn more' : `Open ${item.kind}`}</Button>
  {:else if isScreenWork(item)}<ScreenActions entryActions={entry ? entryMenu : undefined} bind:this={screen} {editionName} {item} {context} {next} {requestable} {hero} {menuOnly} {showTrigger} />
  {:else}<CatalogueActions entryActions={entry ? entryMenu : undefined} bind:this={catalogue} {item} {hero} {gameState} {readingState} {selectedPlaythrough} {ongamecreated} {onchanged} {refreshGame} primary={hero && !menuOnly} {showTrigger} />{/if}
  {#if entry}
    <Dialog open={!!removal} onclose={() => { removal = undefined; }} title="Remove this entry?"
      message="Only this occurrence will be removed. Other entries and your history are kept.">
      {#snippet footer()}
        <Button disabled={entryOperation.busy} onclick={() => { removal = undefined; }}>Cancel</Button>
        <Button danger disabled={entryOperation.busy} onclick={removeEntry}>Remove entry</Button>
      {/snippet}
    </Dialog>
  {/if}
{/key}

{#snippet entryMenu()}
  <Button item icon="left" keepOpen disabled={entryOperation.busy} onclick={() => moveEntry(-1)}>Move earlier</Button>
  <Button item icon="right" keepOpen disabled={entryOperation.busy} onclick={() => moveEntry(1)}>Move later</Button>
  <div class="menu-divider" role="separator"></div>
  <Button item icon="close" danger disabled={entryOperation.busy} onclick={() => { removal = entry; }}>Remove entry…</Button>
{/snippet}
