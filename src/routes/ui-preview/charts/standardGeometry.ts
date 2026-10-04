/** Pure, bounded geometry for the preview's line, composition and distribution families. */
export type Coordinate = { x: number; y: number };

export function scale(value: number, domain: [number, number], from: number, to: number) {
  return from + (value - domain[0]) / (domain[1] - domain[0] || 1) * (to - from);
}

export function linePath(points: Coordinate[]) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
}

export function bandPath(top: Coordinate[], bottom: Coordinate[]) {
  return `${linePath(top)} ${linePath([...bottom].reverse()).replace(/^M/, 'L')} Z`;
}

export function polar(cx: number, cy: number, radius: number, angle: number): Coordinate {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

export function sectorPath(cx: number, cy: number, radius: number, inner: number, start: number, end: number) {
  if (radius <= 0 || end <= start) return '';
  // Two arcs handle the single-category, full-circle case without an SVG degenerate arc.
  const middle = (start + end) / 2;
  const a = polar(cx, cy, radius, start), b = polar(cx, cy, radius, middle), c = polar(cx, cy, radius, end);
  const outside = `M${a.x},${a.y} A${radius},${radius} 0 0 1 ${b.x},${b.y} A${radius},${radius} 0 0 1 ${c.x},${c.y}`;
  if (!inner) return `${outside} L${cx},${cy} Z`;
  const d = polar(cx, cy, inner, end), e = polar(cx, cy, inner, middle), f = polar(cx, cy, inner, start);
  return `${outside} L${d.x},${d.y} A${inner},${inner} 0 0 0 ${e.x},${e.y} A${inner},${inner} 0 0 0 ${f.x},${f.y} Z`;
}

export function circleIntersectionArea(a: number, b: number, distance: number) {
  if (distance >= a + b) return 0;
  if (distance <= Math.abs(a - b)) return Math.PI * Math.min(a, b) ** 2;
  const ca = Math.max(-1, Math.min(1, (distance ** 2 + a ** 2 - b ** 2) / (2 * distance * a)));
  const cb = Math.max(-1, Math.min(1, (distance ** 2 + b ** 2 - a ** 2) / (2 * distance * b)));
  return a ** 2 * Math.acos(ca) + b ** 2 * Math.acos(cb)
    - 0.5 * Math.sqrt(Math.max(0, (-distance + a + b) * (distance + a - b) * (distance - a + b) * (distance + a + b)));
}

/** Circle areas and lens area encode exact set sizes; 60 bisections are independent of UI state. */
export function overlapGeometry(left: number, right: number, shared: number) {
  const radiusA = Math.sqrt(Math.max(0, left) / Math.PI), radiusB = Math.sqrt(Math.max(0, right) / Math.PI);
  const target = Math.max(0, Math.min(left, right, shared));
  let low = Math.abs(radiusA - radiusB), high = radiusA + radiusB;
  for (let i = 0; i < 60; i++) {
    const midpoint = (low + high) / 2;
    if (circleIntersectionArea(radiusA, radiusB, midpoint) > target) low = midpoint;
    else high = midpoint;
  }
  const distance = (low + high) / 2;
  const factor = Math.min(165 / (Math.max(radiusA, radiusB) || 1), 640 / (radiusA + radiusB + distance || 1));
  const a = radiusA * factor, b = radiusB * factor, d = distance * factor;
  const xA = 450 - (d + b - a) / 2, xB = xA + d, cy = 222;
  const circleA = sectorPath(xA, cy, a, 0, 0, Math.PI * 2), circleB = sectorPath(xB, cy, b, 0, 0, Math.PI * 2);
  if (!target) {
    return { a, b, distance: d, xA, xB, cy, paths: [circleA, '', circleB] };
  }
  if (target === Math.min(left, right)) {
    return { a, b, distance: d, xA, xB, cy, paths: [left > right ? `${circleA} ${circleB}` : '', left < right ? circleA : circleB, right > left ? `${circleB} ${circleA}` : ''] };
  }
  const localX = (d * d + a * a - b * b) / (2 * d), height = Math.sqrt(Math.max(0, a * a - localX * localX));
  const x = xA + localX, top = `${x},${cy - height}`, bottom = `${x},${cy + height}`;
  const leftOuter = localX >= 0 ? 1 : 0, rightOuter = localX - d <= 0 ? 1 : 0;
  const leftOnly = `M${top} A${a},${a} 0 ${leftOuter} 0 ${bottom} A${b},${b} 0 ${1 - rightOuter} 1 ${top} Z`;
  const both = `M${top} A${a},${a} 0 ${1 - leftOuter} 1 ${bottom} A${b},${b} 0 ${1 - rightOuter} 1 ${top} Z`;
  const rightOnly = `M${top} A${b},${b} 0 ${rightOuter} 1 ${bottom} A${a},${a} 0 ${1 - leftOuter} 0 ${top} Z`;
  return { a, b, distance: d, xA, xB, cy, paths: [leftOnly, both, rightOnly] };
}

/** Frequency-weighted Gaussian density, bounded and normalised over the declared domain. */
export function frequencyDensity(xs: number[], counts: number[], domain: [number, number], samples = 129) {
  const positiveSteps = xs.slice(1).map((value, i) => value - xs[i]).filter((value) => value > 0);
  const step = positiveSteps.length ? Math.min(...positiveSteps) : 1;
  const bandwidth = Math.max(step * 0.65, (domain[1] - domain[0]) / 100);
  const points = Array.from({ length: samples }, (_, index) => {
    const x = scale(index, [0, samples - 1], domain[0], domain[1]);
    const y = xs.reduce((sum, value, i) => sum + (counts[i] || 0) * Math.exp(-0.5 * ((x - value) / bandwidth) ** 2), 0);
    return { x, y };
  });
  const integral = points.slice(1).reduce((sum, point, index) => sum + (point.y + points[index].y) / 2 * (point.x - points[index].x), 0);
  return points.map((point) => ({ x: point.x, y: integral ? point.y / integral : 0 }));
}
