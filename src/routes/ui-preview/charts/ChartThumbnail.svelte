<script module lang="ts">
  // Decorative, local samples are computed once. These miniatures never mount a live chart.
  const colours = ['var(--accent)', 'var(--success)', 'var(--danger)', 'var(--rating)'];
  const lineValues = [12, 18, 15, 24, 20, 30];
  const stacks = [[8, 12, 10, 15, 12, 18], [6, 8, 11, 10, 14, 12], [4, 6, 7, 10, 8, 14]];
  const trendPoints = (values: number[], left = 18, top = 20, width = 144, height = 66, maximum = 36) => values.map((value, index) => ({ x: left + index * width / Math.max(1, values.length - 1), y: top + height * (1 - value / maximum) }));
  const path = (points: { x: number; y: number }[]) => points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const trend = trendPoints(lineValues);
  const line = path(trend);
  const stackedAreas = stacks.map((values, index) => {
    const lower = values.map((_, point) => stacks.slice(0, index).reduce((sum, row) => sum + row[point], 0));
    const upper = values.map((value, point) => lower[point] + value);
    return `${path(trendPoints(upper, 18, 14, 144, 72, 50))} ${path(trendPoints(lower, 18, 14, 144, 72, 50).reverse()).replace(/^M/, 'L')} Z`;
  });
  function sector(cx: number, cy: number, inner: number, outer: number, start: number, end: number) {
    const point = (radius: number, angle: number) => `${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`;
    return inner
      ? `M${point(outer, start)} A${outer},${outer} 0 ${end - start > Math.PI ? 1 : 0} 1 ${point(outer, end)} L${point(inner, end)} A${inner},${inner} 0 ${end - start > Math.PI ? 1 : 0} 0 ${point(inner, start)} Z`
      : `M${cx},${cy} L${point(outer, start)} A${outer},${outer} 0 ${end - start > Math.PI ? 1 : 0} 1 ${point(outer, end)} Z`;
  }
  const shares = [40, 30, 20, 10].map((value, index, values) => {
    const start = -Math.PI / 2 + values.slice(0, index).reduce((sum, previous) => sum + previous, 0) / 100 * Math.PI * 2;
    return { index, start, end: start + value / 100 * Math.PI * 2 };
  });
  const polygon = (values: number[], radius = 36) => values.map((value, index) => `${90 + radius * value * Math.cos(-Math.PI / 2 + index * Math.PI * 2 / values.length)},${54 + radius * value * Math.sin(-Math.PI / 2 + index * Math.PI * 2 / values.length)}`).join(' ');
  const radar = [polygon([.9, .7, .45, .6, .8, .7]), polygon([.6, .9, .7, .65, .55, .5])];
  const intervalValues = [29, 25, 21, 16, 13, 8];
  const intervalLine = path(trendPoints(intervalValues, 18, 20, 144, 66, 36));
  const intervalBand = `${path(trendPoints(intervalValues.map(value => value + 4), 18, 20, 144, 66, 36))} ${path(trendPoints(intervalValues.map(value => value - 4), 18, 20, 144, 66, 36).reverse()).replace(/^M/, 'L')} Z`;
  const distributions = [0.68, 0.5].map((mean) => {
    const points = Array.from({ length: 29 }, (_, index) => {
      const x = index / 28;
      return { x: 18 + x * 144, y: 86 - 62 * Math.exp(-((x - mean) ** 2) / .035) };
    });
    return { line: path(points), area: `${path(points)} L162,86 L18,86 Z` };
  });
  const calendarCells = Array.from({ length: 98 }, (_, index) => ({ x: 17 + Math.floor(index / 7) * 10.5, y: 20 + index % 7 * 10, strength: ((index * 7 + Math.floor(index / 7) * 3) % 13) / 12 }));
  const monthCells = Array.from({ length: 30 }, (_, index) => ({ x: 39 + (index + 1) % 7 * 17, y: 20 + Math.floor((index + 1) / 7) * 15, radius: 1.4 + Math.sqrt((index * 7) % 19) }));
  const matrixCells = Array.from({ length: 42 }, (_, index) => ({ x: 24 + index % 6 * 22, y: 18 + Math.floor(index / 6) * 10, strength: (index % 6 + Math.floor(index / 6) / 3) / 7 }));
  const scatter = [[.16, .22], [.3, .3], [.4, .55], [.48, .4], [.54, .68], [.6, .52], [.66, .8], [.69, .68], [.72, .59], [.8, .76], [.87, .88], [.91, .72]];
  const bubbleValues = [40, 30, 25, 20, 16, 9, 4];
  const playful = [[40, 33], [90, 30], [135, 35], [32, 78], [72, 77], [113, 74], [146, 76]].map(([x, y], index) => ({ x, y, radius: Math.sqrt(bubbleValues[index]) * 3.2, index }));
  const packed = [[90, 50], [58, 23], [127, 26], [49, 65], [127, 66], [81, 85], [150, 82]].map(([x, y], index) => ({ x, y, radius: Math.sqrt(bubbleValues[index]) * 3.2, index }));
  const editorialCircles = [40, 25, 16, 9].map((value, index, values) => {
    const radius = Math.sqrt(value) * 3.6;
    const left = 12 + values.slice(0, index).reduce((sum, previous) => sum + Math.sqrt(previous) * 7.2 + 8, 0);
    return { x: left + radius, y: 79 - radius, radius, index };
  });
  const radial = [18, 24, 21, 31, 37, 29, 42, 40, 34, 47, 51, 44].map((value, index) => ({ index, path: sector(90, 54, 9, 9 + value / 60 * 31, -Math.PI / 2 + index * Math.PI / 6 - .22, -Math.PI / 2 + index * Math.PI / 6 + .22) }));
  const ribbon = (sx: number, tx: number, sy: number, ty: number, count: number) => {
    const thickness = count * .52, middle = (sx + tx) / 2;
    return `M${sx},${sy} C${middle},${sy} ${middle},${ty} ${tx},${ty} L${tx},${ty + thickness} C${middle},${ty + thickness} ${middle},${sy + thickness} ${sx},${sy + thickness} Z`;
  };
  const ribbons = [
    { d: ribbon(28, 85, 18, 18, 24), colour: 0 }, { d: ribbon(28, 85, 30.48, 62, 16), colour: 0 },
    { d: ribbon(28, 85, 46.8, 30.48, 21), colour: 1 }, { d: ribbon(28, 85, 57.72, 70.32, 14), colour: 1 },
    { d: ribbon(28, 85, 73, 41.4, 15), colour: 2 }, { d: ribbon(28, 85, 80.8, 77.6, 10), colour: 2 },
    { d: ribbon(91, 151, 18, 18, 45), colour: 0 }, { d: ribbon(91, 151, 41.4, 48, 15), colour: 1 }, { d: ribbon(91, 151, 62, 65, 40), colour: 2 },
  ];
</script>

<script lang="ts">
  let { styleId }: { styleId: string } = $props();
  let family = $derived(Number.parseInt(styleId));
  let framed = $derived(['1B', '2B', '6B', '7B', '8B', '9B', '10B', '11B'].includes(styleId));
</script>

<svg class="chart-thumbnail" viewBox="0 0 180 108" aria-hidden="true" focusable="false">
  {#if framed}<rect x="8" y="8" width="164" height="92" rx="9" fill="var(--coast-glass-fill)" stroke="var(--line)"/>{/if}
  {#if family === 1}
    {#each [30, 58, 86] as y}<line x1="18" x2="162" y1={y} y2={y} class="grid"/>{/each}
    <path d="M18 17V86H164" class="axis"/>
    {#if styleId === '1C'}
      {#each stackedAreas as d, index}<path {d} fill={colours[index]} fill-opacity=".65" stroke={colours[index]} stroke-width="1"/>{/each}
    {:else}
      {#if styleId === '1B'}<path d={`${line} L162,86 L18,86 Z`} fill="var(--accent)" fill-opacity=".24"/>{/if}
      <path d={line} fill="none" stroke="var(--accent)" stroke-width="2"/>
      {#each trend as point}<circle cx={point.x} cy={point.y} r="2.4" fill="var(--accent)"/>{/each}
    {/if}
  {:else if family === 2}
    {#if styleId === '2A'}
      {#each [100, 78, 56, 38] as value, index}<rect x="18" y={20 + index * 19} width="20" height="3" rx="1.5" fill="var(--muted)"/><rect x="48" y={17 + index * 19} width={value} height="9" rx="4.5" fill={index ? 'var(--accent)' : 'var(--success)'}/>{/each}
      <line x1="48" x2="159" y1="93" y2="93" class="axis"/>
    {:else if styleId === '2B'}
      {#each [30, 36, 34, 42, 44, 54] as total, index}<rect x={23 + index * 23} y={86 - total * 1.1} width="14" height={total * 1.1} fill="var(--success)"/><rect x={23 + index * 23} y={86 - [12, 16, 10, 20, 18, 24][index] * 1.1} width="14" height={[12, 16, 10, 20, 18, 24][index] * 1.1} fill="var(--accent)"/>{/each}
      <line x1="18" x2="164" y1="86" y2="86" class="axis"/>
    {:else}
      <line x1="90" x2="90" y1="16" y2="94" class="axis"/>
      {#each [48, 32, 16, -18, -34] as value, index}<rect x={Math.min(90, 90 + value)} y={18 + index * 15} width={Math.abs(value)} height="10" fill={value > 0 ? 'var(--success)' : 'var(--danger)'}/>{/each}
    {/if}
  {:else if family === 3}
    {#if styleId === '3C'}
      {#each [36, 26, 16] as radius, index}<circle cx="71" cy="54" r={radius} fill="none" stroke="var(--surface)" stroke-width="7"/><circle cx="71" cy="54" r={radius} fill="none" stroke={colours[index]} stroke-width="7" stroke-linecap="round" stroke-dasharray={`${[.75, .67, .6][index] * Math.PI * radius * 2} ${Math.PI * radius * 2}`} transform="rotate(-90 71 54)"/><circle cx="130" cy={34 + index * 19} r="3" fill={colours[index]}/><line x1="139" x2="155" y1={34 + index * 19} y2={34 + index * 19} class="axis"/>{/each}
    {:else}
      {#each shares as share}<path d={sector(90, 54, styleId === '3A' ? 24 : 0, 38, share.start, share.end)} fill={colours[share.index]} stroke="var(--canvas)" stroke-width="1.5"/>{/each}
    {/if}
  {:else if family === 4}
    {#if styleId === '4A'}
      {#each calendarCells as cell}<rect x={cell.x} y={cell.y} width="8" height="8" rx="1" fill="var(--accent)" fill-opacity={.12 + cell.strength * .8}/>{/each}
    {:else if styleId === '4B'}
      {#each Array(35) as _, index}<rect x={31 + index % 7 * 17} y={12 + Math.floor(index / 7) * 15} width="17" height="15" fill="none" stroke="var(--line)" stroke-width=".7"/>{/each}
      {#each monthCells as cell}<circle cx={cell.x} cy={cell.y} r={cell.radius} fill="var(--success)"/>{/each}
    {:else}
      {#each matrixCells as cell}<rect x={cell.x} y={cell.y} width="21" height="9" fill="var(--danger)" fill-opacity={.12 + cell.strength * .84}/>{/each}
    {/if}
  {:else if family === 5}
    {#if styleId === '5A'}
      <path d="M18 16V89H165" class="axis"/><path d="M18 89L161 18" class="grid"/>
      {#each scatter as point, index}<circle cx={18 + point[0] * 144} cy={89 - point[1] * 73} r="2.9" fill={colours[index % 3]}/>{/each}
    {:else if styleId === '5B'}
      {#each [.33, .67, 1] as scale}<polygon points={polygon(Array(6).fill(scale))} class="grid"/>{/each}
      {#each Array(6) as _, index}<line x1="90" y1="54" x2={90 + 36 * Math.cos(-Math.PI / 2 + index * Math.PI / 3)} y2={54 + 36 * Math.sin(-Math.PI / 2 + index * Math.PI / 3)} class="axis"/>{/each}
      {#each radar as points, index}<polygon {points} fill={colours[index]} fill-opacity=".2" stroke={colours[index]} stroke-width="1.5"/>{/each}
    {:else}
      <circle cx="72" cy="54" r="34" fill="var(--accent)" fill-opacity=".3" stroke="var(--accent)" stroke-width="1.5"/><circle cx="108" cy="54" r="31" fill="var(--success)" fill-opacity=".3" stroke="var(--success)" stroke-width="1.5"/>
    {/if}
  {:else if family === 6}
    {#if styleId === '6A'}
      <line x1="22" x2="155" y1="61" y2="61" stroke="var(--accent)" stroke-width="1.5"/><path d="M22 54V68M155 54V68" stroke="var(--accent)" fill="none"/><rect x="74" y="49" width="36" height="24" fill="var(--accent)" fill-opacity=".35"/><line x1="91" x2="91" y1="47" y2="75" stroke="var(--accent)"/><circle cx="48" cy="61" r="4" fill="var(--success)"/><line x1="48" x2="48" y1="65" y2="85" class="grid"/><line x1="18" x2="162" y1="85" y2="85" class="axis"/>
    {:else if styleId === '6B'}
      <path d={intervalBand} fill="var(--danger)" fill-opacity=".3"/><path d={intervalLine} fill="none" stroke="var(--success)" stroke-width="2"/>
      {#each trendPoints(intervalValues) as point}<circle cx={point.x} cy={point.y} r="2.5" fill="var(--success)"/>{/each}
      <path d="M18 16V86H163" class="axis"/>
    {:else}
      <path d="M46 16V93M134 16V93" class="grid"/>
      {#each [[25, 62], [42, 72], [60, 82]] as pair, index}<line x1="46" x2="134" y1={pair[0]} y2={pair[1]} stroke={colours[index]} stroke-width="1.5"/><circle cx="46" cy={pair[0]} r="3" fill={colours[index]}/><circle cx="134" cy={pair[1]} r="3" fill={colours[index]}/>{/each}
    {/if}
  {:else if family === 7}
    <path d="M18 16V86H164" class="axis"/>
    {#if styleId === '7A'}
      {#each [4, 8, 15, 29, 46, 58, 40, 23] as value, index}<rect x={22 + index * 17.3} y={86 - value} width="14" height={value} fill={index === 5 ? 'var(--success)' : 'var(--accent)'}/>{/each}
    {:else}
      {#each distributions as distribution, index}<path d={distribution.area} fill={colours[index]} fill-opacity=".24"/><path d={distribution.line} fill="none" stroke={colours[index]} stroke-width="2"/>{/each}
    {/if}
  {:else if family === 8}
    <path d="M17 21H163" class="axis"/>
    {#each [0, 1, 2, 3] as row}
      {#if styleId === '8B' && row === 0}<rect x="14" y="25" width="151" height="15" rx="3" fill="var(--accent)" fill-opacity=".1"/>{/if}
      <rect x="18" y={29 + row * 18} width="5" height="4" fill="var(--muted)"/><rect x="30" y={29 + row * 18} width={35 - row * 3} height="4" rx="2" fill="var(--ink)" fill-opacity=".65"/>
      <path d={path(trendPoints([3 + row, 5 - row / 2, 4 + row, 7 + row, 8 + row], 79, 24 + row * 18, 47, 13, 12))} fill="none" stroke={styleId === '8B' ? 'var(--success)' : 'var(--accent)'} stroke-width="1.2"/>
      <rect x="139" y={29 + row * 18} width="18" height="4" rx="2" fill="var(--muted)"/><line x1="17" x2="163" y1={41 + row * 18} y2={41 + row * 18} class="axis"/>
    {/each}
  {:else if family === 9}
    <line x1="20" x2="160" y1="54" y2="54" class="axis"/>
    {#if styleId === '9A'}
      {#each [4, 12, 20, 28] as day, index}{@const x = 20 + (day - 1) / 29 * 140}<line x1={x} x2={x} y1="54" y2={index % 2 ? 77 : 30} stroke={colours[index % 2]}/><circle cx={x} cy="54" r="4" fill={colours[index % 2]}/><rect x={x - 12} y={index % 2 ? 81 : 22} width="24" height="3" rx="1.5" fill="var(--muted)"/>{/each}
    {:else}
      {#each [2, 6, 10, 14, 18, 22, 26, 30] as day, index}{@const x = 20 + (day - 1) / 29 * 140}<circle cx={x} cy="54" r="4" fill={index < 6 ? 'var(--success)' : 'var(--canvas)'} stroke={index < 6 ? 'var(--success)' : 'var(--accent)'} stroke-width="1.3"/><line x1={x - 4} x2={x + 4} y1="69" y2="69" class="axis"/>{#if index === 3}<circle cx={x} cy="54" r="7" fill="none" stroke="var(--accent)"/>{/if}{/each}
    {/if}
  {:else if family === 10}
    {#if styleId === '10A'}
      <rect x="18" y="22" width="57.6" height="64" fill="var(--accent)"/><rect x="75.6" y="22" width="43.2" height="64" fill="var(--success)"/><rect x="118.8" y="22" width="43.2" height={128 / 3} fill="var(--danger)"/><rect x="118.8" y={22 + 128 / 3} width="43.2" height={64 / 3} fill="var(--rating)"/>
      <path d="M75.6 22V86M118.8 22V86M118.8 64.667H162" stroke="var(--canvas)" fill="none"/>
    {:else}
      <line x1="18" x2="64" y1="22" y2="22" class="axis"/><line x1="120" x2="153" y1="22" y2="22" class="axis"/>
      <rect x="18" y="30" width="57.6" height="58" fill="var(--accent)"/><rect x="75.6" y="30" width="43.2" height="58" fill="var(--success)"/><rect x="118.8" y="30" width="43.2" height={116 / 3} fill="var(--danger)"/><rect x="118.8" y={30 + 116 / 3} width="43.2" height={58 / 3} fill="var(--rating)"/>
      <path d="M75.6 30V88M118.8 68.667H162" stroke="var(--canvas)" fill="none"/><line x1="118.8" x2="118.8" y1="30" y2="88" stroke="var(--canvas)" stroke-width="3"/>
    {/if}
  {:else if family === 11}
    {#if styleId === '11A'}
      <rect x="18" y="43" width="144" height="27" fill="var(--surface)"/><rect x="18" y="50" width="86.4" height="13" fill="var(--success)"/><line x1="133.2" x2="133.2" y1="40" y2="74" stroke="var(--accent)" stroke-width="2.5"/>
    {:else}
      {#each [[18, 72], [90, 36], [126, 36]] as band, index}<rect x={band[0]} y="37" width={band[1]} height="39" fill={colours[index]} fill-opacity=".17"/>{/each}
      <rect x="18" y="55" width="64.8" height="11" fill="var(--accent)"/><circle cx="118.8" cy="46" r="3.5" fill="none" stroke="var(--danger)" stroke-width="1.5"/><line x1="90" x2="90" y1="29" y2="82" stroke="var(--success)" stroke-dasharray="3 3"/>
    {/if}
    <line x1="18" x2="162" y1="82" y2="82" class="axis"/>{#each [18, 54, 90, 126, 162] as x}<line x1={x} x2={x} y1="82" y2="86" class="axis"/>{/each}
  {:else if family === 12}
    {#if styleId === '12A'}
      {#each [120, 72, 48] as width, index}{@const y = 16 + index * 29}<path d={`M${90 - (width + 6) / 2},${y} H${90 + (width + 6) / 2} L${90 + (width - 6) / 2},${y + 19} H${90 - (width - 6) / 2} Z`} fill={colours[index]}/>{#if index < 2}<path d={`M90 ${y + 21}v5m-2-2 2 2 2-2`} fill="none" stroke="var(--muted)"/>{/if}{/each}
    {:else}
      {#each [62, 37.2, 24.8] as height, index}<rect x={18 + index * 48} y={86 - height} width="48" {height} fill={colours[index]}/>{/each}<line x1="18" x2="164" y1="86" y2="86" class="axis"/><path d="M66 24V49M114 49V61" class="grid"/>
    {/if}
  {:else if family === 13}
    {#each styleId === '13B' ? editorialCircles : styleId === '13A' ? playful : packed as bubble}<circle cx={bubble.x} cy={bubble.y} r={bubble.radius} fill={colours[bubble.index % 3]} stroke="var(--canvas)" stroke-width="1.3"/>{#if styleId === '13A' && bubble.radius > 16}<path d={`M${bubble.x - 4} ${bubble.y}h8m-4-4v8`} stroke="var(--canvas)" fill="none"/>{/if}{/each}
    {#if styleId === '13B'}{#each editorialCircles as bubble}<line x1={bubble.x - 8} x2={bubble.x + 8} y1="90" y2="90" class="axis"/>{/each}{/if}
  {:else if styleId === '14A'}
    {#each ribbons as flow}<path d={flow.d} fill={colours[flow.colour]} fill-opacity=".47"/>{/each}
    {#each [[22, 18, 20.8, 0], [22, 46.8, 18.2, 1], [22, 73, 13, 2], [85, 18, 31.2, 0], [85, 62, 20.8, 1], [151, 18, 23.4, 0], [151, 48, 7.8, 1], [151, 65, 20.8, 2]] as node}<rect x={node[0]} y={node[1]} width="6" height={node[2]} fill={colours[node[3]]}/>{/each}
  {:else if styleId === '14B'}
    {#each [20, 40, 60] as tick}<circle cx="90" cy="54" r={9 + tick / 60 * 31} class="grid"/>{/each}
    {#each radial as bar}<path d={bar.path} fill={colours[Math.floor(bar.index / 3)]}/>{/each}<circle cx="90" cy="54" r="7.5" fill="var(--surface)"/>
  {:else if styleId === '14C'}
    {#each [8, 6, 4] as count, row}<line x1="18" x2="35" y1={29 + row * 24} y2={29 + row * 24} class="axis"/>{#each Array(count) as _, index}{@const x = 45 + index * 14}{@const y = 23 + row * 24}<rect {x} {y} width="10" height="12" rx="1" fill="none" stroke={colours[row]} stroke-width="1.2"/><path d={`M${x + 2} ${y}v12m6-12v12M${x} ${y + 4}h2m6 0h2M${x} ${y + 8}h2m6 0h2`} fill="none" stroke={colours[row]} stroke-width=".8"/>{/each}{/each}
  {/if}
</svg>

<style>
  .chart-thumbnail { display: block; width: 100%; height: 92px; pointer-events: none; }
  .axis { fill: none; stroke: var(--line); stroke-width: 1; }
  .grid { fill: none; stroke: var(--line); stroke-width: .8; stroke-dasharray: 2 3; }
  path, line, polygon, circle, rect { vector-effect: non-scaling-stroke; }
</style>
