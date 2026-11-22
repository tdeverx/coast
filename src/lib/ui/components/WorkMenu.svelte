<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import ScreenActions from '../work-menu/ScreenActions.svelte';
  import CatalogueActions from '../work-menu/CatalogueActions.svelte';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import TasteMatch from '#lib/profile/TasteMatch.svelte';
  import { canShowTaste, detailTaste, readingVolumeId } from '../pages/detail';
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
  let volumeMenu = $state<Button>();
  const volume = $derived('href' in item && readingVolumeId(item) ? item : undefined);
  const readOnly = getContext<() => boolean>('profile-read-only') ?? (() => false);
  const { change, feedback, preview } = useClient();
  const entryOperation = createOperation(useRetention());
  const entry = $derived(menuOnly ? item.listContext : undefined);
  let removal = $state<NonNullable<MediaView['listContext']>>();
  let taste = $state<(NonNullable<ReturnType<typeof detailTaste>> & { rating?: number | null; scope: string })>();
  const canCalculateTaste = $derived(page.data.user?.role === 'admin' && canShowTaste(item, page.data.capabilities));
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
  $effect(() => {
    if (taste && (taste.scope !== identity || !canCalculateTaste || readOnly())) taste = undefined;
  });
  export function openAt(point: { x: number; y: number }) { if (volume) volumeMenu?.openAt(point); else if (isScreenWork(item)) screen?.openAt(point); else catalogue?.openAt(point); }
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
  {#if !page.data.user || readOnly()}<Button href={'href' in item ? item.href : `/media/${item.id}`} size={hero ? 'hero' : undefined}>{isScreenWork(item) ? 'Learn more' : `Open ${item.kind}`}</Button>
  {:else if volume}
    <Button menu panel bind:this={volumeMenu} hideTrigger={menuOnly && !showTrigger} upward={hero} align="start"
      label={`Actions for ${item.title}`} triggerClass={hero ? 'icon-button hero-icon-action' : 'icon-button'}>
      {#if entry}{@render entryMenu()}<div class="menu-divider" role="separator"></div>{/if}
      <Button item icon="list" href={`${volume.href}?section=issues`}>View issues</Button>
      {#if page.data.capabilities.social}<Button item icon="history" href={`${volume.href}?section=activity&relationship=consumed`}>View history</Button>{/if}
      {#if canCalculateTaste}
        <div class="menu-divider" role="separator"></div>
        <Button menu panel label="Admin" icon="shield">{@render calculateTaste()}</Button>
      {/if}
    </Button>
  {:else if isScreenWork(item)}<ScreenActions entryActions={entry ? entryMenu : undefined} tasteAction={canCalculateTaste ? calculateTaste : undefined} bind:this={screen} {editionName} {item} {context} {next} {requestable} {hero} {menuOnly} {showTrigger} />
  {:else}<CatalogueActions entryActions={entry ? entryMenu : undefined} tasteAction={canCalculateTaste ? calculateTaste : undefined} bind:this={catalogue} {item} {hero} {gameState} {readingState} {selectedPlaythrough} {ongamecreated} {onchanged} {refreshGame} primary={hero && !menuOnly} {showTrigger} />{/if}
  {#if canCalculateTaste && taste?.scope === identity}
    <TasteMatch workId={taste.workId} group={taste.group} rating={taste.rating} adminTitle={item.title} onclose={() => { taste = undefined; }} />
  {/if}
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

{#snippet calculateTaste(resolvedWorkId?: string, rating?: number | null)}
  {@const target = detailTaste(item, resolvedWorkId)}
  {#if target}
    <Button item icon="heart" disabled={preview} onclick={() => { taste = {...target, rating, scope: identity}; }}>Calculate taste score</Button>
  {/if}
{/snippet}

{#snippet entryMenu()}
  <Button item icon="left" keepOpen disabled={entryOperation.busy} onclick={() => moveEntry(-1)}>Move earlier</Button>
  <Button item icon="right" keepOpen disabled={entryOperation.busy} onclick={() => moveEntry(1)}>Move later</Button>
  <div class="menu-divider" role="separator"></div>
  <Button item icon="close" danger disabled={entryOperation.busy} onclick={() => { removal = entry; }}>Remove entry…</Button>
{/snippet}
