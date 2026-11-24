<script lang="ts">
  import { tick } from 'svelte';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
  import { slidingPill } from '#lib/ui/materials/sliding-pill.js';

  let { options, value, onchange }: {
    options: { value: string; label: string }[];
    value: string;
    onchange: (value: string, direction: -1 | 1) => void;
  } = $props();

  const middle = 2;
  const copies = [0, 1, middle, 3, 4];
  const maxLabelFadeWidth = 48;
  const middleStart = $derived(middle * options.length);
  let position = $state<number>();
  const selected = $derived(position ?? middleStart + options.findIndex(option => option.value === value));
  let viewport: HTMLDivElement;
  let track: HTMLDivElement;
  let ready = $state(false);
  let rebasing = $state(false);
  let arrowHighlightWidth = $state<number>();
  let pointerPreviewLocked = false;
  let scrollTarget: number | undefined;
  let frame = 0;
  let sections: { label: HTMLElement; start: number; end: number; center: number; width: number }[] = [];

  const allowPointerPreview = () => !pointerPreviewLocked && arrowHighlightWidth === undefined;

  function enterTrack(event: PointerEvent) {
    if (!viewport.contains(event.relatedTarget as Node | null)) arrowHighlightWidth = undefined;
  }

  function measureSections() {
    // Offset coordinates stay in track space even while the popup animates.
    sections = Array.from(track.querySelectorAll<HTMLElement>('.segment-label'), label => {
      const button = label.parentElement!;
      const left = button.offsetLeft;
      const width = button.offsetWidth;
      const start = left + label.offsetLeft;
      return { label, start, end: start + label.offsetWidth, center: left + width / 2, width };
    });
  }

  function fadeLabels() {
    const leftEdge = viewport.scrollLeft;
    const width = viewport.clientWidth;
    const rightEdge = leftEdge + width;
    const labelFadeWidth = Math.min(maxLabelFadeWidth, width / 4);
    for (const { label, start, end } of sections) {
      const visible = end > leftEdge && start < rightEdge;
      const nearEdge = start < leftEdge + labelFadeWidth || end > rightEdge - labelFadeWidth;
      if (visible && nearEdge) {
        const left = leftEdge - start;
        const right = rightEdge - start;
        label.style.maskImage = `linear-gradient(to right, transparent ${left}px, black ${left + labelFadeWidth}px,
          black ${right - labelFadeWidth}px, transparent ${right}px)`;
      } else if (label.style.maskImage) {
        label.style.removeProperty('mask-image');
      }
    }
  }

  function center(index: number, behavior: ScrollBehavior = 'auto') {
    if (!viewport || !track) return;
    measureSections();
    const segment = sections[index];
    if (!segment) return;
    const left = segment.center - viewport.clientWidth / 2;
    if (arrowHighlightWidth !== undefined) arrowHighlightWidth = segment.width;
    if (Math.abs(left - viewport.scrollLeft) < 1) scrollTarget = undefined;
    viewport.scrollTo({ left, behavior });
    fadeLabels();
  }

  async function rebase(index: number) {
    rebasing = true;
    scrollTarget = index;
    position = index;
    await tick();
    if (scrollTarget === index) center(index, 'instant');
    ready = true;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { rebasing = false; });
    });
  }

  async function select(index: number, fromArrow = false) {
    // The moving track can generate pointerover without any movement from the user.
    pointerPreviewLocked = viewport.matches(':hover');
    arrowHighlightWidth = fromArrow ? arrowHighlightWidth ?? sections[selected]?.width : undefined;
    const direction = index < selected ? -1 : 1;
    scrollTarget = index;
    position = index;
    onchange(options[index % options.length].value, direction);
    await tick();
    if (scrollTarget === index) center(index);
  }

  export async function step(direction: -1 | 1) {
    let next = selected + direction;
    if (next < 0 || next >= copies.length * options.length) {
      const equivalent = middleStart + selected % options.length;
      await rebase(equivalent);
      next = equivalent + direction;
    }
    await select(next, true);
  }

  function settle() {
    const center = viewport.scrollLeft + viewport.clientWidth / 2;
    let closest = selected;
    let distance = Infinity;
    for (const [index, section] of sections.entries()) {
      const offset = Math.abs(center - section.center);
      if (offset < distance) {
        closest = index;
        distance = offset;
      }
    }
    // A pending native snap can finish after a new arrow or segment has already been selected.
    if (scrollTarget !== undefined && closest !== scrollTarget) return;
    scrollTarget = undefined;
    const option = closest % options.length;
    if (closest !== selected) onchange(options[option].value, closest < selected ? -1 : 1);
    const equivalent = middleStart + option;
    // Each copy has the same layout, so resetting the scroll position preserves what is visible.
    if (closest !== equivalent) void rebase(equivalent);
    else position = equivalent;
  }

  function observeSize(node: HTMLElement) {
    const resize = new ResizeObserver(entries => {
      if (entries.some(entry => entry.target === node)) void rebase(middleStart + selected % options.length);
      else {
        measureSections();
        fadeLabels();
      }
    });
    resize.observe(node);
    resize.observe(track);
    return { destroy() {
      resize.disconnect();
      cancelAnimationFrame(frame);
    } };
  }
</script>

<div class="picker-container glass" class:arrow-highlight={arrowHighlightWidth !== undefined} use:liquidGlass={{ variant: 'clear' }}>
  {#if arrowHighlightWidth !== undefined}
    <span class="sliding-pill-indicator centered-highlight" style:width={`${arrowHighlightWidth}px`} aria-hidden="true"></span>
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions (The viewport's pointer events only manage the visual highlight.) -->
  <div class="control-viewport" class:ready bind:this={viewport} use:observeSize onscroll={fadeLabels} onscrollend={settle}
    onpointerleave={() => { pointerPreviewLocked = false; }} onpointerovercapture={enterTrack}
    onpointerdown={event => {
      arrowHighlightWidth = undefined;
      if (event.pointerType === 'touch') scrollTarget = undefined;
    }}
    onwheel={event => { if (event.deltaX) scrollTarget = undefined; }}>
    <div class="segmented-control" class:rebasing bind:this={track} role="group" aria-label="Settings section"
      use:slidingPill={allowPointerPreview}>
      {#each copies as copy}
        {#each options as option, index (option.value)}
          {@const occurrence = copy * options.length + index}
          <button type="button" aria-pressed={occurrence === selected} aria-hidden={copy !== middle}
            tabindex={copy === middle ? 0 : -1} class:current={option.value === value}
            onmousedown={event => { if (copy !== middle) event.preventDefault(); }}
            onclick={() => void select(occurrence)}><span class="segment-label">{option.label}</span></button>
        {/each}
      {/each}
    </div>
  </div>
</div>

<style>
  .picker-container {
    min-inline-size:0;
    inline-size:100%;
    border-radius:999px;
    background:var(--coast-glass-fill);
  }
  .control-viewport {
    container-type:inline-size;
    overflow-x:auto;
    overscroll-behavior-x:contain;
    scrollbar-width:none;
    border-radius:inherit;
    scroll-snap-type:x mandatory;
    scroll-behavior:smooth;
  }
  .control-viewport:not(.ready) { visibility:hidden; }
  .segmented-control { inline-size:max-content; padding-inline:50cqi; background:transparent; }
  .segmented-control > button { flex:none; scroll-snap-align:center; }
  .segmented-control > button.current { color:var(--white); font-weight:var(--weight-bold); }
  .rebasing > :global(.sliding-pill-indicator) { transition:none; }
  .arrow-highlight .segmented-control > :global(.sliding-pill-indicator) { visibility:hidden; transition:none; }
  .centered-highlight { inset-block:var(--segment-inset); left:50%; transform:translateX(-50%); }
  @media (prefers-reduced-motion:reduce) { .control-viewport { scroll-behavior:auto; } }
</style>
