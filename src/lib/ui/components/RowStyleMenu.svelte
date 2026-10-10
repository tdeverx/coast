<script lang="ts">
  import ChoiceGroup from './ChoiceGroup.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import type { ArtworkPriority } from '$lib/ui/types';

  import { artworkTypes } from '$lib/artwork';
  import type { MediaCardShape, MediaCardArtwork, MediaCardOverlay } from '$lib/ui/types';
  let {
    title,
    artworkOptions = true,
    mediaKind = 'screen',
    overridePriority = $bindable(null),
    overrideShape = $bindable(null),
    overrideArtwork = $bindable(null),
    overrideOverlay = $bindable(null),
  }: {
    title: string;
    artworkOptions?: boolean;
    mediaKind?: 'screen' | 'music' | 'game' | 'reading';
    overridePriority?: ArtworkPriority | null;
    overrideShape?: MediaCardShape | null;
    overrideArtwork?: MediaCardArtwork | null;
    overrideOverlay?: MediaCardOverlay | null;
  } = $props();
  export function openAt(point: { x: number; y: number }) {
    shapeMenu?.openAt(point);
  }




  const overlays: { value: MediaCardOverlay; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'logo', label: 'Logo' },
    { value: 'art', label: 'Clear art' },
    { value: 'disc', label: 'Disc' },
  ];
  let shapeMenu = $state<Button>();
  const shapes: MediaCardShape[] = ['poster', 'square', 'circle', 'fanart', 'banner'];


  const artworkStyles = $derived([
    { value: 'auto', label: 'Automatic' },
    { value: 'none', label: 'None' },
    ...(mediaKind === 'screen'
      ? (['primary', 'backdrop', 'thumb', 'banner', 'screenshot'] as const)
      : mediaKind === 'game'
        ? (['primary', 'backdrop'] as const)
        : (['primary'] as const)
    ).map((value) => ({
      value,
      label: value === 'primary' && (mediaKind === 'music' || mediaKind === 'reading') ? 'Cover' : artworkTypes[value].label,
    })),
  ] satisfies { value: MediaCardArtwork; label: string }[]);
  const priorities: ArtworkPriority[] = [
    'episode-season-show',
    'episode-show-season',
    'season-episode-show',
    'season-show-episode',
    'show-season-episode',
    'show-episode-season',
  ];
</script>

<Button menu bind:this={shapeMenu} label={`${title} style`} hideTrigger>
  <Button menu label="Shape" panel>
    <ChoiceGroup label="Shape" value={overrideShape} options={shapes.map(value => ({ value, label: value === 'fanart' ? 'Landscape' : value[0].toUpperCase() + value.slice(1) }))} defaultOption change={value => overrideShape = value as typeof overrideShape} />
  </Button>
  {#if artworkOptions}
    <Button menu label="Artwork" panel>
      <ChoiceGroup label="Artwork" value={overrideArtwork} options={artworkStyles} defaultOption change={value => overrideArtwork = value as typeof overrideArtwork} />
    </Button>
    {#if mediaKind === 'screen'}
      <Button menu label="Prefer artwork from" panel>
        <ChoiceGroup label="Prefer artwork from" value={overridePriority} options={priorities.map(value => ({value, label: value.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' → ')}))} defaultOption change={value => overridePriority = value as typeof overridePriority} />
      </Button>
      <Button menu label="Overlay" panel>
        <ChoiceGroup label="Overlay" value={overrideOverlay} options={overlays} defaultOption change={value => overrideOverlay = value as typeof overrideOverlay} />
      </Button>
    {/if}
  {/if}
  <div class="menu-divider" role="separator"></div>
  <Button item
    icon="refresh"
    disabled={!overridePriority && !overrideShape && !overrideArtwork && !overrideOverlay}
    disabledReason="Already using the default style"
    onclick={() => {
      overridePriority = null;
      overrideShape = null;
      overrideArtwork = null;
      overrideOverlay = null;
    }}>Reset to default</Button>
</Button>
