<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import { setContext } from 'svelte';
  import { formatValue, type ChartModel } from './model';
  import { chartLinks } from './context';
  let { model, selected = $bindable(0), onselect, compact = false }: { model: ChartModel; selected?: number; onselect?: (index: number) => void; compact?:boolean } = $props();
  setContext(chartLinks, (index:number)=>model.rows[index]?.href);
  let standard: Promise<typeof import('./StandardChart.svelte')> | undefined;
  let extended: Promise<typeof import('./ExtendedChart.svelte')> | undefined;
  function renderer(style: string) {
    return Number.parseInt(style) <= 7
      ? (standard ??= import('./StandardChart.svelte'))
      : (extended ??= import('./ExtendedChart.svelte'));
  }
  const loaded = $derived(renderer(model.styleId));
  $effect(()=>{if(model.rows.length && selected>=model.rows.length)selected=0;});
  const selection = $derived(model.rows[selected]);
  function select(index:number) { selected=index; onselect?.(index); }
  let loadError=$state('');
  $effect(()=>{loadError='';if(compact&&!model.rows.length)return;const pending=loaded;let current=true;void pending.catch(()=>{if(current)loadError='The chart could not load. Reload this page to try again.';});return()=>{current=false;};});
  reportFailure(()=>loadError);
</script>

<div class="chart-visual chart-renderer" class:compact>
{#if compact && !model.rows.length}<p class="quiet">{String(model.raw.empty ?? 'No data yet.')}</p>
{:else}
  {#await loaded}
    <p class="quiet" role="status">Loading chart…</p>
  {:then chart}
    <chart.default {model} {selected} onselect={select} {compact} />
  {:catch}<!-- Failure is delivered by the scoped toast. -->
  {/await}
  {#if compact}
    {#if model.subtitle}<p class="chart-caption">{model.subtitle}</p>{/if}
    {#if selection}<p class="chart-caption" role="status">{#if selection.href}<a href={selection.href}>{selection.detail ?? selection.label}</a>{:else}{selection.detail ?? selection.label}{/if} · {formatValue(selection.value,selection.valueUnit??model.unit)}{selection.capacity === undefined ? '' : ` / ${selection.capacity.toLocaleString()}`}{model.styleId === '11A' && selection.capacity === undefined ? ' · Total unknown' : ''}</p>{/if}
  {/if}
{/if}
</div>
