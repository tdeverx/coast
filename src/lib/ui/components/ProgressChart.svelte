<script lang="ts">
  import ProgressBar from './ProgressBar.svelte';
  let {
    items,
    label,
  }: { label: string; items: { label: string; value: number; total?: number; href?: string }[] } =
    $props();
</script>

<div class="progress-chart chart-visual" aria-label={label}>
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
    gap: calc(var(--chart-gap) * 1.5);
    max-height: 280px;
    overflow: auto;
    scrollbar-width: thin;
    padding: 2px;
  }
  .heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--chart-gap);
    margin-bottom: 8px;
    font-size: var(--text-md);
  }
  small {
    flex: none;
    color: var(--chart-muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .track {
    height: 6px;
    border-radius: 999px;
    --progress-track-background: var(--chart-track);
    background: var(--progress-track-background);
    --progress-fill-background: var(--chart-series-1);
    overflow: hidden;
  }
  a:hover .heading {
    color: var(--ink);
  }
</style>
