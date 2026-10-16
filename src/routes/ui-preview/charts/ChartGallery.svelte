<script lang="ts">
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  import type { WorkspaceParts } from '../workspace';
  import Browser from '../Browser.svelte';
  import Field from '$lib/ui/components/Field.svelte';
  let {layout}: {layout:Snippet<[WorkspaceParts]>} = $props();
  import { goto } from '$app/navigation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import { chartRowContext, chartRowSummary } from './presentation';
  import ChartView from '$lib/ui/charts/ChartView.svelte';
  import ChartThumbnail from './ChartThumbnail.svelte';
  import { styles, fixtures, contextOptions, getDatasetOptions, getChartPeriod, getChartModel, dataRows, supportedMediums } from './data';
  import type { ChartContext, ChartDataset, ChartMedium } from './types';
  import { formatValue, type ChartRow } from '$lib/ui/charts/model';

  const contexts = ['P', 'T', 'S', 'M'];
  const parameters = $derived(Object.fromEntries(page.url.searchParams));
  const context = $derived((contexts.includes(parameters.context ?? '') ? parameters.context : 'P') as ChartContext);
  const available = $derived(styles.filter(style => style.contexts.includes(context)));
  const style = $derived(available.find(item => item.id === parameters.chart) ?? available[0]);
  const dataset = $derived((parameters.dataset === 'B' ? 'B' : 'A') as ChartDataset);
  const fixture = $derived(fixtures.find(item => item.sourceId === style.id && item.context === context && item.variant === dataset)!);
  const media = $derived(supportedMediums(fixture));
  const medium = $derived((media.find(item => item === parameters.medium) ?? media[0]) as ChartMedium);
  const mediumOptions = $derived(media.map(value => ({ value, label: value === 'Screen' ? 'Original dataset' : value })));
  const model = $derived(getChartModel(fixture, medium));
  const datasetOptions = $derived(getDatasetOptions(style.id, context, medium));
  const period = $derived(getChartPeriod(model));
  const rows = $derived(dataRows(model));
  let selected = $state(0);
  let navigating = $state(false);
  let familyFilter = $state('all');
  const families = $derived([...new Set(available.map(item=>item.family))]);
  const activeFamily = $derived(families.includes(familyFilter)?familyFilter:'all');
  const filteredStyles = $derived(available.filter(item=>activeFamily==='all'||item.family===activeFamily));
  let tablePage = $state(0);
  const pageSize = 24;
  const tableRows = $derived(rows.slice(tablePage * pageSize, (tablePage + 1) * pageSize));
  const tablePages = $derived(Math.max(1, Math.ceil(rows.length / pageSize)));
  const selection = $derived(rows[selected]);
  const glassStyles = new Set(['1B', '2B', '6B', '7B', '8B', '9B', '10B', '11B']);
  const glass = $derived(glassStyles.has(style.id));
  const plotWidth = $derived(Number.parseInt(style.id) <= 7 ? 900 : style.id === '14B' ? 520 : 760);
  const material = $derived({ enabled: glass, variant: 'glassDark' as const, renderer: 'css' as const, preview: true });
  function chartMaterial(node: HTMLElement, options: typeof material) {
    let action = options.enabled ? liquidGlass(node, options) : undefined;
    let enabled = options.enabled;
    return {
      update(next: typeof material) {
        if (next.enabled === enabled) return;
        enabled = next.enabled;
        action?.destroy();
        action = next.enabled ? liquidGlass(node, next) : undefined;
      },
      destroy() { action?.destroy(); },
    };
  }
  $effect(() => { model; selected = 0; tablePage = 0; });
  async function change(values: Record<string, string>) {
    if(navigating)return;
    const url = new URL(page.url);
    const next = { context, chart: style.id, dataset, medium, ...values };
    const nextFixture = fixtures.find(item => item.sourceId === next.chart && item.context === next.context && item.variant === next.dataset)!;
    const nextMedia = supportedMediums(nextFixture);
    next.medium = nextMedia.find(item => item === next.medium) ?? nextMedia[0];
    for (const [key, value] of Object.entries(next)) url.searchParams.set(key, value);
    navigating=true;
    try {await goto(url,{noScroll:true,keepFocus:true,replaceState:true});}
    finally {navigating=false;}
  }
  function changeContext(value: string) {
    const next = styles.find(item => item.id === style.id && item.contexts.includes(value as ChartContext)) ?? styles.find(item => item.contexts.includes(value as ChartContext))!;
    void change({ context: value, chart: next.id });
  }
  function select(index: number) { selected = Math.max(0, Math.min(rows.length - 1, index)); }
  function rowValue(row: ChartRow) {
    return row.values?.length && model.series.length
      ? row.values.map((value, i) => `${model.series[i]?.name ?? `Series ${i + 1}`}: ${formatValue(value, model.unit)}`).join(' · ')
      : `${formatValue(row.value, row.valueUnit ?? model.unit)}${row.values?.length ? ` · Trend: ${row.values.map(value => formatValue(value)).join(', ')}` : ''}`;
  }
</script>

{@render layout({title:style.name,canvas,inspector,browser})}
{#snippet canvas()}
  <section class="chart-specimen" aria-labelledby="chart-title" data-chart-style={style.id} data-chart-fixture={fixture.id} data-chart-medium={medium}>
    <div class="stage-title"><Heading title={model.title}>
      {#snippet heading()}<h3 id="chart-title">{model.title}</h3>{/snippet}
    </Heading><p class="small quiet chart-meta">{model.unit}{#if period} · {period}{/if}</p></div>
    <div class="chart-stage">
      <div class="chart-surface" class:glass style:--plot-width={`${plotWidth}px`} use:chartMaterial={material}>
        <ChartView {model} {selected} onselect={select} />
      </div>
    </div>
    <div class="row chart-inspect" aria-label="Inspect chart data">
      <Button size="icon" icon="left" label="Previous data point" disabled={selected <= 0} onclick={() => select(selected - 1)} />
      <p class="small selected-value" role="status" aria-live="polite" aria-atomic="true">
        {#if selection}<strong>{selection.label}</strong> · {chartRowSummary(selection, model)}{:else}No known values in this fixture.{/if}
      </p>
      <Button size="icon" icon="right" label="Next data point" disabled={selected >= rows.length - 1} onclick={() => select(selected + 1)} />
    </div>
  </section>
{/snippet}
{#snippet inspector()}
  <div class="stack">
    <Field label="Context"><select disabled={navigating} value={context} onchange={event => changeContext(event.currentTarget.value)}>{#each contextOptions as option}<option value={option.value}>{option.label}</option>{/each}</select></Field>
    {#if mediumOptions.length > 1}<Field label="Medium"><select disabled={navigating} value={medium} onchange={event => void change({medium:event.currentTarget.value})}>{#each mediumOptions as option}<option value={option.value}>{option.label}</option>{/each}</select></Field>{/if}
    <Field label="Dataset"><select disabled={navigating} value={dataset} onchange={event => void change({dataset:event.currentTarget.value})}>{#each datasetOptions as option}<option value={option.value}>{option.label}</option>{/each}</select></Field>
    <Field label="Style family"><select value={activeFamily} onchange={event=>familyFilter=event.currentTarget.value}><option value="all">All families</option>{#each families as family}<option value={family}>{family}</option>{/each}</select></Field>
    <p class="small quiet">{style.id} · {style.family} · Fictional preview data</p>
    <div class="chart-details">
    <details class="small chart-notes"><summary>Data meaning and limits</summary><p>{model.subtitle}</p>{#each model.notes as note}<p>{note}</p>{/each}</details>
    <details class="small chart-data">
      <summary>Exact data</summary>
      <p class="quiet">{rows.length} rows · {model.unit}</p>
      <div class="table-scroll">
        <table class="chart-table">
          <caption class="sr-only">{model.title} · fictional data · {model.unit}</caption>
          <thead><tr><th scope="col">Item</th><th scope="col">Value</th><th scope="col">Evidence / reference</th></tr></thead>
          <tbody>{#each tableRows as row, i}<tr class:inspected={selected === tablePage * pageSize + i}>
            <th scope="row"><button type="button" aria-pressed={selected === tablePage * pageSize + i} onclick={() => select(tablePage * pageSize + i)}>{row.label}</button></th>
            <td>{rowValue(row)}</td><td>{row.capacity !== undefined ? `Capacity ${formatValue(row.capacity,row.valueUnit ?? model.unit)}` : ''}{row.capacity !== undefined && chartRowContext(row, model.unit) ? ' · ' : ''}{chartRowContext(row, model.unit)}</td>
          </tr>{/each}</tbody>
        </table>
      </div>
      {#if tablePages > 1}<div class="row table-pagination"><Button emphasis="subtle" label="Previous data page" disabled={tablePage === 0} onclick={() => tablePage--}>Previous</Button><span class="quiet">Page {tablePage + 1} / {tablePages}</span><Button emphasis="subtle" label="Next data page" disabled={tablePage === tablePages - 1} onclick={() => tablePage++}>Next</Button></div>{/if}
    </details>
    <details class="small preview-details"><summary>About this preview</summary><p>{styles.length} explored styles · {fixtures.length} contextual fixtures. All values are fictional, local demo data. These fictional datasets stay in the preview.</p><p>Hover or tap a mark to inspect it. Use the previous and next data-point buttons or the exact-data table with a keyboard. Dense charts scroll within their own region.</p><p>Style thumbnails illustrate the encoding and do not display the selected dataset. Selecting a chart does not approve it for the product.</p></details>
    </div>
  </div>
{/snippet}
{#snippet browser()}
  <Browser title="Browse styles" options={filteredStyles.map(item=>({value:item.id,label:item.name,detail:item.family}))} value={style.id} change={value=>void change({chart:value})} thumbnailHeight={48} disabled={navigating}>
    {#snippet thumbnail(option)}<ChartThumbnail styleId={option.value} height={48} />{/snippet}
  </Browser>
{/snippet}

<style>
  .chart-specimen {width:100%;max-width:1100px;margin:0 auto;padding:20px;min-width:0;}
  .stage-title { text-align:center; margin-bottom:16px; }
  .stage-title :global(.row-header) { margin-bottom:8px; }
  .stage-title :global(.identity) { justify-content:center; }
  .chart-meta { overflow-wrap:anywhere; }
  .chart-stage { display:flex; align-items:center; min-height:360px; }
  .chart-surface { width:100%; min-width:0; max-width:calc(var(--plot-width) + var(--chart-inset) * 2 + var(--chart-frame-padding) * 2); padding:var(--chart-frame-padding); margin:0 auto; position:relative; isolation:isolate; }
  .chart-surface.glass { border-radius:var(--chart-frame-radius); }
  .chart-inspect { max-width:760px; margin:16px auto 0; gap:12px; flex-wrap:nowrap; }
  .selected-value { flex:1; min-width:0; overflow-wrap:anywhere; text-align:center; font-variant-numeric:tabular-nums; }
  .selected-value strong { font-weight:var(--weight-semibold); }
  .chart-details { display:flex; flex-wrap:wrap; justify-content:center; align-items:flex-start; gap:12px var(--gutter); margin-top:16px; color:var(--muted); }
  .chart-details:has(details[open]) { display:block; }
  .chart-details:has(details[open]) details { margin-top:16px; }
  .chart-details p { margin-top:12px; overflow-wrap:anywhere; }
  .table-scroll { margin-top:16px; overflow:auto; }
  table { width:100%; text-align:left; }
  th,td { padding:12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-weight:var(--weight-semibold); }
  th button { background:transparent; border:0; padding:0; text-align:left; }
  .table-pagination { justify-content:flex-end; margin-top:12px; flex-wrap:wrap; }
  @media(max-width:600px) {
    .chart-stage { min-height:0; }
    .chart-inspect { gap:4px; }
    .chart-details { justify-content:flex-start; }
    th,td { padding:8px; }
  }
</style>
