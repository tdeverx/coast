<script module lang="ts">
  import {
    FilterHorizontalIcon,
    SmileIcon,
    UserIcon,
    UserMultipleIcon,
    Home01Icon,
    LibraryIcon,
    FolderLibraryIcon,
    DiscoverCircleIcon,
    Search01Icon,
    PlayIcon,
    TvMinimalPlayIcon,
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
    smile: SmileIcon,
    user: UserIcon,
    friends: UserMultipleIcon,
    home: Home01Icon,
    library: LibraryIcon,
    collection: FolderLibraryIcon,
    discover: DiscoverCircleIcon,
    search: Search01Icon,
    play: PlayIcon,
    party: TvMinimalPlayIcon,
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
  const fillableIcons = new Set<IconName>(['play', 'pause', 'heart', 'star', 'bookmark', 'collection']);
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
  {#if name === 'collection' && showFill}
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M7.5 4C7.5 3.53406 7.5 3.30109 7.57612 3.11732C7.67761 2.87229 7.87229 2.67761 8.11732 2.57612C8.30109 2.5 8.53406 2.5 9 2.5H15C15.4659 2.5 15.6989 2.5 15.8827 2.57612C16.1277 2.67761 16.3224 2.87229 16.4239 3.11732C16.5 3.30109 16.5 3.53406 16.5 4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <path d="M5 8C5 7.53406 5 7.30109 5.07612 7.11732C5.17761 6.87229 5.37229 6.67761 5.61732 6.57612C5.80109 6.5 6.03406 6.5 6.5 6.5H17.5C17.9659 6.5 18.1989 6.5 18.3827 6.57612C18.6277 6.67761 18.8224 6.87229 18.9239 7.11732C19 7.30109 19 7.53406 19 8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <path d="M16.2627 10.5H7.73725C5.15571 10.5 3.86494 10.5 3.27143 11.3526C2.67793 12.2052 3.11904 13.4258 4.00126 15.867L5.08545 18.867C5.54545 20.1398 5.77545 20.7763 6.2889 21.1381C6.80235 21.5 7.47538 21.5 8.82143 21.5H15.1786C16.5246 21.5 17.1976 21.5 17.7111 21.1381C18.2245 20.7763 18.4545 20.1398 18.9146 18.867L19.9987 15.867C20.881 13.4258 21.3221 12.2052 20.7286 11.3526C20.1351 10.5 18.8443 10.5 16.2627 10.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
    </svg>
  {:else}
  <HugeiconsIcon
    icon={icons[name]}
    {size}
    strokeWidth={2}
    class={showFill ? 'coast-icon-filled' : undefined}
    aria-hidden="true"
    focusable="false"
  />
  {/if}
{/key}

<style>
  :global(svg.coast-icon-filled) {
    fill: currentColor;
  }
</style>
