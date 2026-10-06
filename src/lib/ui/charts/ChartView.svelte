<script lang="ts">
  import type { ChartModel } from './model';
  let { model, selected, onselect }: { model: ChartModel; selected: number; onselect: (index: number) => void } = $props();
  let standard: Promise<typeof import('./StandardChart.svelte')> | undefined;
  let extended: Promise<typeof import('./ExtendedChart.svelte')> | undefined;
  function renderer(style: string) {
    return Number.parseInt(style) <= 7
      ? (standard ??= import('./StandardChart.svelte'))
      : (extended ??= import('./ExtendedChart.svelte'));
  }
  const loaded = $derived(renderer(model.styleId));
</script>

<div class="chart-visual chart-renderer">
{#await loaded}
  <p class="quiet" role="status">Loading chart…</p>
{:then chart}
  <chart.default {model} {selected} {onselect} />
{:catch}
  <p role="alert">The chart could not load. Reload this page to try again.</p>
{/await}
</div>
