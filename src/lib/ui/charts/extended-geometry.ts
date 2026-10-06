import type { ChartFlow, ChartRow } from './model';

export interface Rect { x: number; y: number; width: number; height: number }
export interface TreemapCell extends Rect { index: number; value: number }
export interface Bubble { index: number; x: number; y: number; radius: number }

/** Binary rectangular partitions keep each leaf's area exactly proportional. */
export function partitionTreemap(items: { index: number; value: number }[], box: Rect): TreemapCell[] {
  const positive = items.filter((item) => item.value > 0);
  if (!positive.length) return [];
  if (positive.length === 1) return [{ ...box, ...positive[0] }];
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  let split = 1;
  let firstTotal = positive[0].value;
  while (split < positive.length - 1 && Math.abs(firstTotal + positive[split].value - total / 2) < Math.abs(firstTotal - total / 2)) {
    firstTotal += positive[split++].value;
  }
  const fraction = firstTotal / total;
  const first = box.width >= box.height
    ? { ...box, width: box.width * fraction }
    : { ...box, height: box.height * fraction };
  const second = box.width >= box.height
    ? { ...box, x: box.x + first.width, width: box.width - first.width }
    : { ...box, y: box.y + first.height, height: box.height - first.height };
  return [...partitionTreemap(positive.slice(0, split), first), ...partitionTreemap(positive.slice(split), second)];
}

function bounds(circles: Bubble[]) {
  const left = Math.min(...circles.map((circle) => circle.x - circle.radius));
  const top = Math.min(...circles.map((circle) => circle.y - circle.radius));
  const right = Math.max(...circles.map((circle) => circle.x + circle.radius));
  const bottom = Math.max(...circles.map((circle) => circle.y + circle.radius));
  return { left, top, width: right - left, height: bottom - top };
}

function fitBubbles(circles: Bubble[], box: Rect): Bubble[] {
  if (!circles.length) return [];
  const extent = bounds(circles);
  const scale = Math.min(box.width / extent.width, box.height / extent.height);
  const xOffset = box.x + (box.width - extent.width * scale) / 2;
  const yOffset = box.y + (box.height - extent.height * scale) / 2;
  return circles.map((circle) => ({ ...circle, x: xOffset + (circle.x - extent.left) * scale, y: yOffset + (circle.y - extent.top) * scale, radius: circle.radius * scale }));
}

function tangentCandidates(a: Bubble, b: Bubble, radius: number, gap: number): { x: number; y: number }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const ar = a.radius + radius + gap;
  const br = b.radius + radius + gap;
  if (!distance || distance > ar + br || distance < Math.abs(ar - br)) return [];
  const along = (ar * ar - br * br + distance * distance) / (2 * distance);
  const perpendicular = Math.sqrt(Math.max(0, ar * ar - along * along));
  const x = a.x + along * dx / distance;
  const y = a.y + along * dy / distance;
  return [{ x: x - perpendicular * dy / distance, y: y + perpendicular * dx / distance }, { x: x + perpendicular * dy / distance, y: y - perpendicular * dx / distance }];
}

/** All layouts apply one scale to sqrt(value), so changing arrangement preserves area ratios. */
export function layoutBubbles(rows: ChartRow[], kind: 'playful' | 'editorial' | 'packed', box: Rect): Bubble[] {
  const items = rows.flatMap((row, index) => row.value !== null && row.value > 0 ? [{ index, radius: Math.sqrt(row.value) }] : []);
  if (!items.length) return [];
  const gap = 0.6;
  if (kind === 'editorial') {
    let cursor = 0;
    const largest = Math.max(...items.map((item) => item.radius));
    return fitBubbles(items.map((item) => {
      const circle = { ...item, x: cursor + item.radius, y: largest - item.radius };
      cursor += 2 * item.radius + gap;
      return circle;
    }), box);
  }
  if (kind === 'playful') {
    const columns = Math.ceil(Math.sqrt(items.length));
    const circles: Bubble[] = [];
    let top = 0;
    for (let offset = 0; offset < items.length; offset += columns) {
      const row = items.slice(offset, offset + columns);
      const largest = Math.max(...row.map((item) => item.radius));
      let left = offset / columns % 2 ? largest / 2 : 0;
      for (const item of row) {
        circles.push({ ...item, x: left + item.radius, y: top + largest });
        left += 2 * item.radius + gap;
      }
      top += 2 * largest + gap;
    }
    return fitBubbles(circles, box);
  }
  const sorted = [...items].sort((a, b) => b.radius - a.radius || a.index - b.index);
  const circles: Bubble[] = [{ ...sorted[0], x: 0, y: 0 }];
  for (const item of sorted.slice(1)) {
    const candidates: { x: number; y: number }[] = [];
    for (let a = 0; a < circles.length; a++) {
      const first = circles[a];
      for (const angle of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
        candidates.push({ x: first.x + (first.radius + item.radius + gap) * Math.cos(angle), y: first.y + (first.radius + item.radius + gap) * Math.sin(angle) });
      }
      for (let b = a + 1; b < circles.length; b++) candidates.push(...tangentCandidates(first, circles[b], item.radius, gap));
    }
    let best: Bubble | undefined;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      if (circles.some((circle) => Math.hypot(circle.x - candidate.x, circle.y - candidate.y) + 1e-8 < circle.radius + item.radius + gap)) continue;
      const bubble = { ...item, ...candidate };
      const extent = bounds([...circles, bubble]);
      const score = Math.max(extent.width / box.width, extent.height / box.height) + Math.hypot(candidate.x, candidate.y) * 0.0001;
      if (score < bestScore) { best = bubble; bestScore = score; }
    }
    // The cardinal candidates always provide a valid position beyond the existing extent.
    circles.push(best ?? { ...item, x: bounds(circles).left - item.radius - gap, y: 0 });
  }
  return fitBubbles(circles, box).sort((a, b) => a.index - b.index);
}

export interface FlowNode { label: string; value: number; column: number; x: number; y: number; height: number; index: number }
export interface FlowRibbon { index: number; source: FlowNode; target: FlowNode; value: number; thickness: number; path: string }

/** One count scale for every node and link; both ribbon ends have equal thickness. */
export function layoutFlows(flows: ChartFlow[], box: Rect): { nodes: FlowNode[]; ribbons: FlowRibbon[]; scale: number } {
  const labels = [...new Set(flows.flatMap((flow) => [flow.source, flow.target]))];
  const columns = new Map(labels.map((label) => [label, 0]));
  // The fixtures are small directed acyclic graphs. Bounded relaxation finds their stages.
  for (let pass = 0; pass < labels.length; pass++) {
    let changed = false;
    for (const flow of flows) {
      const next = (columns.get(flow.source) ?? 0) + 1;
      if (next > (columns.get(flow.target) ?? 0)) { columns.set(flow.target, next); changed = true; }
    }
    if (!changed) break;
  }
  const maxColumn = Math.max(1, ...columns.values());
  const sums = labels.map((label, index) => ({ label, index, column: columns.get(label) ?? 0, value: Math.max(flows.filter((flow) => flow.source === label).reduce((sum, flow) => sum + flow.value, 0), flows.filter((flow) => flow.target === label).reduce((sum, flow) => sum + flow.value, 0)) }));
  const stages = Array.from({ length: maxColumn + 1 }, (_, column) => sums.filter((node) => node.column === column));
  const gap = 18;
  const scale = Math.min(...stages.filter((stage) => stage.length).map((stage) => (box.height - (stage.length - 1) * gap) / Math.max(1, stage.reduce((sum, node) => sum + node.value, 0))));
  const nodes = stages.flatMap((stage, column) => {
    const occupied = stage.reduce((sum, node) => sum + node.value * scale, 0) + Math.max(0, stage.length - 1) * gap;
    let cursor = box.y + (box.height - occupied) / 2;
    return stage.map((node) => {
      const result = { ...node, x: box.x + column * box.width / maxColumn, y: cursor, height: node.value * scale };
      cursor += result.height + gap;
      return result;
    });
  });
  const byLabel = new Map(nodes.map((node) => [node.label, node]));
  const sourceOffsets = new Map<string, number>();
  const targetOffsets = new Map<string, number>();
  const ribbons = flows.flatMap((flow, index) => {
    const source = byLabel.get(flow.source);
    const target = byLabel.get(flow.target);
    if (!source || !target || flow.value <= 0) return [];
    const thickness = flow.value * scale;
    const sy = source.y + (sourceOffsets.get(source.label) ?? 0);
    const ty = target.y + (targetOffsets.get(target.label) ?? 0);
    sourceOffsets.set(source.label, sy - source.y + thickness);
    targetOffsets.set(target.label, ty - target.y + thickness);
    const sx = source.x + 12;
    const tx = target.x;
    const midpoint = (sx + tx) / 2;
    return [{ index, source, target, value: flow.value, thickness, path: `M${sx},${sy} C${midpoint},${sy} ${midpoint},${ty} ${tx},${ty} L${tx},${ty + thickness} C${midpoint},${ty + thickness} ${midpoint},${sy + thickness} ${sx},${sy + thickness} Z` }];
  });
  return { nodes, ribbons, scale };
}

/** No filler unless a real capacity is declared; the final unit can be fractional. */
export function isotypeFractions(value: number, unit: number, capacity?: number): number[] {
  const divisor = unit > 0 ? unit : 1;
  const count = Math.ceil(Math.max(value, capacity ?? value, 0) / divisor);
  return Array.from({ length: count }, (_, index) => Math.max(0, Math.min(1, value / divisor - index)));
}

export function radialLength(value: number, maximum: number, inner: number, outer: number) {
  return inner + Math.max(0, Math.min(1, value / Math.max(1, maximum))) * (outer - inner);
}

export function radialSector(cx: number, cy: number, inner: number, outer: number, start: number, end: number) {
  const point = (radius: number, angle: number) => `${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`;
  return `M${point(outer, start)} A${outer},${outer} 0 0 1 ${point(outer, end)} L${point(inner, end)} A${inner},${inner} 0 0 0 ${point(inner, start)} Z`;
}
