<script module lang="ts">
  import {
    FilterHorizontalIcon,
    UserIcon,
    Home01Icon,
    LibraryIcon,
    DiscoverCircleIcon,
    Search01Icon,
    PlayIcon,
    PauseIcon,
    GoBackward10SecIcon,
    GoForward30SecIcon,
    PlusSignIcon,
    Tick02Icon,
    FavouriteIcon,
    StarIcon,
    MoreHorizontalIcon,
    Cancel01Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Notification01Icon,
    Settings01Icon,
    LeftToRightListBulletIcon,
    Bookmark01Icon,
    Logout01Icon,
    VolumeHighIcon,
    VolumeOffIcon,
    SubtitleIcon,
    CropIcon,
    FullScreenIcon,
    RefreshIcon,
    ServerStack01Icon,
    Clock01Icon,
    Film01Icon,
    ArrowRight02Icon,
    Download01Icon,
    Shield01Icon,
  } from '@hugeicons/core-free-icons';

  const icons = {
    filter: FilterHorizontalIcon,
    user: UserIcon,
    home: Home01Icon,
    library: LibraryIcon,
    discover: DiscoverCircleIcon,
    search: Search01Icon,
    play: PlayIcon,
    pause: PauseIcon,
    rewind: GoBackward10SecIcon,
    forward: GoForward30SecIcon,
    plus: PlusSignIcon,
    check: Tick02Icon,
    heart: FavouriteIcon,
    star: StarIcon,
    more: MoreHorizontalIcon,
    close: Cancel01Icon,
    left: ArrowLeft01Icon,
    right: ArrowRight01Icon,
    bell: Notification01Icon,
    settings: Settings01Icon,
    list: LeftToRightListBulletIcon,
    bookmark: Bookmark01Icon,
    request: PlusSignIcon,
    logout: Logout01Icon,
    volume: VolumeHighIcon,
    muted: VolumeOffIcon,
    subtitles: SubtitleIcon,
    crop: CropIcon,
    fullscreen: FullScreenIcon,
    refresh: RefreshIcon,
    server: ServerStack01Icon,
    clock: Clock01Icon,
    film: Film01Icon,
    arrow: ArrowRight02Icon,
    download: Download01Icon,
    shield: Shield01Icon,
  } as const;
  export type IconName = keyof typeof icons;
  // Fill only closed silhouettes; utility and navigation paths stay outlined.
  const fillableIcons = new Set<IconName>(['play', 'pause', 'heart', 'star', 'bookmark']);
</script>

<script lang="ts">
  import { HugeiconsIcon } from '@hugeicons/svelte';
  let { name, size = 20, filled }: { name: IconName; size?: number; filled?: boolean } = $props();
  const showFill = $derived(
    fillableIcons.has(name) && (filled ?? (name === 'play' || name === 'pause'))
  );
</script>

<!-- The library binds icon geometry on mount; remount when the action changes. -->
{#key name}
  <HugeiconsIcon
    icon={icons[name]}
    {size}
    strokeWidth={2}
    class={showFill ? 'coast-icon-filled' : undefined}
    aria-hidden="true"
    focusable="false"
  />
{/key}

<style>
  :global(svg.coast-icon-filled) {
    fill: currentColor;
  }
</style>
