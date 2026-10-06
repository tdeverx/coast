import { expect, test } from 'bun:test';
import { isotypeFractions, layoutBubbles, layoutFlows, partitionTreemap, radialLength } from '../src/lib/ui/charts/extended-geometry';

test('treemap partitions preserve exact area and total for unequal leaves', () => {
  const values = [40, 25, 20, 10, 5];
  const cells = partitionTreemap(values.map((value, index) => ({ index, value })), { x: 20, y: 24, width: 720, height: 330 });
  for (const cell of cells) expect(cell.width * cell.height / (720 * 330)).toBeCloseTo(values[cell.index] / 100, 12);
  expect(cells.reduce((sum, cell) => sum + cell.width * cell.height, 0)).toBeCloseTo(720 * 330, 8);
  for (const cell of cells) for (const other of cells.filter((candidate) => candidate.index !== cell.index)) {
    const intersectWidth = Math.max(0, Math.min(cell.x + cell.width, other.x + other.width) - Math.max(cell.x, other.x));
    const intersectHeight = Math.max(0, Math.min(cell.y + cell.height, other.y + other.height) - Math.max(cell.y, other.y));
    expect(intersectWidth * intersectHeight).toBeCloseTo(0, 8);
  }
});

test('all bubble arrangements preserve square-root radii without encoding unknown scores', () => {
  const rows = [40, 30, 20, 12, 8, null].map((value, index) => ({ label: String(index), value }));
  for (const kind of ['playful', 'editorial', 'packed'] as const) {
    const circles = layoutBubbles(rows, kind, { x: 24, y: 26, width: 712, height: 350 });
    expect(circles).toHaveLength(5);
    expect(circles.some((circle) => circle.index === 5)).toBe(false);
    const first = circles.find((circle) => circle.index === 0)!;
    for (const circle of circles) {
      expect(circle.radius ** 2 / first.radius ** 2).toBeCloseTo(rows[circle.index].value! / 40, 12);
      for (const other of circles.filter((candidate) => candidate.index !== circle.index)) expect(Math.hypot(circle.x - other.x, circle.y - other.y) + 0.001).toBeGreaterThanOrEqual(circle.radius + other.radius);
    }
  }
});

test('flow widths and node heights share one count scale and conserve intermediate counts', () => {
  const flows = [
    { source: 'Collection', target: 'Started', value: 36 },
    { source: 'Collection', target: 'Cancelled', value: 4 },
    { source: 'Assessment', target: 'Started', value: 38 },
    { source: 'Assessment', target: 'Cancelled', value: 2 },
    { source: 'Journal', target: 'Started', value: 36 },
    { source: 'Journal', target: 'Cancelled', value: 4 },
    { source: 'Started', target: 'Completed', value: 90 },
    { source: 'Started', target: 'Failed', value: 20 },
    { source: 'Cancelled', target: 'Cancelled final', value: 10 },
  ];
  const geometry = layoutFlows(flows, { x: 128, y: 30, width: 488, height: 330 });
  expect(geometry.ribbons).toHaveLength(flows.length);
  for (const ribbon of geometry.ribbons) expect(ribbon.thickness / ribbon.value).toBeCloseTo(geometry.scale, 12);
  for (const node of geometry.nodes) {
    expect(node.height / node.value).toBeCloseTo(geometry.scale, 12);
    const incoming = flows.filter((flow) => flow.target === node.label).reduce((sum, flow) => sum + flow.value, 0);
    const outgoing = flows.filter((flow) => flow.source === node.label).reduce((sum, flow) => sum + flow.value, 0);
    if (incoming && outgoing) expect(incoming).toBe(outgoing);
  }
  expect(geometry.nodes.filter((node) => node.column === 0).reduce((sum, node) => sum + node.value, 0)).toBe(120);
  expect(geometry.nodes.filter((node) => node.column === 2).reduce((sum, node) => sum + node.value, 0)).toBe(120);
});

test('radial counts are linear from the same zero ring', () => {
  expect(radialLength(0, 60, 42, 148)).toBe(42);
  expect(radialLength(60, 60, 42, 148)).toBe(148);
  expect(radialLength(40, 60, 42, 148) - 42).toBeCloseTo(2 * (radialLength(20, 60, 42, 148) - 42), 12);
});

test('isotype units are exact, fractional where needed, and only fill declared capacity', () => {
  expect(isotypeFractions(10, 1)).toEqual(Array(10).fill(1));
  expect(isotypeFractions(7.5, 5)).toEqual([1, .5]);
  expect(isotypeFractions(8, 1, 10)).toEqual([...Array(8).fill(1), 0, 0]);
  expect(isotypeFractions(0, 1)).toEqual([]);
  expect(isotypeFractions(0, 1, 2)).toEqual([0, 0]);
});
