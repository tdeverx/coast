<script lang="ts">
  import type { ArtworkPriority } from '$lib/ui/types';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  import { artworkTypes } from '$lib/artwork';
  import type { MediaCardShape, MediaCardArtwork, MediaCardOverlay } from '$lib/ui/types';
  let {
    title,
    shape = 'poster',
    artworkStyle = 'auto',
    overlay = 'none',
    artworkOptions = true,
    overridePriority = $bindable(null),
    overrideShape = $bindable(null),
    overrideArtwork = $bindable(null),
    overrideOverlay = $bindable(null),
  }: {
    title: string;
    shape?: MediaCardShape;
    artworkStyle?: MediaCardArtwork;
    overlay?: MediaCardOverlay;
    artworkOptions?: boolean;
    overridePriority?: ArtworkPriority | null;
    overrideShape?: MediaCardShape | null;
    overrideArtwork?: MediaCardArtwork | null;
    overrideOverlay?: MediaCardOverlay | null;
  } = $props();
  export function openAt(point: { x: number; y: number }) {
    shapeMenu?.openAt(point);
  }

  const currentShape = $derived(overrideShape ?? shape);

  const currentOverlay = $derived(overrideOverlay ?? overlay);
  const overlays: { value: MediaCardOverlay; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'logo', label: 'Logo' },
    { value: 'art', label: 'Clear art' },
    { value: 'disc', label: 'Disc' },
  ];
  let shapeMenu = $state<ContextMenu>();
  const shapes: MediaCardShape[] = ['poster', 'square', 'fanart', 'banner'];

  const currentArtwork = $derived(overrideArtwork ?? artworkStyle);
  const artworkStyles: { value: MediaCardArtwork; label: string }[] = [
    { value: 'auto', label: 'Automatic' },
    { value: 'none', label: 'None' },
    ...(['primary', 'backdrop', 'thumb', 'banner', 'screenshot'] as const).map((value) => ({
      value,
      label: artworkTypes[value].label,
    })),
  ];
  const priorities: ArtworkPriority[] = [
    'episode-season-show',
    'episode-show-season',
    'season-episode-show',
    'season-show-episode',
    'show-season-episode',
    'show-episode-season',
  ];
</script>

<ContextMenu bind:this={shapeMenu} label={`${title} style`} hideTrigger>
  <ContextMenu label="Shape" panel>
    <MenuAction
      selection="radio"
      checked={overrideShape === null}
      onclick={() => (overrideShape = null)}>Use default</MenuAction
    >
    <div class="menu-divider" role="separator"></div>
    {#each shapes as option}<MenuAction
        selection="radio"
        checked={overrideShape !== null && currentShape === option}
        onclick={() => (overrideShape = option)}
        >{option === 'fanart' ? 'Landscape' : option[0].toUpperCase() + option.slice(1)}</MenuAction
      >{/each}
  </ContextMenu>
  {#if artworkOptions}
    <ContextMenu label="Artwork" panel>
      <MenuAction
        selection="radio"
        checked={overrideArtwork === null}
        onclick={() => (overrideArtwork = null)}>Use default</MenuAction
      >
      <div class="menu-divider" role="separator"></div>
      {#each artworkStyles as option}<MenuAction
          selection="radio"
          checked={overrideArtwork !== null && currentArtwork === option.value}
          onclick={() => (overrideArtwork = option.value)}>{option.label}</MenuAction
        >{/each}
    </ContextMenu>
    <ContextMenu label="Prefer artwork from" panel>
      <MenuAction
        selection="radio"
        checked={overridePriority === null}
        onclick={() => (overridePriority = null)}>Use default</MenuAction
      >
      <div class="menu-divider" role="separator"></div>
      {#each priorities as priority}<MenuAction
          selection="radio"
          checked={overridePriority === priority}
          onclick={() => (overridePriority = priority)}
          >{priority
            .split('-')
            .map((level) => level[0].toUpperCase() + level.slice(1))
            .join(' → ')}</MenuAction
        >{/each}
    </ContextMenu>
    <ContextMenu label="Overlay" panel>
      <MenuAction
        selection="radio"
        checked={overrideOverlay === null}
        onclick={() => (overrideOverlay = null)}>Use default</MenuAction
      >
      <div class="menu-divider" role="separator"></div>
      {#each overlays as option}<MenuAction
          selection="radio"
          checked={overrideOverlay !== null && currentOverlay === option.value}
          onclick={() => (overrideOverlay = option.value)}>{option.label}</MenuAction
        >{/each}
    </ContextMenu>
  {/if}
  <div class="menu-divider" role="separator"></div>
  <MenuAction
    icon="refresh"
    disabled={!overridePriority && !overrideShape && !overrideArtwork && !overrideOverlay}
    disabledReason="Already using the default style"
    onclick={() => {
      overridePriority = null;
      overrideShape = null;
      overrideArtwork = null;
      overrideOverlay = null;
    }}>Reset to default</MenuAction
  >
</ContextMenu>
