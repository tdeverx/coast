import { expect, test } from 'bun:test';
import { circleIntersectionArea, frequencyDensity, overlapGeometry, sectorPath } from '../src/routes/ui-preview/charts/standardGeometry';

test('set-circle areas and shared lens encode exact populations, including empty and contained sets', () => {
  // Two unit circles separated by one radius have a known analytic lens area.
  expect(circleIntersectionArea(1, 1, 1)).toBeCloseTo(2 * Math.PI / 3 - Math.sqrt(3) / 2, 12);
  for (const [left, right, shared] of [[60, 50, 30], [80, 70, 50], [60, 50, 40], [80, 50, 30], [100, 80, 60], [120, 100, 80], [60, 30, 0], [60, 30, 30], [30, 60, 30], [30, 30, 30]]) {
    const geometry = overlapGeometry(left, right, shared);
    const areaPerMember = Math.PI * geometry.a ** 2 / left;
    expect(Math.PI * geometry.b ** 2 / areaPerMember).toBeCloseTo(right, 10);
    expect(circleIntersectionArea(geometry.a, geometry.b, geometry.distance) / areaPerMember).toBeCloseTo(shared, 8);
    expect(geometry.paths.join(' ')).not.toMatch(/NaN|Infinity/);
  }
  expect(overlapGeometry(60, 30, 0).paths[1]).toBe('');
  expect(overlapGeometry(60, 30, 30).paths[2]).toBe('');
  expect(overlapGeometry(30, 60, 30).paths[0]).toBe('');
  expect(overlapGeometry(30, 30, 30).paths.filter(Boolean)).toHaveLength(1);
  expect(overlapGeometry(0, 0, 0).paths).toEqual(['', '', '']);
});

test('frequency-weighted density stays inside its declared domain with unit area and no invented zero-sample density', () => {
  const cases: { x: number[]; counts: number[]; domain: [number, number] }[] = [
    { x: [0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250], counts: [0, 4, 16, 36, 28, 12, 4, 0, 0, 0, 0], domain: [0, 250] },
    { x: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5], counts: [0, 0, 0, 2, 4, 8, 20, 26, 16, 4], domain: [0.5, 5] },
    { x: [0, 1, 2, 3, 4, 5, 6, 7, 8], counts: [1, 2, 3, 8, 10, 4, 2, 0, 0], domain: [0, 8] },
  ];
  for (const sample of cases) {
    const density = frequencyDensity(sample.x, sample.counts, sample.domain);
    expect(density).toHaveLength(129);
    expect(density[0].x).toBe(sample.domain[0]);
    expect(density.at(-1)?.x).toBe(sample.domain[1]);
    expect(density.every(point => Number.isFinite(point.y) && point.y >= 0 && point.x >= sample.domain[0] && point.x <= sample.domain[1])).toBe(true);
    const area = density.slice(1).reduce((sum, point, index) => sum + (point.y + density[index].y) / 2 * (point.x - density[index].x), 0);
    expect(area).toBeCloseTo(1, 12);
    const doubled = frequencyDensity(sample.x, sample.counts.map(count => count * 2), sample.domain);
    density.forEach((point, index) => expect(doubled[index].y).toBeCloseTo(point.y, 12));
  }
  expect(frequencyDensity([0.5, 1, 1.5], [0, 0, 0], [0.5, 1.5]).every(point => point.y === 0)).toBe(true);
});

test('a full-circle slice uses two nondegenerate outer arcs, while a ring also returns along its inner boundary', () => {
  const disk = sectorPath(0, 0, 10, 0, 0, 2 * Math.PI);
  expect(disk.match(/ A10,10 /g)).toHaveLength(2);
  expect(disk).toStartWith('M10,0');
  expect(disk).toContain('L0,0 Z');
  const ring = sectorPath(0, 0, 10, 5, 0, 2 * Math.PI);
  expect(ring.match(/ A10,10 /g)).toHaveLength(2);
  expect(ring.match(/ A5,5 /g)).toHaveLength(2);
  expect(ring).not.toContain('L0,0');
  expect(`${disk} ${ring}`).not.toMatch(/NaN|Infinity/);
  expect(sectorPath(0, 0, 10, 0, 0, 0)).toBe('');
  expect(sectorPath(0, 0, 0, 0, 0, 2 * Math.PI)).toBe('');
});
