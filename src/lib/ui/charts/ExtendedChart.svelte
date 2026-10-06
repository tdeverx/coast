<script lang="ts">
  import ChartMark from './ChartMark.svelte';
  import { chartColors, chartCategoryColor, chartFill, formatValue, mediumColor, type ChartModel, type ChartRow } from './model';
  import { isotypeFractions, layoutBubbles, layoutFlows, partitionTreemap, radialLength, radialSector } from './extended-geometry';

  let { model, selected, onselect }: { model: ChartModel; selected: number; onselect: (index: number) => void } = $props();
  const instance = $props.id();
  const chartWidth = 760;
  const label = (row: ChartRow) => `${row.group ? `${row.group} · ` : ''}${row.label}: ${formatValue(row.value, row.valueUnit ?? model.unit)}${row.detail ? `; ${row.detail}` : ''}`;
  const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
  const colour = (index: number) => mediumColor(model.rows[index]?.medium, model.rows[index]?.label);
  const fraction = (value: number, domain: [number, number]) => Math.max(0, Math.min(1, (value - domain[0]) / Math.max(0.001, domain[1] - domain[0])));
  // Selection changes must not repeat wrapping for every SVG label. Reset this
  // small component-local cache when the model changes, rather than retaining
  // labels from previously visited datasets indefinitely.
  const wrappedLabels = $derived.by(() => { model; return new Map<string, string[]>(); });
  function lines(value: string, max = 20) {
    const key = `${max}:${value}`;
    const cached = wrappedLabels.get(key);
    if (cached) return cached;
    const words = value.split(' ');
    const output = [''];
    for (const word of words) {
      const current = output.length - 1;
      if (output[current] && output[current].length + word.length + 1 > max) output.push(word);
      else output[current] += `${output[current] ? ' ' : ''}${word}`;
    }
    const result = output.slice(0, 2).map((line, index) => index === 1 && output.length > 2 ? `${line}…` : line);
    wrappedLabels.set(key, result);
    return result;
  }

  let tableColumns = $derived(Array.isArray(model.raw.cols) ? model.raw.cols.map(String) : ['Item', 'Value', 'Trend', 'Detail']);
  let rawTableRows = $derived(Array.isArray(model.raw.rows) ? model.raw.rows as unknown[][] : []);
  let sparkDomain = $derived(model.domain);
  function sparkPath(values: (number | null)[]) {
    return values.map((value, index) => value === null ? '' : `${index && values[index - 1] !== null ? 'L' : 'M'}${8 + index * 164 / Math.max(1, values.length - 1)},${44 - fraction(value, sparkDomain) * 36}`).join(' ');
  }
  const sparkPaths = $derived(model.styleId.startsWith('8') ? model.rows.map(row => sparkPath(row.values ?? [])) : []);
  let timeline = $derived.by(() => {
    if (!model.styleId.startsWith('9')) return { month: 'Sep', maximum: 30, asOf: null as number | null };
    const firstDate = model.events[0]?.date ?? '2026-09-01';
    const [year, month] = firstDate.split('-').map(Number);
    const maximum = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const name = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
    const asOf = typeof model.raw.asOf === 'string' ? Number(model.raw.asOf.slice(-2)) : null;
    return { month: name, maximum, asOf };
  });
  const eventX = (day: number) => 54 + (day - 1) / Math.max(1, timeline.maximum - 1) * 652;
  function eventColour(index: number) {
    const event = model.events[index];
    const originals = Array.isArray(model.raw.events) ? model.raw.events as Record<string, unknown>[] : [];
    const named = text(originals[index]?.colour);
    if (named === 'mint' || event.state === 'watched' || event.state === 'completed' || event.state === 'released') return 'var(--success)';
    if (named === 'peach' || event.state === 'rated') return 'var(--danger)';
    return 'var(--accent)';
  }
  let tree = $derived.by(() => {
    if (!model.styleId.startsWith('10')) return { cells: [], groups: [] };
    const items = model.rows.map((row, index) => ({ index, value: row.value ?? 0 }));
    if (model.styleId === '10A') return { cells: partitionTreemap(items, { x: 20, y: 24, width: 720, height: 330 }), groups: [] };
    const names = [...new Set(model.rows.map((row) => row.group ?? 'Total'))];
    const groups = names.map((name, index) => ({ index, name, value: model.rows.reduce((sum, row) => sum + (row.group === name || !row.group && name === 'Total' ? row.value ?? 0 : 0), 0) }));
    const total = groups.reduce((sum, group) => sum + group.value, 0);
    let x = 20;
    const positioned = groups.map((group) => {
      const width = 720 * group.value / Math.max(1, total);
      const position = { ...group, x, width };
      x += width;
      return position;
    });
    return { groups: positioned, cells: positioned.flatMap((group) => partitionTreemap(items.filter((item) => (model.rows[item.index].group ?? 'Total') === group.name), { x: group.x, y: 64, width: group.width, height: 290 })) };
  });
  let bullet = $derived.by(() => {
    const raw = model.raw;
    const domain: [number, number] = [number(raw.min), number(raw.max, model.domain[1])];
    const ranges = Array.isArray(raw.ranges) ? raw.ranges.filter(Array.isArray).map((range) => [number(range[0]), number(range[1])] as [number, number])
      : Array.isArray(raw.referenceBands) ? [domain[0], ...raw.referenceBands.map((value) => number(value)), domain[1]].slice(0, -1).map((start, index, starts) => [start, index + 1 < starts.length ? starts[index + 1] : domain[1]] as [number, number]) : [];
    const referenceLabel = text(raw.referenceLabel, text(raw.comparisonPeriod, raw.previous !== undefined ? 'Previous run' : raw.comparison !== undefined ? 'Comparison' : 'Reference'));
    return { domain, ranges, referenceLabel, budget: typeof raw.budget === 'number' ? raw.budget : null };
  });
  const bulletX = (value: number) => 64 + fraction(value, bullet.domain) * 632;
  let funnel = $derived.by(() => {
    if (!model.styleId.startsWith('12')) return [];
    const maximum = Math.max(1, model.rows[0]?.value ?? 0);
    const values = model.rows.map((row) => row.value ?? 0);
    const width = 560;
    return values.map((value, index) => {
      // Equal-height trapezoids have an exact proportional area: mean width is value/max.
      const next = values[index + 1] ?? value;
      const taper = Math.min(value * 0.14, Math.max(0, value - next) * 0.35);
      const top = width * (value + taper) / maximum;
      const bottom = width * (value - taper) / maximum;
      const y = 28 + index * 110;
      return { index, value, percent: value / maximum * 100, top, bottom, y, path: `M${380 - top / 2},${y} L${380 + top / 2},${y} L${380 + bottom / 2},${y + 76} L${380 - bottom / 2},${y + 76} Z` };
    });
  });
  let bubbles = $derived.by(() => model.styleId.startsWith('13') ? layoutBubbles(model.rows, model.styleId === '13B' ? 'editorial' : model.styleId === '13A' ? 'playful' : 'packed', { x: 24, y: 26, width: 712, height: model.styleId === '13B' ? 250 : 350 }) : []);
  let bubbleMaximum = $derived(model.styleId.startsWith('13') ? Math.max(1, ...model.rows.map(row => row.value ?? 0)) : 1);
  let flow = $derived.by(() => model.styleId === '14A' ? layoutFlows(model.flows, { x: 128, y: 30, width: 488, height: 330 }) : { nodes: [], ribbons: [], scale: 1 });
  let radialMaximum = $derived(Math.max(1, model.domain[1], ...model.rows.map((row) => row.value ?? 0)));
  let radialTicks = $derived(model.ticks.filter((tick) => tick > 0 && tick <= radialMaximum));
  let units = $derived.by(() => model.styleId === '14C' ? model.rows.map((row) => isotypeFractions(row.value ?? 0, model.symbolUnit ?? 1, row.capacity)) : []);
  let unitColumns = $derived(Math.max(1, Math.min(16, Math.max(...units.map((row) => row.length)))));
  let unitRows = $derived.by(() => {
    let y = 56;
    return units.map((symbols) => {
      const current = y;
      y += Math.max(1, Math.ceil(symbols.length / unitColumns)) * 30 + 32;
      return current;
    });
  });
  let unitHeight = $derived(Math.max(220, (unitRows.at(-1) ?? 56) + Math.max(1, Math.ceil((units.at(-1)?.length ?? 1) / unitColumns)) * 30 + 36));
  const nodeColour = (value: string) => /completed|available/i.test(value) ? 'var(--success)' : /failed/i.test(value) ? 'var(--danger)' : /cancelled|not started|unwatched/i.test(value) ? 'var(--muted)' : chartCategoryColor(value);
</script>

{#snippet symbol(x: number, y: number, size: number, kind: string)}
  <g class="unit-symbol" transform={`translate(${x},${y}) scale(${size / 24})`} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if kind.toLowerCase().includes('music')}
      <path d="M9 17V5l10-2v12M9 7l10-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="16" cy="16" rx="3" ry="2"/>
    {:else if kind.toLowerCase().includes('game')}
      <path d="M7 6h10c3 0 4 4 5 11 .3 3-2 4-4 1l-2-2H8l-2 2c-2 3-4.3 2-4-1C3 10 4 6 7 6Z"/><path d="M7 9v5m-2.5-2.5h5M16 10h.01M18 12h.01"/>
    {:else}
      <rect x="2" y="3" width="20" height="18" rx="2"/><path d="M6 3v18M18 3v18M2 8h4m-4 8h4M18 8h4m-4 8h4"/>
    {/if}
  </g>
{/snippet}

{#if model.styleId.startsWith('8')}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow regions support keyboard scrolling.) -->
  <div class="chart-scroll" tabindex="0" role="region" aria-label="Ranked chart table; scroll horizontally on smaller screens">
    <table class="table chart-table ranked-table">
      <thead><tr><th scope="col">#</th>{#each tableColumns as column}<th scope="col">{column}</th>{/each}</tr></thead>
      <tbody>
        {#each model.rows as row, index}
          <tr class:chosen={selected === index}>
            <td class="muted">{index + 1}</td>
            <th scope="row"><button class="rank-select" aria-pressed={selected === index} onpointerenter={() => onselect(index)} onfocus={() => onselect(index)} onclick={() => onselect(index)}>{row.label}</button></th>
            <td class="primary-value">{rawTableRows[index]?.[1] ?? formatValue(row.value)}</td>
            <td>
              <svg class="sparkline" viewBox="0 0 180 52" role="img" aria-label={`${row.label}; common scale ${sparkDomain[0]}–${sparkDomain[1]}; ${(row.values ?? []).join(', ')}`}>
                <line x1="8" x2="172" y1="44" y2="44" class="axis"/>
                <path d={sparkPaths[index]} fill="none" stroke={colour(index)} stroke-width="2" vector-effect="non-scaling-stroke"/>
                {#each row.values ?? [] as value, point}{#if value !== null}<circle cx={8 + point * 164 / Math.max(1, (row.values?.length ?? 1) - 1)} cy={44 - fraction(value, sparkDomain) * 36} r="2.5" fill={colour(index)}/>{/if}{/each}
              </svg>
            </td>
            <td>{rawTableRows[index]?.[3] ?? row.detail ?? '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="chart-caption">Sparklines share the {sparkDomain[0]}–{sparkDomain[1]} scale. {model.xLabel}</p>
{:else if model.styleId.startsWith('9')}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow regions support keyboard scrolling.) -->
  <div class="chart-scroll" tabindex="0" role="region" aria-label="Dated event timeline; scroll horizontally on smaller screens">
    <svg class:dense={model.events.length > 5} viewBox="0 0 760 280" role="group" aria-label={`${model.title}; exact date positions in ${timeline.month} 2026`}>
      {#if model.styleId === '9B'}<rect x="20" y="22" width="720" height="230" class="rounded-frame" fill="var(--surface)" fill-opacity=".7"/>{/if}
      <line x1="54" x2="706" y1="134" y2="134" class="axis"/>
      {#each [1, 8, 15, 22, timeline.maximum] as day}
        <line x1={eventX(day)} x2={eventX(day)} y1={model.styleId === '9B' ? 48 : 126} y2={model.styleId === '9B' ? 238 : 142} class="axis" stroke-dasharray={model.styleId === '9B' ? '4 6' : undefined}/>
        <text x={eventX(day)} y={model.styleId === '9B' ? 40 : 164} text-anchor="middle" class="muted-text">{day} {timeline.month}</text>
      {/each}
      {#if timeline.asOf !== null}
        <line x1={eventX(timeline.asOf)} x2={eventX(timeline.asOf)} y1="56" y2="234" stroke="var(--danger)" stroke-dasharray="4 5" vector-effect="non-scaling-stroke"/>
        <text x={eventX(timeline.asOf)} y="264" text-anchor="middle" fill="var(--danger)">As of {timeline.asOf} {timeline.month}</text>
      {/if}
      {#each model.events as event, index}
        {@const x = eventX(event.day)}
        {@const above = model.styleId === '9A' && index % 2 === 0}
        {@const outlined = event.state === 'saved' || event.state === 'announced'}
        <ChartMark {index} {selected} {onselect} label={`${event.label}; ${event.date ?? `${event.day} ${timeline.month}`}; ${event.detail}${event.state ? `; ${event.state}` : ''}`}>
          <circle cx={x} cy="134" r="19" fill="var(--surface)" fill-opacity=".01"/>
          {#if selected === index}<circle cx={x} cy="134" r="15" fill="none" stroke="var(--ink)" stroke-width="2" vector-effect="non-scaling-stroke"/>{/if}
          <circle cx={x} cy="134" r={model.styleId === '9B' ? 9 : 7} fill={outlined ? 'var(--canvas)' : eventColour(index)} stroke={eventColour(index)} stroke-width="2" vector-effect="non-scaling-stroke"/>
          {#if model.styleId === '9A'}<line x1={x} x2={x} y1={above ? 125 : 143} y2={above ? 94 : 193} stroke={eventColour(index)} vector-effect="non-scaling-stroke"/>{/if}
          {#each lines(event.label, model.styleId === '9B' ? 12 : 24) as line, lineIndex}
            <text x={x} y={(above ? 61 - (lines(event.label, 24).length - 1) * 17 : model.styleId === '9B' ? 167 : 214) + lineIndex * 17} text-anchor="middle" class="strong-text">{line}</text>
          {/each}
          <text x={x} y={above ? 82 : model.styleId === '9B' ? 204 : 250} text-anchor="middle" class="muted-text">{model.styleId === '9B' ? `${event.day} ${timeline.month} · ${event.state ?? event.detail}` : event.detail}</text>
        </ChartMark>
      {/each}
    </svg>
  </div>
{:else if model.styleId.startsWith('10')}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow regions support keyboard scrolling.) -->
  <div class="chart-scroll" tabindex="0" role="region" aria-label="Proportional treemap; scroll horizontally on smaller screens">
  <svg viewBox="0 0 760 378" role="group" aria-label={`${model.title}; rectangle area is proportional to the exact value`}>
    {#each tree.groups as group}
      <text x={group.x + 10} y="30" class="strong-text">{group.name}</text>
      <text x={group.x + 10} y="50" class="muted-text">{formatValue(group.value)}</text>
    {/each}
    <defs><clipPath id={`${instance}-tree-frame`}><rect class="rounded-frame" x="20" y={model.styleId === '10A' ? 24 : 64} width="720" height={model.styleId === '10A' ? 330 : 290} /></clipPath></defs>
    <g clip-path={`url(#${instance}-tree-frame)`}>
    {#each tree.cells as cell}
      {@const row = model.rows[cell.index]}
      <ChartMark index={cell.index} {selected} {onselect} label={label(row)}>
        <rect x={cell.x} y={cell.y} width={cell.width} height={cell.height} class="chart-shape" fill={chartFill(colour(cell.index))} stroke={selected === cell.index ? 'var(--ink)' : 'var(--canvas)'} stroke-width="1.5" vector-effect="non-scaling-stroke"/>
        {#if cell.width >= 62 && cell.height >= 40}
          {#each lines(row.label, Math.max(7, Math.floor((cell.width - 20) / 8))) as line, lineIndex}<text x={cell.x + 12} y={cell.y + 24 + lineIndex * 17} class="tile-label">{line}</text>{/each}
          {#if cell.height >= 80}<text x={cell.x + 12} y={cell.y + 66} class="tile-value">{formatValue(row.value)}</text>{/if}
        {/if}
      </ChartMark>
    {/each}
    </g>
  </svg>
  </div>
{:else if model.styleId.startsWith('11')}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow regions support keyboard scrolling.) -->
  <div class="chart-scroll" tabindex="0" role="region" aria-label="Bullet chart with numeric reference; scroll horizontally on smaller screens">
  <svg viewBox={`0 0 ${chartWidth} 290`} role="group" aria-label={`${model.title}; value and labeled reference on a common scale`}>
    {#each model.rows as row, index}
      <ChartMark {index} {selected} {onselect} label={label(row)}>
        <defs><clipPath id={`${instance}-reference-track-${index}`}><rect class="rounded-frame" x="64" y="78" width="632" height="104" /></clipPath></defs>
        <g clip-path={`url(#${instance}-reference-track-${index})`}>
        <rect x="64" y="78" width="632" height="104" fill="var(--surface)"/>
        {#if model.styleId === '11B'}
          {#each bullet.ranges as range, rangeIndex}<rect x={bulletX(range[0])} y="78" width={bulletX(range[1]) - bulletX(range[0])} height="104" fill={chartColors[rangeIndex % chartColors.length]} fill-opacity=".12"/>{/each}
        {/if}
        </g>
        {#if row.value !== null}<rect x="64" y="113" width={Math.max(0, bulletX(row.value) - 64)} height="32" class="rounded-mark chart-shape" fill={colour(index)}/>{/if}
        {#if row.reference !== undefined}
          {#if model.styleId === '11B'}<circle cx={bulletX(row.reference)} cy="96" r="6" fill="none" stroke="var(--danger)" stroke-width="2" vector-effect="non-scaling-stroke"/>
          {:else}<line x1={bulletX(row.reference)} x2={bulletX(row.reference)} y1="78" y2="182" stroke="var(--success)" stroke-width="3" vector-effect="non-scaling-stroke"/>{/if}
          <text x={bulletX(row.reference)} y="54" text-anchor="middle" class="muted-text">{bullet.referenceLabel}: {formatValue(row.reference)}</text>
        {/if}
        {#if bullet.budget !== null}<line x1={bulletX(bullet.budget)} x2={bulletX(bullet.budget)} y1="68" y2="182" stroke="var(--success)" stroke-width="2" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/><text x={bulletX(bullet.budget)} y="30" text-anchor="middle" fill="var(--success)">Budget {formatValue(bullet.budget)}</text>{/if}
        <text x="64" y="232" class="strong-text">Current {formatValue(row.value)}</text>
      </ChartMark>
    {/each}
    {#each model.ticks.filter((tick) => tick >= bullet.domain[0] && tick <= bullet.domain[1]) as tick}<line x1={bulletX(tick)} x2={bulletX(tick)} y1="182" y2="190" class="axis"/><text x={bulletX(tick)} y="211" text-anchor="middle" class="muted-text">{formatValue(tick)}</text>{/each}
    <text x="380" y="270" text-anchor="middle" class="muted-text">{model.unit}</text>
  </svg>
  </div>
{:else if model.styleId === '12A'}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow regions support keyboard scrolling.) -->
  <div class="chart-scroll" tabindex="0" role="region" aria-label="Proportional funnel; scroll horizontally on smaller screens">
  <svg viewBox={`0 0 760 ${Math.max(250, funnel.length * 110 + 16)}`} role="group" aria-label={`${model.title}; stage area is proportional to count; percentages use the original cohort`}>
    {#each funnel as stage}
      <ChartMark index={stage.index} {selected} {onselect} label={label(model.rows[stage.index])}>
        <path d={stage.path} class="chart-shape" fill={chartFill(colour(stage.index))} stroke={selected === stage.index ? 'var(--ink)' : 'var(--canvas)'} stroke-width="2" vector-effect="non-scaling-stroke"/>
        <text x="380" y={stage.y + 32} text-anchor="middle" class="tile-label">{model.rows[stage.index].label}</text>
        <text x="380" y={stage.y + 57} text-anchor="middle" class="tile-label">{formatValue(stage.value)} · {formatValue(stage.percent, '%')}</text>
      </ChartMark>
      {#if stage.index < funnel.length - 1}<text x="380" y={stage.y + 98} text-anchor="middle" class="muted-text">{formatValue((funnel[stage.index + 1].value / Math.max(1, stage.value)) * 100, '%')} continue</text>{/if}
    {/each}
  </svg>
  </div>
{:else if model.styleId === '12B'}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow regions support keyboard scrolling.) -->
  <div class="chart-scroll" tabindex="0" role="region" aria-label="Stepped retention chart; scroll horizontally on smaller screens">
  <svg viewBox="0 0 760 350" role="group" aria-label={`${model.title}; linear stage heights and exact cohort drop-offs`}>
    {#each [0, 0.25, 0.5, 0.75, 1] as share}<line x1="64" x2="706" y1={270 - 210 * share} y2={270 - 210 * share} class="grid-line"/><text x="52" y={274 - 210 * share} text-anchor="end" class="muted-text">{formatValue((model.rows[0]?.value ?? 0) * share)}</text>{/each}
    {#each model.rows as row, index}
      {@const width = 642 / Math.max(1, model.rows.length)}
      {@const height = 210 * (row.value ?? 0) / Math.max(1, model.rows[0]?.value ?? 0)}
      {@const x = 64 + index * width}
      <ChartMark {index} {selected} {onselect} label={label(row)}>
        <rect {x} y={270 - height} {width} {height} class="chart-shape" fill={chartFill(colour(index))} stroke={selected === index ? 'var(--ink)' : 'var(--canvas)'} stroke-width={selected === index ? 2 : 0} vector-effect="non-scaling-stroke"/>
        <text x={x + width / 2} y={254 - height} text-anchor="middle" class="strong-text">{formatValue(row.value)} · {formatValue((row.value ?? 0) / Math.max(1, model.rows[0]?.value ?? 0) * 100, '%')}</text>
        {#each lines(row.label, 24) as line, lineIndex}<text x={x + width / 2} y={294 + lineIndex * 17} text-anchor="middle">{line}</text>{/each}
      </ChartMark>
      {#if index > 0}<text x={x + 8} y={Math.max(28, 250 - height)} class="muted-text">−{formatValue((model.rows[index - 1].value ?? 0) - (row.value ?? 0))}</text>{/if}
    {/each}
  </svg>
  </div>
{:else if model.styleId.startsWith('13')}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow regions support keyboard scrolling.) -->
  <div class="chart-scroll wide-chart" tabindex="0" role="region" aria-label="Proportional circle chart; scroll horizontally on smaller screens">
    <svg class:dense={model.styleId === '13B' && model.rows.length > 6} viewBox={`0 0 760 ${model.styleId === '13B' ? 350 : 410}`} role="group" aria-label={`${model.title}; circle area proportional to value; unknown values omitted from area encoding`}>
      {#each bubbles as bubble}
        {@const row = model.rows[bubble.index]}
        <ChartMark index={bubble.index} {selected} {onselect} label={label(row)}>
          <circle cx={bubble.x} cy={bubble.y} r={bubble.radius} class="chart-shape" fill={chartFill(colour(bubble.index))} stroke={selected === bubble.index ? 'var(--ink)' : 'var(--canvas)'} stroke-width="2" vector-effect="non-scaling-stroke"/>
          {#if model.styleId === '13A' && bubble.radius >= 56}<g color="var(--chart-on-fill)">{@render symbol(bubble.x - 12, bubble.y - 50, 24, row.medium ?? 'screen')}</g>{/if}
          <text x={bubble.x} y={bubble.y + (model.styleId === '13B' ? 6 : 30)} text-anchor="middle" class="bubble-value">{formatValue(row.value)}</text>
          {#each lines(row.label, Math.max(9, Math.floor(bubble.radius / 4))) as line, lineIndex}
            <text x={bubble.x} y={(model.styleId === '13B' ? 302 : bubble.y - 12) + lineIndex * 17} text-anchor="middle" class={model.styleId === '13B' ? 'circle-caption' : 'bubble-label'}>{line}</text>
          {/each}
        </ChartMark>
      {/each}
    </svg>
  </div>
  <div class="compact-chart compact-bubbles" aria-label="Proportional circles; equal plot sizes preserve area comparisons">
    {#each model.rows as row, index}
      {#if row.value !== null}
        <button type="button" class="bubble-tile chart-mark" aria-label={label(row)} aria-pressed={selected === index} onpointerenter={() => onselect(index)} onfocus={() => onselect(index)} onclick={() => onselect(index)}>
          <svg viewBox="0 0 160 160" aria-hidden="true">
            <circle class="chart-shape" cx="80" cy="80" r={68 * Math.sqrt(Math.max(0, row.value) / bubbleMaximum)} fill={chartFill(colour(index))} />
          </svg>
          <span>{row.label}</span><strong>{formatValue(row.value)}</strong>
        </button>
      {/if}
    {/each}
  </div>
  {#if model.rows.some((row) => row.value === null)}
    <div class="unknown-scores">{#each model.rows as row, index}{#if row.value === null}<button class="button" aria-pressed={selected === index} onpointerenter={() => onselect(index)} onfocus={() => onselect(index)} onclick={() => onselect(index)}>{row.label}: Unknown{row.evidence !== undefined ? ` · ${row.evidence} evidence items` : ''}</button>{/if}{/each}</div>
  {/if}
  <p class="chart-caption">Circle area = {model.unit}. {model.rows.some((row) => row.value === null) ? 'Unknown scores have insufficient evidence and no encoded area.' : ''}</p>
{:else if model.styleId === '14A'}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow regions support keyboard scrolling.) -->
  <div class="chart-scroll" tabindex="0" role="region" aria-label="Count-conserving flow chart; scroll horizontally on smaller screens">
    <svg class="dense" viewBox="0 0 760 400" role="group" aria-label={`${model.title}; every ribbon and node uses the same count scale`}>
      {#each flow.ribbons as ribbon}
        <ChartMark index={ribbon.index} {selected} {onselect} label={`${ribbon.source.label} → ${ribbon.target.label}: ${formatValue(ribbon.value, model.unit)}`}>
          <path class="chart-shape" d={ribbon.path} fill={nodeColour(ribbon.source.label)} fill-opacity={selected === ribbon.index ? .85 : .4} stroke={selected === ribbon.index ? 'var(--ink)' : 'none'} stroke-width="1" vector-effect="non-scaling-stroke"/>
        </ChartMark>
      {/each}
      {#each flow.nodes as node}
        <rect class="rounded-cell" x={node.x} y={node.y} width="12" height={node.height} fill={nodeColour(node.label)}><title>{node.label}: {node.value}</title></rect>
        {#each lines(node.label, node.column === 0 ? 16 : 18) as line, lineIndex}<text x={node.column === 0 ? node.x - 8 : node.x + 20} y={node.y + node.height / 2 - 3 + lineIndex * 17} text-anchor={node.column === 0 ? 'end' : 'start'} class="strong-text">{line}</text>{/each}
        <text x={node.column === 0 ? node.x - 8 : node.x + 20} y={node.y + node.height / 2 + 18 + (lines(node.label, 18).length - 1) * 17} text-anchor={node.column === 0 ? 'end' : 'start'} class="muted-text">{formatValue(node.value)}</text>
      {/each}
      <text x="380" y="390" text-anchor="middle" class="muted-text">Ribbon thickness = {model.unit}; equal scale at both ends</text>
    </svg>
  </div>
{:else if model.styleId === '14B'}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow regions support keyboard scrolling.) -->
  <div class="chart-scroll" tabindex="0" role="region" aria-label="Linear radial chart; scroll horizontally on smaller screens">
  <svg class="radial-chart" viewBox="0 0 520 454" role="group" aria-label={`${model.title}; radial length is linear from zero to ${radialMaximum}; equal counts have equal lengths`}>
    {#each radialTicks as tick}<circle cx="260" cy="220" r={radialLength(tick, radialMaximum, 42, 148)} class="grid-line" fill="none"/><text x="267" y={214 - radialLength(tick, radialMaximum, 42, 148)} class="muted-text">{tick}</text>{/each}
    {#each model.rows as row, index}
      {@const angle = -Math.PI / 2 + index * 2 * Math.PI / model.rows.length}
      {@const radius = radialLength(row.value ?? 0, radialMaximum, 42, 148)}
      <ChartMark {index} {selected} {onselect} label={label(row)}>
        <path d={radialSector(260, 220, 42, radius, angle - Math.PI / model.rows.length + .045, angle + Math.PI / model.rows.length - .045)} class="chart-shape" fill={chartFill(colour(index))} stroke={selected === index ? 'var(--ink)' : 'var(--canvas)'} stroke-width="1.5" vector-effect="non-scaling-stroke"/>
        <text x={260 + 174 * Math.cos(angle)} y={224 + 174 * Math.sin(angle)} text-anchor="middle" class="strong-text">{row.label}</text>
        <text x={260 + 199 * Math.cos(angle)} y={224 + 199 * Math.sin(angle)} text-anchor="middle" class="muted-text">{formatValue(row.value)}</text>
      </ChartMark>
    {/each}
    <circle cx="260" cy="220" r="40" fill="var(--surface)"/>
    <text x="260" y="216" text-anchor="middle" class="strong-text">{text(model.raw.year, String(number(model.raw.year, 2026)))}</text>
    <text x="260" y="236" text-anchor="middle" class="muted-text">{formatValue(model.total ?? model.rows.reduce((sum, row) => sum + (row.value ?? 0), 0))} total</text>
    <text x="260" y="449" text-anchor="middle" class="muted-text">Linear radius · zero at the inner ring · {model.unit}</text>
  </svg>
  </div>
{:else if model.styleId === '14C'}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable overflow regions support keyboard scrolling.) -->
  <div class="chart-scroll" tabindex="0" role="region" aria-label="Exact unit chart; scroll horizontally on smaller screens">
    <svg class:dense={unitColumns > 10} viewBox={`0 0 760 ${unitHeight}`} role="group" aria-label={`${model.title}; each full symbol represents ${model.symbolUnit ?? 1} ${model.unit}; partial symbols represent fractional units`}>
      <text x="24" y="24" class="muted-text">Each symbol = {model.symbolUnit ?? 1} {model.unit}</text>
      {#each model.rows as row, index}
        <ChartMark {index} {selected} {onselect} label={label(row)}>
          <rect class="rounded-mark" x="16" y={unitRows[index] - 6} width="726" height={Math.max(1, Math.ceil(units[index].length / unitColumns)) * 30 + 4} fill="var(--surface)" fill-opacity={selected === index ? .5 : .01} rx="8"/>
          <text x="24" y={unitRows[index] + 19} class="strong-text">{row.label}</text>
          {#each units[index] as share, symbolIndex}
            {@const x = 208 + symbolIndex % unitColumns * 28}
            {@const y = unitRows[index] + Math.floor(symbolIndex / unitColumns) * 30}
            {#if share < 1}
              <g color="var(--quiet)">{@render symbol(x, y, 22, row.medium ?? text(model.raw.medium))}</g>
            {/if}
            {#if share > 0}
              <defs><clipPath id={`${instance}-unit-${index}-${symbolIndex}`}><rect {x} {y} width={22 * share} height="22"/></clipPath></defs>
              <g color={colour(index)} clip-path={`url(#${instance}-unit-${index}-${symbolIndex})`}>{@render symbol(x, y, 22, row.medium ?? text(model.raw.medium))}</g>
            {/if}
          {/each}
          <text x="724" y={unitRows[index] + 19} text-anchor="end" class="strong-text">{formatValue(row.value)}{row.capacity !== undefined ? ` / ${row.capacity}` : ''}</text>
        </ChartMark>
      {/each}
    </svg>
  </div>
  {#if model.rows.some((row) => row.capacity !== undefined)}<p class="chart-caption">Quiet outlines represent declared eligible capacity.</p>{/if}
{/if}

<style>
  svg { display: block; width: 100%; overflow: visible; }
  svg:not(.sparkline) { min-width: 760px; }
  .compact-bubbles svg { min-width: 0; }
  .unit-symbol :is(path, rect, ellipse) { vector-effect: non-scaling-stroke; }
  .dense { min-width: 660px; }
  svg.radial-chart { min-width: 520px; max-width: 680px; margin-inline: auto; }
  .ranked-table { min-width: 580px; }
  .ranked-table td, .ranked-table th { padding: var(--chart-gap) 8px; font-size: var(--text-md); }
  .ranked-table tbody th { color: var(--chart-label); }
  .primary-value { white-space: nowrap; font-weight: var(--weight-semibold); }
  .rank-select { border: 0; padding: 4px 0; text-align: left; background: transparent; font-weight: var(--weight-semibold); }
  .rank-select[aria-pressed='true'] { color: var(--accent); }
  .sparkline { width: 180px; height: 52px; }
  .unknown-scores { display: flex; flex-wrap: wrap; gap: var(--chart-gap); margin-top: var(--chart-gap); }
</style>
