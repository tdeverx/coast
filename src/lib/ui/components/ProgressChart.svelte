<script lang="ts">
  import ProgressBar from './ProgressBar.svelte';
  let {
    items,
    label,
  }: { label: string; items: { label: string; value: number; total?: number; href?: string }[] } =
    $props();
</script>

<div class="progress-chart" aria-label={label}>
  {#each items as item}
    {#snippet content()}<div class="heading">
        <span>{item.label}</span><small
          >{item.total
            ? `${item.value.toLocaleString()} / ${item.total.toLocaleString()}`
            : 'Count unavailable'}</small
        >
      </div>
      <div class="track">
        {#if item.total && item.total > 0}<ProgressBar progress={item.value / item.total} label={`${item.label}: ${item.value} of ${item.total}`} />{:else}<span aria-hidden="true"></span>{/if}
      </div>{/snippet}
    {#if item.href}<a href={item.href}>{@render content()}</a>{:else}<div>
        {@render content()}
      </div>{/if}
  {/each}
</div>

<style>
  .progress-chart {
    display: grid;
    gap: 18px;
    max-height: 280px;
    overflow: auto;
    scrollbar-width: thin;
    padding: 2px;
  }
  .heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    font-size: var(--text-sm);
  }
  small {
    flex: none;
    color: var(--muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .track {
    height: 6px;
    border-radius: 999px;
    --progress-track-background: color-mix(in srgb, var(--white) calc(24 / 255 * 100%), transparent);
    background: var(--progress-track-background);
    --progress-fill-background: linear-gradient(to right, color-mix(in srgb, var(--white) calc(128 / 255 * 100%), transparent), var(--ink));
    overflow: hidden;
  }
  a:hover .heading {
    color: var(--ink);
  }
</style>
