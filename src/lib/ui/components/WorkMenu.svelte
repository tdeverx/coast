<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import ScreenActions from '../work-menu/ScreenActions.svelte';
  import CatalogueActions from '../work-menu/CatalogueActions.svelte';
  import Button from './Button.svelte';
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
  {:else if isScreenWork(item)}<ScreenActions bind:this={screen} {editionName} {item} {context} {next} {requestable} {hero} {menuOnly} {showTrigger} />
  {:else}<CatalogueActions bind:this={catalogue} {item} {hero} {gameState} {readingState} {selectedPlaythrough} {ongamecreated} {onchanged} {refreshGame} primary={hero && !menuOnly} {showTrigger} />{/if}
{/key}
