<script lang="ts">
  import { change, message } from '$lib/ui/client';
  import Icon from './Icon.svelte';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  let {
    mediaId,
    value = null,
    menu = false,
    onrated,
  }: {
    mediaId: string;
    value?: number | null;
    menu?: boolean;
    onrated?: (value: number | null) => void;
  } = $props();
  let busy = $state(false);
  let error = $state('');
  let preview = $state<number | null>(null);
  const removing = $derived(preview !== null && preview === value);
  function pointerRating(event: MouseEvent | PointerEvent, index: number) {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return index + (event.clientX - bounds.left > bounds.width / 2 ? 1 : 0.5);
  }
  function ratingKey(event: KeyboardEvent, index: number) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      preview = Math.max(
        0.5,
        Math.min(5, (preview ?? value ?? index + 1) + (event.key === 'ArrowRight' ? 0.5 : -0.5))
      );
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      void rate(null);
    }
  }
  async function rate(score: number | null) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await change('ratings', { mediaId, value: score });
      preview = null;
      onrated?.(score);
      notifyAction(score === null ? 'Rating removed.' : `Rated ${score} stars.`);
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if menu}
  <div
    class="menu-rating"
    role="group"
    aria-label="Your rating"
    data-menu-interactive
    onpointerleave={() => (preview = null)}
  >
    <div class="rating-stars">
      {#each [0, 1, 2, 3, 4] as index}
        <button
          type="button"
          class="rating-star"
          class:rating-star-preview={preview !== null}
          class:rating-star-removing={removing}
          class:rating-star-selected={preview === null && value !== null}
          style={`--star-fill:${Math.max(0, Math.min(1, (preview ?? value ?? 0) - index)) * 100}%`}
          disabled={busy}
          data-menu-keep-open
          data-menu-focus
          aria-label={removing && Math.ceil(preview!) === index + 1
            ? 'Remove rating'
            : `${index + 1} stars`}
          aria-pressed={value !== null && value > index}
          onpointermove={(event) => (preview = pointerRating(event, index))}
          onfocus={() => (preview = index + 1)}
          onblur={() => (preview = null)}
          onkeydown={(event) => ratingKey(event, index)}
          onclick={(event) => {
            const score = event.detail === 0 ? (preview ?? index + 1) : pointerRating(event, index);
            void rate(score === value ? null : score);
          }}
        >
          <span class="rating-star-outline" aria-hidden="true"><Icon name="star" size={24} /></span>
          <span class="rating-star-fill" aria-hidden="true"
            ><Icon name="star" size={24} filled /></span
          >
        </button>
      {/each}
    </div>
    <span class="sr-only" role="status"
      >{busy
        ? 'Saving rating…'
        : removing
          ? 'Remove rating. Activate to clear your rating.'
          : `${preview ?? value ?? 'No'} stars`}. Use left and right arrows for half stars, Enter to
      select, or Delete to clear. Selecting your current rating removes it.</span
    >
  </div>
{:else}<div class="rating-control">
    <Icon name="star" size={18} filled={value !== null} /><select
      aria-label="Your rating"
      value={value ?? ''}
      onchange={(event) =>
        rate(event.currentTarget.value ? Number(event.currentTarget.value) : null)}
      disabled={busy}
      ><option value="">Rate this title</option
      >{#each [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5] as score}<option value={score}
          >{score} stars</option
        >{/each}<option value="">Remove rating</option></select
    >
  </div>{/if}
{#if error}<p class="text-danger small" role="alert">{error}</p>{/if}

<style>
  .menu-rating {
    display: grid;
    min-width: 0;
    padding: 4px var(--menu-item-inset, 8px);
  }
  .rating-stars {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    align-items: center;
    width: 100%;
    gap: 0;
  }
  .rating-star {
    position: relative;
    display: grid;
    width: 100%;
    min-width: 0;
    height: var(--control-height);
    place-items: center;
    border: 0;
    background: transparent;
    padding: 0;
    font-size: var(--text-2xl);
    line-height: var(--leading-solid);
    color: color-mix(in srgb, var(--white) 55%, transparent);
  }
  .rating-star-outline,
  .rating-star-fill {
    grid-column: 1;
    grid-row: 1;
    display: grid;
    place-items: center;
    width: min(24px, 100%);
    aspect-ratio: 1;
  }
  .rating-star :global(svg) {
    width: 100%;
    height: 100%;
  }
  .rating-star-fill {
    overflow: hidden;
    color: transparent;
    clip-path: inset(0 calc(100% - var(--star-fill)) 0 0);
  }
  .rating-star-preview .rating-star-fill {
    color: var(--ink);
  }
  .rating-star-selected .rating-star-fill {
    color: var(--rating);
  }
  .rating-star-removing .rating-star-fill {
    color: var(--danger);
  }
  .rating-control :global(svg) {
    width: var(--icon-inline);
    height: var(--icon-inline);
  }
  .rating-control {
    font-size: var(--text-sm);
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--rating);
  }
  .rating-control select {
    width: auto;
    background: transparent;
    border: 0;
    font-size: inherit;
    padding-left: 0;
    color: var(--ink);
  }
</style>
