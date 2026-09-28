<script lang="ts">
  import { chartTones, chartValue, type ChartDatum } from '$lib/ui/charts/types';
  let {
    items,
    label,
    centre,
    unit = 'total',
    showLegend = true,
  }: {
    items: ChartDatum[];
    label: string;
    centre?: string;
    unit?: string;
    showLegend?: boolean;
  } = $props();
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  let selected = $state<number | null>(null);
  const total = $derived(items.reduce((n, d) => n + chartValue(d.value), 0));
  const active = $derived(selected === null ? undefined : items[selected]);
  const slices = $derived.by(() => {
    let angle = -Math.PI / 2;
    return items.map((item, index) => {
      const sweep = (chartValue(item.value) / Math.max(1, total)) * Math.PI * 2;
      const end = angle + Math.min(sweep, Math.PI * 2 - 0.00001);
      const point = (r: number, a: number) => `${100 + r * Math.cos(a)},${100 + r * Math.sin(a)}`;
      const path = `M ${point(91, angle)} A 91 91 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(91, end)} L ${point(72, end)} A 72 72 0 ${sweep > Math.PI ? 1 : 0} 0 ${point(72, angle)} Z`;
      angle += sweep;
      return { ...item, path, colour: item.tone ?? chartTones[index % chartTones.length] };
    });
  });
</script>

<div class="breakdown" aria-label={label}>
  <div class="chart-ring">
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label={`${label}: ${items.map((i) => `${i.label} ${format(i.value)}`).join(', ')}`}
    >
      <circle
        cx="100"
        cy="100"
        r="81.5"
        fill="none"
        stroke="currentColor"
        stroke-width="19"
        opacity=".08"
      />
      {#each slices as slice, index}{#if slice.value > 0}<path
            d={slice.path}
            fill={slice.colour}
            class:dimmed={active && selected !== index}
          />{/if}{/each}
    </svg>
    <div class="centre" aria-live="polite">
      <strong>{active ? format(active.value) : (centre ?? format(total))}</strong><span
        >{active?.label ?? unit}</span
      >
    </div>
  </div>
  {#if showLegend}<ul>
      {#each slices as item, index}<li>
          {#snippet entry()}<i style:background={item.colour}></i><span class="label"
              >{item.label}</span
            ><strong>{format(item.value)}</strong><small
              >{total ? Math.round((item.value / total) * 100) : 0}%</small
            >{/snippet}
          {#if item.href}<a
              href={item.href}
              onpointerenter={() => (selected = index)}
              onpointerleave={() => (selected = null)}
              onfocus={() => (selected = index)}
              onblur={() => (selected = null)}>{@render entry()}</a
            >
          {:else}<button
              type="button"
              class="legend-entry"
              onfocus={() => (selected = index)}
              onblur={() => (selected = null)}
              onclick={() => (selected = selected === index ? null : index)}
              onpointerenter={() => (selected = index)}
              onpointerleave={() => (selected = null)}
            >
              {@render entry()}
            </button>{/if}
        </li>{/each}
    </ul>{/if}
</div>

<style>
  .breakdown {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 24px;
  }
  .chart-ring {
    position: relative;
    width: 156px;
    height: 156px;
    flex: none;
  }
  svg {
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  path {
    stroke: #0d0d0d;
    stroke-width: 2px;
    transition: opacity var(--fast);
  }
  path.dimmed {
    opacity: 0.3;
  }
  .centre {
    position: absolute;
    inset: 30px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    gap: 5px;
    pointer-events: none;
  }
  .centre strong {
    font-size: 26px;
    font-weight: 650;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
  }
  .centre span {
    font-size: 10px;
    color: var(--muted);
    line-height: 1.3;
  }
  ul {
    flex: 1;
    min-width: 155px;
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 10px;
  }
  a,
  .legend-entry {
    width: 100%;
    border: 0;
    padding: 0;
    background: none;
    text-align: left;
    color: inherit;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    min-height: 24px;
  }
  a:hover .label {
    color: var(--ink);
  }
  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex: none;
  }
  .label {
    flex: 1;
    color: var(--muted);
  }
  strong,
  small {
    font-variant-numeric: tabular-nums;
  }
  small {
    width: 30px;
    text-align: right;
    color: var(--quiet);
    font-size: 10px;
  }
  @media (prefers-reduced-motion: reduce) {
    path {
      transition: none;
    }
  }
</style>
