<script lang="ts">
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
      <div
        class="track"
        role={item.total ? 'progressbar' : undefined}
        aria-label={item.label}
        aria-valuenow={item.total ? Math.min(item.value, item.total) : undefined}
        aria-valuemin={item.total ? 0 : undefined}
        aria-valuemax={item.total}
      >
        <span style:width={`${item.total ? Math.min(100, (item.value / item.total) * 100) : 0}%`}
        ></span>
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
    font-size: 12px;
  }
  small {
    flex: none;
    color: var(--muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .track {
    height: 6px;
    border-radius: 999px;
    background: #ffffff18;
    overflow: hidden;
  }
  .track span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(to right, #ffffff80, var(--ink));
  }
  a:hover .heading {
    color: white;
  }
</style>
