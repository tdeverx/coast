<script lang="ts">
  import { page } from '$app/state';
  import type { ComponentProps } from 'svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import Rating from './Rating.svelte';
  import RecommendAction from './RecommendAction.svelte';
  import ReactionActions from './ReactionActions.svelte';
  let { section, workId, disabled = false, rating = null, onrated, controls = [] }: {
    section: 'social' | 'rating' | 'relationships' | 'quick' | 'reaction' | 'recommend';
    workId: string; disabled?: boolean; rating?: number | null; onrated?: (value: number | null) => void;
    controls?: ComponentProps<typeof Button>[];
  } = $props();
  let ratingControl=$state<Rating>();
  export function isBusy() { return ratingControl?.isBusy() ?? false; }
</script>
{#if section === 'social' && page.data.capabilities?.social!==false}
  <RecommendAction {workId} {disabled} /><ReactionActions targetId={workId} {disabled} />
{:else if section === 'reaction'}
  <ReactionActions targetId={workId} {disabled} />
{:else if section === 'recommend'}
  {#if page.data.capabilities?.social!==false}<RecommendAction {workId} {disabled} />{/if}
{:else if section === 'rating'}
  <Rating bind:this={ratingControl} mediaId={workId} value={rating} {onrated} />
{:else if section === 'quick'}
  <div class="quick-actions" role="group" aria-label="Quick actions">
    {#each controls as control}
      <Button {...control} size="icon" icon={undefined} class="menu-icon-action" text={undefined} label={control.label ?? control.text}
        title={control.title ?? control.text} keepOpen showCheckmark={false}>
        {#if control.icon}
          <span class="quick-outline" class:profile-icon={control.icon === 'image'} aria-hidden="true"><Icon name={control.icon} /></span>
          <span class="quick-fill" aria-hidden="true"><Icon name={control.icon} filled /></span>
        {/if}
      </Button>
    {/each}
  </div>
{:else if section === 'relationships'}
  {#each controls as control}<Button {...control} />{/each}
{/if}

<style>
  .quick-actions { display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: var(--menu-inset); }
  .quick-actions :global(.menu-icon-action:hover:not(:disabled)),
  .quick-actions :global(.menu-icon-action:focus-visible) { background: transparent; }
  .quick-outline, .quick-fill {
    grid-area: 1 / 1;
    display: grid;
    place-items: center;
    width: min(var(--menu-icon-action-artwork), 100%);
    aspect-ratio: 1;
    color: color-mix(in srgb, var(--white) 55%, transparent);
  }
  .quick-outline.profile-icon { color: var(--quick-profile-outline, color-mix(in srgb, var(--white) 55%, transparent)); }
  .quick-actions :global(svg) { width: 100%; height: 100%; }
  .quick-fill {
    overflow: hidden;
    color: var(--quick-fill-color, transparent);
    clip-path: inset(0 calc(100% - var(--quick-fill, 0%)) 0 0);
  }
  .quick-actions :global(.menu-icon-action[aria-checked='true']),
  .quick-actions :global(.menu-icon-action:focus-visible) { --quick-fill: 100%; --quick-fill-color: var(--ink); --quick-profile-outline: transparent; }
  .quick-actions :global(.menu-icon-action[role='menuitemcheckbox'][aria-checked='true']:focus-visible) { --quick-fill-color: var(--danger); }
  @media (hover: hover) {
    .quick-actions :global(.menu-icon-action:hover) { --quick-fill: 100%; --quick-fill-color: var(--ink); --quick-profile-outline: transparent; }
    .quick-actions :global(.menu-icon-action[role='menuitemcheckbox'][aria-checked='true']:hover) { --quick-fill-color: var(--danger); }
  }
</style>
