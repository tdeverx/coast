<script lang="ts">
  import ChartMark from './ChartMark.svelte';
  import { chartCategoryColor, chartFill, formatValue, type ChartModel } from './model';
  import { bandPath, frequencyDensity, linePath, overlapGeometry, polar, scale, sectorPath, spreadLabels } from './standard-geometry';

  let { model, selected, onselect }: { model: ChartModel; selected: number; onselect: (index: number) => void } = $props();
  const width = 900;
  const plot = { left: 92, right: 806, top: 40, bottom: 350 };
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hourBands = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];
  let style = $derived(model.styleId);
  let raw = $derived(model.raw);
  let signedColors = $derived(raw.lowerIsBetter === true ? ['var(--danger)', 'var(--success)'] : ['var(--success)', 'var(--danger)']);
  let uid = $derived(`chart-${model.id.replace(/[^a-z0-9]/gi, '-')}`);
  let height = $derived(style === '4A' ? 275 : style === '4B' ? 490 : ['2A','2C'].includes(style) ? Math.max(435,model.rows.length*44+110) : 435);
  // Keep token-sized SVG labels readable; a small viewport scrolls this canvas locally.
  const minimumWidth = width;
  let xPositions = $derived(model.labels.map((_, i) => scale(i, [0, Math.max(1, model.labels.length - 1)], plot.left, plot.right)));
  let valueTicks = $derived(model.ticks.length ? model.ticks : [model.domain[0], model.domain[1]]);
  const valueY = (value: number) => scale(value, model.domain, plot.bottom, plot.top);
  const valueX = (value: number) => scale(value, model.domain, plot.left, plot.right);
  const rowLabel = (index: number) => {
    const row = model.rows[index];
    return row ? `${row.label}: ${formatValue(row.value, model.unit)}${row.detail ? `. ${row.detail}` : ''}` : '';
  };
  const numbers = (value: unknown): number[] => Array.isArray(value) ? value.map(Number) : [];

  let timeline = $derived.by(() => {
    if (!style.startsWith('1')) return [];
    const count = model.labels.length;
    return model.series.map((series, seriesIndex) => {
      const bottom = Array.from({ length: count }, (_, index) => style === '1C'
        ? model.series.slice(0, seriesIndex).reduce((sum, previous) => sum + (previous.values[index] ?? 0), 0) : 0);
      const points = series.values.map((value, index) => value === null || (style === '1C' && model.series.slice(0, seriesIndex).some((previous) => previous.values[index] === null)) ? null : ({ x: xPositions[index], y: valueY(bottom[index] + value), index }));
      const runs: { x: number; y: number; index: number }[][] = [];
      let current: { x: number; y: number; index: number }[] = [];
      for (const point of points) {
        if (point) current.push(point);
        else if (current.length) { runs.push(current); current = []; }
      }
      if (current.length) runs.push(current);
      return { ...series, points, path: runs.map(linePath).join(' '), area: runs.map((run) => bandPath(run, run.map((point) => ({ x: point.x, y: valueY(bottom[point.index]) })))).join(' ') };
    });
  });
  let composition = $derived(style.startsWith('3'));
  let compositions = $derived.by(() => {
    if (style !== '3A' && style !== '3B') return [];
    const total = model.rows.reduce((sum, row) => sum + Math.max(0, row.value ?? 0), 0);
    let angle = -Math.PI / 2;
    return model.rows.map((row, index) => {
      const fraction = total ? (row.value ?? 0) / total : 0;
      const end = angle + Math.PI * 2 * fraction;
      const result = { index, fraction, path: sectorPath(254, 217, 166, style === '3A' ? 111 : 0, angle, end), label: polar(254, 217, 106, (angle + end) / 2) };
      angle = end;
      return result;
    });
  });
  let stackBars = $derived.by(() => style === '2B' ? model.labels.map((label, index) => {
    let baseline = 0;
    const segments = model.series.map((series) => {
      const value = series.values[index] ?? 0;
      const result = { value, name: series.name, bottom: baseline, top: baseline + value };
      baseline += value;
      return result;
    });
    return { label, index, total: baseline, segments };
  }) : []);
  let yearCalendar = $derived.by(() => {
    const year = model.calendar?.year ?? 2026;
    const firstDay = (new Date(Date.UTC(year, 0, 1)).getUTCDay() + 6) % 7;
    const values = style === '4A' ? model.calendar?.values ?? [] : [];
    const cells = values.map((value, index) => ({ value, index, column: Math.floor((firstDay + index) / 7), row: (firstDay + index) % 7 }));
    const monthStarts = months.map((label, month) => ({ label, column: Math.floor((firstDay + (Date.UTC(year, month, 1) - Date.UTC(year, 0, 1)) / 86400000) / 7) }));
    return { cells, monthStarts, columns: Math.ceil((firstDay + values.length) / 7) };
  });
  let monthCalendar = $derived.by(() => {
    const year = model.calendar?.year ?? 2026, month = model.calendar?.month ?? 9;
    const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const values = style === '4B' ? model.calendar?.values ?? [] : [];
    return { offset, rowCount: Math.ceil((offset + values.length) / 7), cells: values.map((value, index) => ({ value, index, column: (offset + index) % 7, row: Math.floor((offset + index) / 7) })) };
  });
  let heatMaximum = $derived(Math.max(1, ...model.matrix.flat().filter((value): value is number => value !== null), ...(model.calendar?.values ?? []).filter((value): value is number => value !== null)));
  const heatFill = (value: number | null, color = 'var(--accent)') => value === null || value === 0 ? 'var(--surface)' : `color-mix(in srgb, ${color} ${12 + value / heatMaximum * 88}%, var(--surface))`;
  let radar = $derived(style === '5B' ? model.series.map((series) => ({ ...series, points: series.values.map((value, index) => value === null ? null : polar(450, 220, 155 * value / (model.domain[1] || 1), -Math.PI / 2 + index / model.labels.length * Math.PI * 2)) })) : []);
  let overlap = $derived(overlapGeometry(Number(raw.a) || 0, Number(raw.b) || 0, Number(raw.shared) || 0));
  let intervalHistory = $derived.by(() => {
    const q1 = numbers(raw.q1), q3 = numbers(raw.q3), median = numbers(raw.median);
    return { band: bandPath(q3.map((value, i) => ({ x: xPositions[i], y: valueY(value) })), q1.map((value, i) => ({ x: xPositions[i], y: valueY(value) }))), path: linePath(median.map((value, i) => ({ x: xPositions[i], y: valueY(value) }))), median, q1, q3 };
  });
  const spacedLabels = (values:number[],spacing:number)=>spreadLabels(values.map(valueY),plot.top+16,plot.bottom-12,spacing);
  let slopeLabels = $derived(style === '6C' ? { before: spacedLabels(model.rows.map((row) => row.reference ?? 0), 39), after: spacedLabels(model.rows.map((row) => row.value ?? 0), 23) } : { before: [], after: [] });
  let densities = $derived.by(() => {
    if (style !== '7B') return [];
    const xs = numbers(raw.x);
    return model.series.map((series) => frequencyDensity(xs, series.values.map((value) => value ?? 0), model.domain));
  });
  let densityMaximum = $derived(Math.max(0.001, ...densities.flat().map((point) => point.y)) * 1.16);
  let densityPaths = $derived(densities.map((points) => {
    const coordinates = points.map((point) => ({ x: valueX(point.x), y: scale(point.y, [0, densityMaximum], plot.bottom, plot.top) }));
    return { path: linePath(coordinates), area: bandPath(coordinates, coordinates.map((point) => ({ x: point.x, y: plot.bottom }))) };
  }));
  let densityMedians = $derived(Array.isArray(raw.series) ? raw.series.map((series) => Number((series as Record<string, unknown>).median)) : []);
</script>

{#snippet horizontalAxis(left: number, right: number, bottom: number)}
  <line x1={left} x2={right} y1={bottom} y2={bottom} class="axis" />
  {#each valueTicks as tick}
    {@const x = scale(tick, model.domain, left, right)}
    <line x1={x} x2={x} y1={bottom} y2={bottom + 6} class="axis" />
    <text x={x} y={bottom + 25} text-anchor="middle" class="tick">{style === '2C' && tick > 0 ? '+' : ''}{tick}</text>
  {/each}
{/snippet}

{#snippet verticalAxis()}
  {#each valueTicks as tick}
    <line x1={plot.left} x2={plot.right} y1={valueY(tick)} y2={valueY(tick)} class="grid-line" />
    <text x={plot.left - 14} y={valueY(tick) + 4} text-anchor="end" class="tick">{tick}</text>
  {/each}
  <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} class="axis" />
  <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} class="axis" />
  <text x={plot.left} y={22} class="tick">{model.unit}</text>
{/snippet}

{#snippet categoryAxis()}
  {#each model.labels as label, index}
    <text x={xPositions[index]} y={plot.bottom + 27} text-anchor="middle" class="tick">{label}</text>
  {/each}
{/snippet}

{#snippet legend(entries: string[], colors = entries.map(chartCategoryColor), points = false)}
  <div class="chart-legend" class:points aria-label="Legend">
    {#each entries as entry, index}<span><i style:background={colors[index % colors.length]}></i>{entry}</span>{/each}
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll a wide chart canvas.) -->
<div class="chart-scroll" class:wide-chart={composition||style==='5C'} style:--chart-min-width={`${minimumWidth}px`} tabindex="0" role="region" aria-label="Chart canvas; scroll horizontally on smaller screens">
  <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${model.title}. ${model.subtitle}`}>
    <title>{model.title}</title>
    <desc>Fictional preview. Select a mark to inspect its exact values in the accompanying data table.</desc>
    <defs>
      <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color={chartCategoryColor(timeline[0]?.name ?? 'Recorded watches')} stop-opacity="0.38" /><stop offset="100%" stop-color={chartCategoryColor(timeline[0]?.name ?? 'Recorded watches')} stop-opacity="0.03" /></linearGradient>
    </defs>

    {#if style === '1A' || style === '1B' || style === '1C'}
      {@render verticalAxis()}
      {@render categoryAxis()}
      {#each timeline as series}
        {#if style !== '1A'}<path d={series.area} fill={style === '1B' ? `url(#${uid}-area)` : series.tone ?? chartCategoryColor(series.name)} fill-opacity={style === '1C' ? 0.66 : 1} />{/if}
        <path d={series.path} fill="none" stroke={series.tone ?? chartCategoryColor(series.name)} stroke-width={style === '1C' ? 1.5 : 2.5} />
        {#each series.points as point, index}
          {#if point}
            <ChartMark label={`${model.labels[index]} · ${series.name}: ${formatValue(series.values[index], model.unit)}`} {index} {selected} {onselect}>
              <circle cx={point.x} cy={point.y} r="15" fill="transparent" />
              <circle class="chart-shape" cx={point.x} cy={point.y} r={selected === index ? 6 : 4} fill={series.tone ?? chartCategoryColor(series.name)} stroke={selected === index ? 'var(--ink)' : 'none'} stroke-width="2" />
            </ChartMark>
          {/if}
        {/each}
      {/each}
      {#if style === '1C'}
        {#each model.labels as _, index}
          {#if model.series.every((series) => series.values[index] !== null)}
            {@const total = model.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0)}
            <text x={xPositions[index]} y={valueY(total) - 14} text-anchor="middle" class="value">{total}</text>
          {/if}
        {/each}
      {:else if timeline[0] && selected >= 0 && selected < model.labels.length && timeline[0].points[selected]}
        <text x={Math.min(plot.right - 8, Math.max(plot.left + 8, xPositions[selected]))} y={(timeline[0].points[selected]?.y ?? 0) - 17} text-anchor={selected === 0 ? 'start' : selected === model.labels.length - 1 ? 'end' : 'middle'} class="value">{formatValue(timeline[0].values[selected], model.unit)}</text>
      {/if}

    {:else if style === '2A' || style === '2C'}
      {@const left = 232}
      {@const right = 814}
      {@const bottom = height-85}
      {@const rowHeight = (bottom-60) / Math.max(1, model.rows.length)}
      {@const zero = scale(0, model.domain, left, right)}
      {#if style === '2C'}
        {#each valueTicks as tick}<line x1={scale(tick, model.domain, left, right)} x2={scale(tick, model.domain, left, right)} y1="36" y2={bottom} class={tick === 0 ? 'axis' : 'grid-line'} />{/each}
      {/if}
      {#each model.rows as row, index}
        {@const y = 46 + index * rowHeight}
        {@const end = scale(row.value ?? 0, model.domain, left, right)}
        <ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
          <rect x="12" y={y - 7} width="864" height={rowHeight} fill="transparent" />
          <text x="12" y={y + 17} class="row-label">{row.label}</text>
          <rect x={Math.min(zero, end)} y={y + 1} width={Math.max(0, Math.abs(end - zero))} height="24" class="rounded-mark chart-shape" fill={style === '2C' ? signedColors[(row.value ?? 0) >= 0 ? 0 : 1] : chartCategoryColor(row.label)} fill-opacity={selected === index ? 1 : 0.8} />
          <text x={end + ((row.value ?? 0) < 0 ? -9 : 9)} y={y + 18} text-anchor={(row.value ?? 0) < 0 ? 'end' : 'start'} class="value">{style === '2C' && (row.value ?? 0) > 0 ? '+' : ''}{formatValue(row.value)}</text>
        </ChartMark>
        {#if style === '2A'}<line x1="12" x2="875" y1={y + rowHeight - 8} y2={y + rowHeight - 8} class="rule" />{/if}
      {/each}
      {@render horizontalAxis(left, right, bottom)}

    {:else if style === '2B'}
      {@render verticalAxis()}
      {@const slot = (plot.right - plot.left) / Math.max(1, stackBars.length)}
      {#each stackBars as bar}
        {@const x = plot.left + slot * (bar.index + 0.18)}
        {@const barWidth = slot * 0.64}
        <ChartMark label={`${bar.label}: ${bar.segments.map((segment) => `${segment.name} ${formatValue(segment.value, model.unit)}`).join(', ')}. Total ${formatValue(bar.total, model.unit)}`} index={bar.index} {selected} {onselect}>
          <rect {x} y={plot.top} width={barWidth} height={plot.bottom - plot.top} fill="transparent" />
          <defs><clipPath id={`${uid}-stack-${bar.index}`}><rect class="rounded-mark" {x} y={valueY(bar.total)} width={barWidth} height={Math.max(0, plot.bottom - valueY(bar.total))} style:height={`calc(${Math.max(0, plot.bottom - valueY(bar.total))}px + var(--chart-mark-radius))`} /></clipPath></defs>
          <g clip-path={`url(#${uid}-stack-${bar.index})`}>
          {#each bar.segments as segment}
            <rect {x} y={valueY(segment.top)} width={barWidth} height={valueY(segment.bottom) - valueY(segment.top)} fill={chartCategoryColor(segment.name)} fill-opacity="0.8" />
            {#if valueY(segment.bottom) - valueY(segment.top) > 28}<text x={x + barWidth / 2} y={(valueY(segment.bottom) + valueY(segment.top)) / 2 + 5} text-anchor="middle" class="on-fill">{segment.value}</text>{/if}
          {/each}
          </g>
          {#if selected === bar.index}<rect x={x - 6} y={valueY(bar.total) - 7} width={barWidth + 12} height={plot.bottom - valueY(bar.total) + 7} class="rounded-mark" fill="none" stroke="var(--chart-highlight)" stroke-width="1.5" />{/if}
        </ChartMark>
        <text x={x + barWidth / 2} y={valueY(bar.total) - 13} text-anchor="middle" class="value">{bar.total}</text>
        <text x={x + barWidth / 2} y={plot.bottom + 27} text-anchor="middle" class="tick">{bar.label}</text>
      {/each}

    {:else if style === '3A' || style === '3B'}
      {#each compositions as slice}
        <ChartMark label={`${rowLabel(slice.index)} · ${formatValue(slice.fraction * 100, '%')}`} index={slice.index} {selected} {onselect}>
          <path class="chart-shape" d={slice.path} fill={chartFill(chartCategoryColor(model.rows[slice.index].label))} stroke={selected === slice.index ? 'var(--ink)' : 'var(--canvas)'} stroke-width="1.5" />
          {#if style === '3B' && slice.fraction >= 0.07}<text x={slice.label.x} y={slice.label.y + 5} text-anchor="middle" class="on-fill percentage">{Math.round(slice.fraction * 100)}%</text>{/if}
        </ChartMark>
      {/each}
      {#if style === '3A'}
        <text x="254" y="214" text-anchor="middle" class="total">{model.total ?? model.rows.reduce((sum, row) => sum + (row.value ?? 0), 0)}</text>
        <text x="254" y="242" text-anchor="middle" class="tick">{model.unit}</text>
      {/if}
      {#each model.rows as row, index}
        {@const y = 114 + index * 65}
        <ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
          <rect x="480" y={y - 26} width="405" height="57" fill="transparent" />
          <rect class="legend-swatch" x="496" y={y - 4} width="8" height="8" fill={chartCategoryColor(row.label)} />
          <text x="522" y={y + 5} class="row-label">{row.label}</text>
          <text x="764" y={y + 5} text-anchor="end" class="value">{formatValue(row.value, model.unit)}</text>
          <text x="872" y={y + 5} text-anchor="end" class="tick">{Math.round((compositions[index]?.fraction ?? 0) * 100)}%</text>
        </ChartMark>
        <line x1="522" x2="872" y1={y + 27} y2={y + 27} class="rule" />
      {/each}

    {:else if style === '3C'}
      {#each model.rows as row, index}
        {@const radius = 166 - index * 34}
        {@const circumference = 2 * Math.PI * radius}
        {@const proportion = row.capacity ? Math.min(1, Math.max(0, (row.value ?? 0) / row.capacity)) : 0}
        <circle cx="280" cy="216" r={radius} fill="none" stroke="var(--surface)" stroke-width="20" />
        <ChartMark label={`${rowLabel(index)} of ${formatValue(row.capacity ?? null, model.unit)}${row.value === null ? '' : ` · ${Math.round(proportion * 100)}%`}`} {index} {selected} {onselect}>
          {#if row.value !== null}<circle cx="280" cy="216" r={radius} fill="none" stroke={chartCategoryColor(row.label)} stroke-width="20" stroke-opacity={selected === index ? 1 : .85} stroke-dasharray={`${circumference * proportion} ${circumference}`} transform="rotate(-90 280 216)" />{/if}
          <rect x="510" y={104 + index * 88} width="350" height="70" fill="transparent" />
          <rect class="legend-swatch" x="518" y={119 + index * 88} width="8" height="8" fill={chartCategoryColor(row.label)} />
          <text x="545" y={127 + index * 88} class="row-label">{row.label}</text>
          <text x="545" y={151 + index * 88} class="tick">{row.value === null ? 'Unknown · insufficient evidence' : `${row.value} / ${row.capacity} · ${Math.round(proportion * 100)}%`}</text>
        </ChartMark>
      {/each}
      <text x="280" y="223" text-anchor="middle" class="tick">{String(raw.center ?? model.unit).replace(/\n/g, ' ')}</text>

    {:else if style === '4A'}
      {@const cell = 13}
      {@const gap = 3}
      {@const startX = 49}
      {@const startY = 52}
      {#each yearCalendar.monthStarts as month}<text x={startX + month.column * (cell + gap)} y="28" class="tick">{month.label}</text>{/each}
      {#each weekdays as day, index}{#if index === 0 || index === 2 || index === 4}<text x="36" y={startY + index * (cell + gap) + 10} text-anchor="end" class="small-label">{day}</text>{/if}{/each}
      {#each yearCalendar.cells as day}
        <ChartMark label={rowLabel(day.index)} index={day.index} {selected} {onselect}>
          <rect x={startX + day.column * (cell + gap)} y={startY + day.row * (cell + gap)} width={cell} height={cell} class="rounded-cell chart-shape" fill={heatFill(day.value)} stroke={selected === day.index ? 'var(--ink)' : day.value === null ? 'var(--muted)' : 'none'} stroke-width={selected === day.index ? 1.5 : 0.75} />
          {#if day.value === null}<line x1={startX + day.column * (cell + gap) + 3} x2={startX + day.column * (cell + gap) + 10} y1={startY + day.row * (cell + gap) + 10} y2={startY + day.row * (cell + gap) + 3} stroke="var(--muted)" stroke-width="0.75" />{/if}
        </ChartMark>
      {/each}
      <text x={startX} y="207" class="tick">{model.calendar?.year} · UTC · {model.unit} per day · outlined slash = unknown</text>
      {#each [0, 0.25, 0.5, 0.75, 1] as fraction, index}
        <rect x={startX + index * 152} y="228" width="15" height="15" class="rounded-cell chart-shape" fill={heatFill(fraction * heatMaximum)} />
        <text x={startX + index * 152 + 23} y="240" class="small-label">{index === 0 ? 'Known 0' : formatValue(fraction * heatMaximum)}</text>
      {/each}

    {:else if style === '4B'}
      {@const left = 54}
      {@const top = 42}
      {@const cellWidth = 112}
      {@const cellHeight = 370 / monthCalendar.rowCount}
      {#each weekdays as day, index}<text x={left + (index + 0.5) * cellWidth} y="24" text-anchor="middle" class="tick">{day}</text>{/each}
      <defs><clipPath id={`${uid}-month-frame`}><rect class="rounded-frame" x={left} y={top} width={7 * cellWidth} height="370" /></clipPath></defs>
      <g clip-path={`url(#${uid}-month-frame)`}>
      {#each Array.from({ length: monthCalendar.rowCount * 7 }) as _, slot}
        <rect x={left + slot % 7 * cellWidth} y={top + Math.floor(slot / 7) * cellHeight} width={cellWidth} height={cellHeight} fill="none" class="rule" />
      {/each}
      {#each monthCalendar.cells as day}
        {@const x = left + day.column * cellWidth}
        {@const y = top + day.row * cellHeight}
        {@const radius = day.value === null ? 0 : 23 * Math.sqrt(day.value / heatMaximum)}
        <ChartMark label={rowLabel(day.index)} index={day.index} {selected} {onselect}>
          <rect class="rounded-mark chart-shape" {x} {y} width={cellWidth} height={cellHeight} fill="transparent" stroke={selected === day.index ? 'var(--accent)' : 'none'} stroke-width="2" />
          <text x={x + 10} y={y + 18} class="small-label">{day.index + 1}</text>
          {#if day.value === null}<text x={x + cellWidth / 2} y={y + cellHeight / 2 + 5} text-anchor="middle" class="tick">—</text>
          {:else}<circle cx={x + cellWidth / 2} cy={y + cellHeight / 2 + 5} r={radius || 3} fill={radius ? 'var(--success)' : 'none'} stroke={radius ? 'none' : 'var(--muted)'} />{/if}
        </ChartMark>
      {/each}
      </g>
      <rect class="rounded-frame rule" x={left} y={top} width={7 * cellWidth} height="370" fill="none" pointer-events="none" />
      <text x="450" y="454" text-anchor="middle" class="tick">Circle area is proportional to {model.unit} · UTC dates · — = {model.unit === 'ms' ? 'no samples' : 'unknown event count'}</text>

    {:else if style === '4C'}
      {@const left = 86}
      {@const top = 49}
      {@const cellWidth = 119}
      {@const cellHeight = 42}
      {#each hourBands as label, column}<text x={left + (column + 0.5) * cellWidth} y="29" text-anchor="middle" class="tick">{label}</text>{/each}
      {#each model.matrix as row, rowIndex}
        <text x={left - 14} y={top + (rowIndex + 0.5) * cellHeight + 5} text-anchor="end" class="row-label">{weekdays[rowIndex]}</text>
        {#each row as value, column}
          {@const index = rowIndex * row.length + column}
          <ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
            <rect class="rounded-mark chart-shape" x={left + column * cellWidth} y={top + rowIndex * cellHeight} width={cellWidth - 2} height={cellHeight - 2} fill={heatFill(value, 'var(--danger)')} stroke={selected === index ? 'var(--ink)' : 'none'} stroke-width="2" />
            <text x={left + (column + 0.5) * cellWidth} y={top + (rowIndex + 0.5) * cellHeight + 4} text-anchor="middle" style:fill={value !== null && value / heatMaximum > 0.52 ? 'var(--canvas)' : 'var(--ink)'}>{value === null ? '—' : value}</text>
          </ChartMark>
        {/each}
      {/each}
      <text x={left} y="385" class="tick">UTC hour bands · {String(raw.legend ?? `${model.unit} per weekday / hour band`)}</text>

    {:else if style === '5A'}
      {#each model.ticksY as tick}<line x1={plot.left} x2={plot.right} y1={scale(tick, model.domainY, plot.bottom, plot.top)} y2={scale(tick, model.domainY, plot.bottom, plot.top)} class="grid-line" /><text x={plot.left - 13} y={scale(tick, model.domainY, plot.bottom, plot.top) + 5} text-anchor="end" class="tick">{tick}</text>{/each}
      {@render horizontalAxis(plot.left, plot.right, plot.bottom)}
      <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} class="axis" />
      {#if raw.guide}
        {@const minimum = Math.max(model.domain[0], model.domainY[0])}
        {@const maximum = Math.min(model.domain[1], model.domainY[1])}
        <line x1={valueX(minimum)} x2={valueX(maximum)} y1={scale(minimum, model.domainY, plot.bottom, plot.top)} y2={scale(maximum, model.domainY, plot.bottom, plot.top)} stroke="var(--muted)" stroke-dasharray="5 5" />
        <text x={plot.right - 4} y="22" text-anchor="end" class="tick">{String(raw.guide)}</text>
      {/if}
      {#each model.points as point, index}
        {@const x = valueX(point.x)}
        {@const y = scale(point.y, model.domainY, plot.bottom, plot.top)}
        <ChartMark label={`${point.label}. ${model.xLabel}: ${point.x}; ${model.yLabel}: ${point.y}`} {index} {selected} {onselect}>
          <circle cx={x} cy={y} r="13" fill="transparent" />
          <circle class="chart-shape" cx={x} cy={y} r={selected === index ? 6 : 4.5} fill="var(--accent)" stroke={selected === index ? 'var(--ink)' : 'none'} stroke-width="2" />
        </ChartMark>
      {/each}
      <text x="450" y="410" text-anchor="middle" class="tick">{model.xLabel}</text>
      <text x="21" y="195" transform="rotate(-90 21 195)" text-anchor="middle" class="tick">{model.yLabel}</text>

    {:else if style === '5B'}
      {#each valueTicks.filter((tick) => tick > 0) as tick}
        <polygon points={model.labels.map((_, index) => { const point = polar(450, 220, 155 * tick / model.domain[1], -Math.PI / 2 + index / model.labels.length * Math.PI * 2); return `${point.x},${point.y}`; }).join(' ')} fill="none" class="rule" />
        <text x="458" y={220 - 155 * tick / model.domain[1] + 5} class="small-label">{tick}</text>
      {/each}
      {#each model.labels as label, index}
        {@const point = polar(450, 220, 155, -Math.PI / 2 + index / model.labels.length * Math.PI * 2)}
        {@const labelPoint = polar(450, 220, 182, -Math.PI / 2 + index / model.labels.length * Math.PI * 2)}
        <line x1="450" y1="220" x2={point.x} y2={point.y} class="rule" />
        <ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
          <text x={labelPoint.x} y={labelPoint.y + 5} text-anchor={labelPoint.x < 440 ? 'end' : labelPoint.x > 460 ? 'start' : 'middle'} class="row-label">{label}</text>
        </ChartMark>
      {/each}
      {#each radar as series}
        {#if series.points.every((point) => point !== null)}
          <polygon points={series.points.map((point) => point ? `${point.x},${point.y}` : '').join(' ')} fill={series.tone ?? chartCategoryColor(series.name)} fill-opacity="0.12" stroke={series.tone ?? chartCategoryColor(series.name)} stroke-width="2" />
        {:else}
          {#each series.points as point, index}
            {@const next = series.points[(index + 1) % series.points.length]}
            {#if point && next}<line x1={point.x} y1={point.y} x2={next.x} y2={next.y} stroke={series.tone ?? chartCategoryColor(series.name)} stroke-width="2" />{/if}
          {/each}
        {/if}
        {#each series.points as point, index}
          {#if point}
            <ChartMark label={`${model.labels[index]} · ${series.name}: ${formatValue(series.values[index], model.unit)}`} {index} {selected} {onselect}>
              <circle cx={point.x} cy={point.y} r="14" fill="transparent" />
              <circle class="chart-shape" cx={point.x} cy={point.y} r={selected === index ? 5.5 : 4} fill={series.tone ?? chartCategoryColor(series.name)} stroke={selected === index ? 'var(--ink)' : 'none'} stroke-width="2" />
            </ChartMark>
          {/if}
        {/each}
      {/each}
      <text x="450" y="425" text-anchor="middle" class="tick">Independent axes · {model.unit} · Common 0–{model.domain[1]} domain</text>

    {:else if style === '5C'}
      {#each overlap.paths as path, index}
        <ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
          <path d={path} fill-rule="evenodd" fill={index === 0 ? 'var(--accent)' : index === 2 ? 'var(--success)' : 'var(--ink)'} fill-opacity={index === selected ? 0.38 : 0.22} stroke={index === selected ? 'var(--ink)' : index === 2 ? 'var(--success)' : 'var(--accent)'} stroke-width="2" />
        </ChartMark>
      {/each}
      <text x="92" y="27" text-anchor="start" class="row-label" style:fill="var(--accent)">{String(raw.left)} · {String(raw.a)}</text>
      <text x="806" y="27" text-anchor="end" class="row-label" style:fill="var(--success)">{String(raw.right)} · {String(raw.b)}</text>
      {#each model.rows as row, index}
        {@const x = index === 0 ? overlap.xA - overlap.a * 0.48 : index === 2 ? overlap.xB + overlap.b * 0.48 : (overlap.xA + overlap.a + overlap.xB - overlap.b) / 2}
        <ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
          <text {x} y="219" text-anchor="middle" class="total">{row.value}</text>
          <text {x} y="244" text-anchor="middle" class="small-label">{row.label}</text>
        </ChartMark>
      {/each}
      <text x="450" y="414" text-anchor="middle" class="tick">{model.total ?? Number(raw.a) + Number(raw.b) - Number(raw.shared)} {model.unit} in the union</text>

    {:else if style === '6A' && model.interval}
      {@const interval = model.interval}
      {@const y = 199}
      <line x1={valueX(interval.min)} x2={valueX(interval.max)} y1={y} y2={y} stroke="var(--accent)" stroke-width="2" />
      <rect class="rounded-mark" x={valueX(interval.q1)} y={y - 18} width={valueX(interval.q3) - valueX(interval.q1)} height="36" fill="var(--accent)" fill-opacity="0.3" />
      {#each [interval.min, interval.q1, interval.median, interval.q3, interval.max, interval.current] as value, index}
        {#if value !== undefined}
          <ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
            <rect x={valueX(value) - 10} y={y - 26} width="20" height="55" fill="transparent" />
            {#if index === 2 || index === 5}<circle class="chart-shape" cx={valueX(value)} cy={y} r={selected === index ? 7 : 5} fill={index === 5 ? 'var(--success)' : 'var(--accent)'} stroke={selected === index ? 'var(--ink)' : 'none'} stroke-width="2" />
            {:else}<line x1={valueX(value)} x2={valueX(value)} y1={y - 18} y2={y + 18} stroke={selected === index ? 'var(--chart-highlight)' : 'var(--accent)'} stroke-width="2" />{/if}
          </ChartMark>
          <text x={valueX(value)} y={index === 5 ? y + 52 : y - 54} text-anchor="middle" class="small-label" style:fill={index === 5 ? 'var(--success)' : 'var(--muted)'}>{model.rows[index]?.label}</text>
          <text x={valueX(value)} y={index === 5 ? y + 73 : y - 32} text-anchor="middle" class="value">{formatValue(value)}</text>
        {/if}
      {/each}
      {@render horizontalAxis(plot.left, plot.right, 311)}
      <text x="450" y="386" text-anchor="middle" class="tick">Shaded interval: 25th–75th percentiles · Ends: minimum and maximum</text>

    {:else if style === '6B'}
      {@render verticalAxis()}
      {@render categoryAxis()}
      <path d={intervalHistory.band} fill="var(--danger)" fill-opacity="0.25" stroke="var(--danger)" stroke-opacity="0.5" />
      <path d={intervalHistory.path} fill="none" stroke="var(--success)" stroke-width="2.5" />
      {#if typeof raw.guide === 'number'}<line x1={plot.left} x2={plot.right} y1={valueY(raw.guide)} y2={valueY(raw.guide)} stroke="var(--accent)" stroke-dasharray="5 5" /><text x={plot.right} y={valueY(raw.guide) - 10} text-anchor="end" class="small-label">{String(raw.guideLabel)}</text>{/if}
      {#each intervalHistory.median as value, index}
        <ChartMark label={`${rowLabel(index)}. IQR ${intervalHistory.q1[index]}–${intervalHistory.q3[index]}`} {index} {selected} {onselect}>
          <circle cx={xPositions[index]} cy={valueY(value)} r="15" fill="transparent" />
          <circle class="chart-shape" cx={xPositions[index]} cy={valueY(value)} r={selected === index ? 6 : 4.5} fill="var(--success)" stroke={selected === index ? 'var(--ink)' : 'none'} stroke-width="2" />
        </ChartMark>
      {/each}

    {:else if style === '6C'}
      {@render verticalAxis()}
      <line x1="295" x2="295" y1={plot.top} y2={plot.bottom} class="grid-line" /><line x1="602" x2="602" y1={plot.top} y2={plot.bottom} class="grid-line" />
      <text x="295" y={plot.bottom + 29} text-anchor="middle" class="row-label">{String(raw.left ?? 'Before')}</text><text x="602" y={plot.bottom + 29} text-anchor="middle" class="row-label">{String(raw.right ?? 'After')}</text>
      {#each model.rows as row, index}
        {@const before = row.reference ?? row.values?.[0] ?? 0}
        {@const after = row.value ?? 0}
        <ChartMark label={`${row.label}: ${String(raw.left)} ${formatValue(before, model.unit)}; ${String(raw.right)} ${formatValue(after, model.unit)}`} {index} {selected} {onselect}>
          <line x1="295" x2="602" y1={valueY(before)} y2={valueY(after)} stroke="transparent" stroke-width="18" />
          <line x1="295" x2="602" y1={valueY(before)} y2={valueY(after)} stroke={chartCategoryColor(row.label)} stroke-width={selected === index ? 3 : 2} />
          <circle cx="295" cy={valueY(before)} r="5" fill={chartCategoryColor(row.label)} /><circle cx="602" cy={valueY(after)} r="5" fill={chartCategoryColor(row.label)} />
          {#if Math.abs(slopeLabels.before[index] - valueY(before)) > 1}<line x1="295" x2="281" y1={valueY(before)} y2={slopeLabels.before[index]} stroke={chartCategoryColor(row.label)} />{/if}
          {#if Math.abs(slopeLabels.after[index] - valueY(after)) > 1}<line x1="602" x2="617" y1={valueY(after)} y2={slopeLabels.after[index]} stroke={chartCategoryColor(row.label)} />{/if}
          <text x="276" y={slopeLabels.before[index] - 6} text-anchor="end" class="small-label">{row.label}</text><text x="276" y={slopeLabels.before[index] + 13} text-anchor="end" class="value" style:fill={chartCategoryColor(row.label)}>{formatValue(before, model.unit)}</text>
          <text x="621" y={slopeLabels.after[index] + 5} class="value" style:fill={chartCategoryColor(row.label)}>{formatValue(after, model.unit)}</text>
        </ChartMark>
      {/each}

    {:else if style === '7A'}
      {@render verticalAxis()}
      {@const slot = (plot.right - plot.left) / Math.max(1, model.rows.length)}
      {#each model.rows as row, index}
        {@const x = plot.left + slot * (index + 0.06)}
        {@const y = valueY(row.value ?? 0)}
        <ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
          <rect {x} y={Math.min(y, plot.bottom - 5)} width={slot * 0.88} height={Math.max(5, plot.bottom - y)} fill="transparent" />
          <rect class="rounded-mark chart-shape" {x} {y} width={slot * 0.88} height={plot.bottom - y} fill={index === Number(raw.highlight) ? 'var(--success)' : 'var(--accent)'} stroke={selected === index ? 'var(--ink)' : 'none'} stroke-width="2" />
          <text x={x + slot * 0.44} y={y - 10} text-anchor="middle" class="value">{row.value}</text>
        </ChartMark>
        <text x={x + slot * 0.44} y={plot.bottom + 26} text-anchor="middle" class="tick">{row.label}</text>
      {/each}
      <text x="450" y="414" text-anchor="middle" class="tick">{String(raw.xunit ?? model.xLabel)}</text>

    {:else if style === '7B'}
      {#each [0, 0.25, 0.5, 0.75, 1] as fraction}
        {@const y = scale(fraction, [0, 1], plot.bottom, plot.top)}
        <line x1={plot.left} x2={plot.right} y1={y} y2={y} class="grid-line" /><text x={plot.left - 12} y={y + 5} text-anchor="end" class="small-label">{Number((fraction * densityMaximum).toPrecision(2))}</text>
      {/each}
      {@render horizontalAxis(plot.left, plot.right, plot.bottom)}
      <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} class="axis" />
      {#each densityPaths as density, seriesIndex}
        <path d={density.area} fill={model.series[seriesIndex].tone ?? chartCategoryColor(model.series[seriesIndex].name)} fill-opacity="0.2" />
        <path d={density.path} fill="none" stroke={model.series[seriesIndex].tone ?? chartCategoryColor(model.series[seriesIndex].name)} stroke-width="2.5" />
        {#if Number.isFinite(densityMedians[seriesIndex])}
          <line x1={valueX(densityMedians[seriesIndex])} x2={valueX(densityMedians[seriesIndex])} y1={plot.top + seriesIndex * 38} y2={plot.bottom} stroke={model.series[seriesIndex].tone ?? chartCategoryColor(model.series[seriesIndex].name)} stroke-dasharray="5 5" />
          <text x={valueX(densityMedians[seriesIndex]) - 7} y={plot.top + 16 + seriesIndex * 38} text-anchor="end" class="small-label" style:fill={model.series[seriesIndex].tone ?? chartCategoryColor(model.series[seriesIndex].name)}>{model.series[seriesIndex].name} median · {densityMedians[seriesIndex]}</text>
        {/if}
      {/each}
      {#each model.rows as _, index}
        {@const x = valueX(Number(model.labels[index]))}
        <ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
          <line x1={x} x2={x} y1={plot.top} y2={plot.bottom} stroke={selected === index ? 'var(--chart-highlight)' : 'transparent'} stroke-opacity="0.35" stroke-width={selected === index ? 1 : 18} />
        </ChartMark>
      {/each}
      <text x="24" y="190" transform="rotate(-90 24 190)" text-anchor="middle" class="tick">Illustrative density</text>
      <text x="450" y="415" text-anchor="middle" class="tick">{model.unit} · frequency-weighted smoothing within the declared domain</text>
    {/if}
  </svg>
</div>


{#if composition}
  <div class="compact-chart">
    <svg class="compact-composition" viewBox={style === '3C' ? '102 38 356 356' : '76 39 356 356'} role="group" aria-label={model.title}>
      {#if style === '3C'}
        {#each model.rows as row, index}
          {@const radius = 166 - index * 34}
          {@const circumference = 2 * Math.PI * radius}
          {@const proportion = row.capacity ? Math.min(1, Math.max(0, (row.value ?? 0) / row.capacity)) : 0}
          <circle cx="280" cy="216" r={radius} fill="none" stroke="var(--chart-track)" stroke-width="20" />
          <ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
            {#if row.value !== null}<circle cx="280" cy="216" r={radius} fill="none" stroke={chartCategoryColor(row.label)} stroke-width="20" stroke-opacity={selected === index ? 1 : .85} stroke-dasharray={`${circumference * proportion} ${circumference}`} transform="rotate(-90 280 216)" />{/if}
          </ChartMark>
        {/each}
        <text x="280" y="223" text-anchor="middle" class="tick">{String(raw.center ?? model.unit).replace(/\n/g, ' ')}</text>
      {:else}
        {#each compositions as slice}
          <ChartMark label={rowLabel(slice.index)} index={slice.index} {selected} {onselect}>
            <path class="chart-shape" d={slice.path} fill={chartFill(chartCategoryColor(model.rows[slice.index].label))} stroke="var(--canvas)" stroke-width="1.5" />
            {#if style === '3B' && slice.fraction >= .07}<text x={slice.label.x} y={slice.label.y + 5} text-anchor="middle" class="on-fill percentage">{Math.round(slice.fraction * 100)}%</text>{/if}
          </ChartMark>
        {/each}
        {#if style === '3A'}<text x="254" y="214" text-anchor="middle" class="total">{model.total ?? model.rows.reduce((sum, row) => sum + (row.value ?? 0), 0)}</text><text x="254" y="242" text-anchor="middle" class="tick">{model.unit}</text>{/if}
      {/if}
    </svg>
    <div class="chart-legend-list" aria-label="Legend">
      {#each model.rows as row, index}
        <button type="button" class="chart-legend-row" aria-pressed={selected === index} onpointerenter={() => onselect(index)} onfocus={() => onselect(index)} onclick={() => onselect(index)}>
          <i style:background={chartCategoryColor(row.label)}></i><span>{row.label}</span>
          <strong>{formatValue(row.value, model.unit)}{#if row.capacity !== undefined} / {formatValue(row.capacity)}{/if}</strong>
          <small>{row.value === null ? '' : `${Math.round(style === '3C' ? (row.capacity ? row.value / row.capacity * 100 : 0) : (compositions[index]?.fraction ?? 0) * 100)}%`}</small>
        </button>
      {/each}
    </div>
  </div>
{/if}
{#if style==='5C'}
  <div class="compact-chart">
    {@render legend([`${String(raw.left)} · ${String(raw.a)}`,`${String(raw.right)} · ${String(raw.b)}`],['var(--accent)','var(--success)'])}
    <svg class="compact-composition" viewBox="0 0 360 250" role="group" aria-label={`${model.title}; circle areas and overlap encode visible item counts`}>
      <g transform="translate(180 125) scale(.45) translate(-450 -222)">
        {#each overlap.paths as path,index}<ChartMark label={rowLabel(index)} {index} {selected} {onselect}>
          <path d={path} fill-rule="evenodd" fill={index===0?'var(--accent)':index===2?'var(--success)':'var(--ink)'} fill-opacity={index===selected?.38:.22} stroke={index===selected?'var(--ink)':index===2?'var(--success)':'var(--accent)'} stroke-width="2" vector-effect="non-scaling-stroke"/>
        </ChartMark>{/each}
      </g>
    </svg>
    <div class="chart-legend-list" aria-label="Visible item overlap">
      {#each model.rows as row,index}<button type="button" class="chart-legend-row" aria-pressed={selected===index} onpointerenter={()=>onselect(index)} onfocus={()=>onselect(index)} onclick={()=>onselect(index)}>
        <i style:background={index===0?'var(--accent)':index===2?'var(--success)':'var(--ink)'}></i><span>{row.label}</span><strong>{formatValue(row.value,model.unit)}</strong>
      </button>{/each}
    </div>
  </div>
{/if}
{#if ['1A', '1B', '1C', '2B', '5B', '7B'].includes(style)}
  {@render legend(model.series.map((series) => series.name), model.series.map((series) => series.tone ?? chartCategoryColor(series.name)), style !== '2B' && style !== '1C')}
{:else if style === '2C'}
  {@render legend([String(raw.positive ?? 'Positive'), String(raw.negative ?? 'Negative')], signedColors)}
{:else if style === '6B'}
  {@render legend(['Median', '25th–75th percentiles'], ['var(--success)', 'var(--danger)'])}
{/if}
{#if style === '5A' && Array.isArray(raw.legend) && raw.legend.length}
  <p class="chart-note">The source names groups but does not assign observations to them. Points share one colour.</p>
{/if}
{#if style === '5B' && model.series.some((series) => series.values.some((value) => value === null))}
  <p class="chart-note">Unknown signals have no point or filled polygon; they remain unknown in the data table.</p>
{/if}

<style>
  svg.compact-composition { min-width: 0; }
  svg { display: block; width: 100%; min-width: var(--chart-min-width); height: auto; overflow: visible; }
</style>
