<script lang="ts">
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import RowFilter from '$lib/ui/components/RowFilter.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import { createShelfLayout } from '$lib/ui/shelves/layout.svelte';
  import ChartView from './ChartView.svelte';
  import ChartThumbnail from './ChartThumbnail.svelte';
  import { styles, fixtures, contextOptions, getDatasetOptions, getChartPeriod, getChartModel, dataRows, supportedMediums } from './data';
  import { formatValue, type ChartContext, type ChartDataset, type ChartMedium, type ChartRow } from './types';

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
  const styleIndex = $derived(available.findIndex(item => item.id === style.id));
  const rows = $derived(dataRows(model));
  let selected = $state(0);
  let search = $state('');
  let familyFilter = $state('all');
  let tablePage = $state(0);
  let chartSection: HTMLElement;
  const pageSize = 24;
  const tableRows = $derived(rows.slice(tablePage * pageSize, (tablePage + 1) * pageSize));
  const tablePages = $derived(Math.max(1, Math.ceil(rows.length / pageSize)));
  const selection = $derived(rows[selected]);
  const families = $derived([...new Set(available.map(item => item.family))]);
  const activeFamily = $derived(families.includes(familyFilter) ? familyFilter : 'all');
  const filteredStyles = $derived(available.filter(item => (activeFamily === 'all' || item.family === activeFamily) && `${item.id} ${item.name} ${item.family}`.toLowerCase().includes(search.trim().toLowerCase())));
  const rail = createShelfLayout(() => ({ size:'poster', artworkStyle:'auto', overlay:'none', layout:'row', busy:false, preserveHeight:false, hasMore:false, resetKey:`${context}:${search}:${activeFamily}` }));
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
    const url = new URL(page.url);
    const next = { context, chart: style.id, dataset, medium, ...values };
    const nextFixture = fixtures.find(item => item.sourceId === next.chart && item.context === next.context && item.variant === next.dataset)!;
    const nextMedia = supportedMediums(nextFixture);
    next.medium = nextMedia.find(item => item === next.medium) ?? nextMedia[0];
    for (const [key, value] of Object.entries(next)) url.searchParams.set(key, value);
    await goto(url, { noScroll: true, keepFocus: true });
  }
  function changeContext(value: string) {
    const next = styles.find(item => item.id === style.id && item.contexts.includes(value as ChartContext)) ?? styles.find(item => item.contexts.includes(value as ChartContext))!;
    void change({ context: value, chart: next.id });
  }
  function select(index: number) { selected = Math.max(0, Math.min(rows.length - 1, index)); }
  async function viewStyle(id: string) {
    await change({ chart: id });
    await tick();
    chartSection?.scrollIntoView({ block: 'start' });
  }
  function rowValue(row: ChartRow) {
    return row.values?.length && model.series.length
      ? row.values.map((value, i) => `${model.series[i]?.name ?? `Series ${i + 1}`}: ${formatValue(value, model.unit)}`).join(' · ')
      : `${formatValue(row.value, row.valueUnit ?? model.unit)}${row.values?.length ? ` · Trend: ${row.values.map(value => formatValue(value)).join(', ')}` : ''}`;
  }
</script>

<section class="section chart-exploration" aria-label="Chart exploration">
  <div class="chart-header">
    <Heading title="Chart exploration" selection={{label:'Chart data context',value:context,options:contextOptions,change:changeContext}}>
      {#snippet actions()}
        <span class="small quiet">Non-approved · Demo data</span>
        {#if mediumOptions.length > 1}<RowFilter label="Chart medium" selection groups={[{label:'Medium',value:medium,options:mediumOptions,change:value=>{void change({medium:value});}}]} />{/if}
        <RowFilter label="Chart dataset" selection groups={[{label:'Dataset',value:dataset,options:datasetOptions,change:value=>{void change({dataset:value});}}]} />
        <div class="navigation">
          <Button size="icon" icon="left" iconSize={20} label="Previous chart style" disabled={styleIndex === 0} onclick={() => { void change({chart:available[styleIndex - 1].id}); }} />
          <RowFilter label="Chart style" selection groups={[{label:'Style',value:style.id,options:available.map(item=>({value:item.id,label:`${item.id} · ${item.name}`})),change:value=>{void change({chart:value});}}]} />
          <Button size="icon" icon="right" iconSize={20} label="Next chart style" disabled={styleIndex === available.length - 1} onclick={() => { void change({chart:available[styleIndex + 1].id}); }} />
        </div>
      {/snippet}
    </Heading>
  </div>

  <section bind:this={chartSection} class="chart-specimen" aria-labelledby="chart-title" data-chart-style={style.id} data-chart-fixture={fixture.id} data-chart-medium={medium}>
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
        {#if selection}<strong>{selection.label}</strong> · {rowValue(selection)}{#if selection.capacity !== undefined} / {formatValue(selection.capacity,selection.valueUnit ?? model.unit)}{/if}{#if selection.reference !== undefined} · Reference {formatValue(selection.reference,selection.referenceUnit ?? model.unit)}{/if}{#if selection.evidence !== undefined} · {selection.evidence} evidence items{/if}{#if selection.detail}<span class="quiet"> · {selection.detail}</span>{/if}{:else}No known values in this fixture.{/if}
      </p>
      <Button size="icon" icon="right" label="Next data point" disabled={selected >= rows.length - 1} onclick={() => select(selected + 1)} />
    </div>
    <div class="chart-details">
    <details class="small chart-notes"><summary>Data meaning and limits</summary><p>{model.subtitle}</p>{#each model.notes as note}<p>{note}</p>{/each}</details>
    <details class="small chart-data">
      <summary>Exact data</summary>
      <p class="quiet">{rows.length} rows · {model.unit}</p>
      <div class="table-scroll">
        <table>
          <caption class="sr-only">{model.title} · fictional data · {model.unit}</caption>
          <thead><tr><th scope="col">Item</th><th scope="col">Value</th><th scope="col">Evidence / reference</th></tr></thead>
          <tbody>{#each tableRows as row, i}<tr class:inspected={selected === tablePage * pageSize + i}>
            <th scope="row"><button type="button" aria-pressed={selected === tablePage * pageSize + i} onclick={() => select(tablePage * pageSize + i)}>{row.label}</button></th>
            <td>{rowValue(row)}</td><td>{row.detail ?? ''}{row.capacity !== undefined ? ` · Capacity ${formatValue(row.capacity,row.valueUnit ?? model.unit)}` : ''}{row.reference !== undefined ? ` · Reference ${formatValue(row.reference,row.referenceUnit ?? model.unit)}` : ''}{row.evidence !== undefined ? ` · ${row.evidence} evidence items` : ''}</td>
          </tr>{/each}</tbody>
        </table>
      </div>
      {#if tablePages > 1}<div class="row table-pagination"><Button emphasis="subtle" label="Previous data page" disabled={tablePage === 0} onclick={() => tablePage--}>Previous</Button><span class="quiet">Page {tablePage + 1} / {tablePages}</span><Button emphasis="subtle" label="Next data page" disabled={tablePage === tablePages - 1} onclick={() => tablePage++}>Next</Button></div>{/if}
    </details>
    <details class="small preview-details"><summary>About this preview</summary><p>{styles.length} explored styles · {fixtures.length} contextual fixtures. All values are fictional, local demo data. These charts are unused elsewhere in Coast.</p><p>Hover or tap a mark to inspect it. Use the previous and next data-point buttons or the exact-data table with a keyboard. Dense charts scroll within their own region.</p><p>Style thumbnails illustrate the encoding and do not display the selected dataset. Selecting a chart does not approve it for the product.</p></details>
    </div>
  </section>

  <div class="style-browser-heading"><Heading title="Browse styles" level={3}>
    {#snippet filters()}<RowFilter label="Chart family" selection groups={[{label:'Family',value:activeFamily,options:[{value:'all',label:'All families'},...families.map(value=>({value,label:value}))],change:value=>{familyFilter=value;}}]} />{/snippet}
    {#snippet actions()}<label class="field small"><span class="sr-only">Find a chart style</span><input type="search" bind:value={search} placeholder="Name or family" /></label>{/snippet}
    {#snippet navigation()}<div class="navigation"><Button size="icon" icon="left" iconSize={20} label="Scroll chart styles left" disabled={!rail.previous} onclick={()=>rail.scroll(-1)} /><Button size="icon" icon="right" iconSize={20} label="Scroll chart styles right" disabled={!rail.next} onclick={()=>rail.scroll(1)} /></div>{/snippet}
  </Heading><span class="sr-only" role="status">{filteredStyles.length} / {available.length} styles in this context</span></div>
  <nav class="style-catalog" aria-label="Chart styles">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The horizontal rail needs a keyboard focus target for scrolling.) -->
    <div class="style-rail" bind:this={rail.scroller} onscroll={rail.reachedEnd} role="region" aria-label="Chart style thumbnails; scroll horizontally" tabindex="0">
      {#each filteredStyles as item}<Button class="style-option" emphasis="subtle" label={`${item.id} · ${item.name}`} pressed={style.id === item.id} onclick={() => { void viewStyle(item.id); }}><span class="small quiet style-family">{item.family}</span><ChartThumbnail styleId={item.id} /><span class="style-name"><span class="quiet">{item.id}</span> {item.name}</span></Button>{/each}
    </div>
    {#if !filteredStyles.length}<p class="quiet">No matching chart styles.</p>{/if}
  </nav>
</section>

<style>
  .chart-exploration { min-width:0; margin-top:var(--gutter); }
  .chart-header :global(.actions) { gap:8px; }
  .navigation { display:flex; align-items:center; gap:2px; min-width:0; }
  .navigation :global(.icon-button) { width:var(--control-compact-height); height:var(--control-compact-height); color:var(--muted); }
  .navigation :global(.icon-button:disabled) { opacity:.25; }
  .chart-specimen { max-width:948px; margin:0 auto; border-bottom:1px solid var(--line); padding:16px 0 var(--gutter); min-width:0; scroll-margin-top:calc(var(--gutter) * 3); }
  .stage-title { text-align:center; margin-bottom:16px; }
  .stage-title :global(.row-header) { margin-bottom:8px; }
  .stage-title :global(.identity) { justify-content:center; }
  .chart-meta { overflow-wrap:anywhere; }
  .chart-stage { display:flex; align-items:center; min-height:360px; }
  .chart-surface { width:100%; min-width:0; max-width:var(--plot-width); margin:0 auto; position:relative; isolation:isolate; }
  .chart-surface.glass { max-width:calc(var(--plot-width) + var(--gutter) * 2); border-radius:12px; padding:var(--gutter); }
  .chart-inspect { max-width:760px; margin:16px auto 0; gap:12px; flex-wrap:nowrap; }
  .selected-value { flex:1; min-width:0; overflow-wrap:anywhere; text-align:center; }
  .chart-details { display:flex; flex-wrap:wrap; justify-content:center; align-items:flex-start; gap:12px var(--gutter); margin-top:16px; color:var(--muted); }
  .chart-details:has(details[open]) { display:block; }
  .chart-details:has(details[open]) details { margin-top:16px; }
  .chart-details p { margin-top:12px; overflow-wrap:anywhere; }
  .table-scroll { margin-top:16px; overflow:auto; }
  table { width:100%; border-collapse:collapse; text-align:left; }
  th,td { padding:12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-weight:var(--weight-semibold); }
  th button { background:transparent; border:0; padding:0; text-align:left; }
  tr.inspected { background:color-mix(in srgb,var(--accent) 8%,transparent); }
  .table-pagination { justify-content:flex-end; margin-top:12px; flex-wrap:wrap; }
  .style-browser-heading { margin:calc(var(--gutter) * 2) 0 20px; }
  .style-browser-heading input { max-width:240px; }
  .style-catalog { min-width:0; }
  .style-rail { --row-card-width:clamp(155px,14vw,210px); display:grid; grid-auto-flow:column; grid-auto-columns:min(100%,var(--row-card-width)); align-items:stretch; gap:20px; overflow:auto; padding:24px var(--gutter); margin:-24px calc(-1 * var(--gutter)); scroll-padding-inline:var(--gutter); overscroll-behavior-x:contain; scrollbar-width:none; scroll-snap-type:x proximity; }
  .style-rail :global(.style-option) { display:flex; flex-direction:column; align-items:flex-start; width:100%; min-width:0; height:100%; padding:12px 8px; border:1px solid var(--line); border-radius:8px; scroll-snap-align:start; }
  .style-rail :global(.style-option[aria-pressed=true]) { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 8%,transparent); color:var(--ink); }
  .style-family { min-height:18px; text-align:left; }
  .style-name { width:100%; min-height:36px; font-size:var(--text-sm); text-align:left; overflow-wrap:anywhere; }
  @media(max-width:600px) {
    .chart-surface.glass { padding:12px; }
    .chart-stage { min-height:0; }
    .chart-inspect { gap:4px; }
    .chart-details { justify-content:flex-start; }
    th,td { padding:8px; }
  }
  @media(max-width:500px) { .style-rail { --row-card-width:145px; gap:14px; } }
</style>
