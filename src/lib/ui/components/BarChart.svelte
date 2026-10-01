<script lang="ts">
  import { chartValue, type ChartDatum } from '$lib/ui/charts/types';
  let {
    items,
    label,
    summary,
    caption,
    axis = false,
    empty = 'No activity in this period.',
  }: {
    items: ChartDatum[];
    label: string;
    summary: string;
    caption?: string;
    axis?: boolean;
    empty?: string;
  } = $props();
  let selected = $state<number | null>(null);
  const maximum = $derived(Math.max(1, ...items.map((i) => chartValue(i.value))));
  const active = $derived(selected === null ? undefined : items[selected]);
  const hasData = $derived(items.some((i) => i.value > 0));
</script>

<div class="chart" aria-label={label}>
  <div class="summary" aria-live="polite">
    <strong>{active ? active.value.toLocaleString() : summary}</strong><span
      >{active ? (active.detail ?? active.label) : caption}</span
    >
  </div>
  <div class="plot">
    <div class="guides" aria-hidden="true">
      <span>{maximum.toLocaleString()}</span><span>0</span>
    </div>
    <div class="bars">
      {#each items as item, index}
        {#snippet bar()}<span
            class="bar"
            class:zero={!item.value}
            style:height={`${(chartValue(item.value) / maximum) * 100}%`}
          ></span>{/snippet}
        {#if item.href}<a
            href={item.href}
            class="target"
            aria-label={`${item.detail ?? item.label}: ${item.value}`}
            onpointerenter={() => (selected = index)}
            onpointerleave={() => (selected = null)}
            onfocus={() => (selected = index)}
            onblur={() => (selected = null)}>{@render bar()}</a
          >
        {:else}<button
            type="button"
            class="target"
            aria-label={`${item.detail ?? item.label}: ${item.value}`}
            onpointerenter={() => (selected = index)}
            onpointerleave={() => (selected = null)}
            onfocus={() => (selected = index)}
            onblur={() => (selected = null)}
            onclick={() => (selected = selected === index ? null : index)}>{@render bar()}</button
          >{/if}
      {/each}
    </div>
    {#if !hasData}<p class="empty">{empty}</p>{/if}
  </div>
  {#if items.length}<div class="labels" class:all={axis} aria-hidden="true">
      {#if axis}{#each items as item}<span>{item.label}</span>{/each}
      {:else}<span>{items[0].label}</span><span>{items[Math.floor(items.length / 2)].label}</span
        ><span>{items[items.length - 1].label}</span>{/if}
    </div>{/if}
</div>

<style>
  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    min-height: 40px;
  }
  .summary strong {
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }
  .summary span {
    font-size: var(--text-sm);
    color: var(--muted);
  }
  .plot {
    position: relative;
    display: flex;
    gap: 12px;
    height: 150px;
    margin-top: 20px;
  }
  .guides {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-width: 20px;
    text-align: right;
    color: var(--quiet);
    font-size: var(--text-sm);
  }
  .bars {
    display: flex;
    gap: clamp(2px, 0.5vw, 9px);
    flex: 1;
    min-width: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--white) calc(21 / 255 * 100%), transparent);
    background: repeating-linear-gradient(
      to top,
      transparent 0,
      transparent calc(50% - 1px),
      color-mix(in srgb, var(--white) calc(8 / 255 * 100%), transparent) 50%
    );
  }
  .target {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: end;
    justify-content: center;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .bar {
    width: 100%;
    max-width: 24px;
    min-height: 2px;
    border-radius: 5px 5px 0 0;
    background: linear-gradient(to top, color-mix(in srgb, var(--white) calc(112 / 255 * 100%), transparent), color-mix(in srgb, var(--white) calc(217 / 255 * 100%), transparent));
    transition: opacity var(--fast);
  }
  .bar.zero {
    opacity: 0.15;
  }
  .target:hover .bar,
  .target:focus-visible .bar {
    background: var(--ink);
  }
  .labels {
    display: flex;
    justify-content: space-between;
    gap: 4px;
    margin: 10px 0 0 32px;
    font-size: var(--text-sm);
    color: var(--quiet);
  }
  .labels.all span {
    flex: 1;
    text-align: center;
  }
  .empty {
    position: absolute;
    inset: 42px 16px auto 40px;
    text-align: center;
    color: var(--muted);
    font-size: var(--text-sm);
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
    }
  }
</style>
