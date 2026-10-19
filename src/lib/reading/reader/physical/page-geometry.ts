import type { BindingKind, PageGrab, PageOptions } from './model.ts';
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const pageMeshSegments = Object.freeze({ width: 96, height: 24 });
// Keep the original hit, then steer the active curl height with vertical
// travel in page-height units. Top, middle and bottom form one continuous
// range rather than switching between separate turn shapes. Steering opposes
// pointer travel: pulling a top corner down preserves its top-corner curl.
export const curlGrabHeight = (grab: PageGrab | undefined) => clamp((grab?.v ?? .5) - (grab?.pullY ?? 0), 0, 1);
// Concentrate the existing mesh subdivisions around the narrow binding fold.
export const hingeSample = (u: number) => u * u;
// Depth separation and turn clearance begin away from the shared gutter.
export function gutterWeight(u: number) {
  const t = clamp(u / .08, 0, 1);
  return t * t * (3 - 2 * t);
}
export const maxPageCurl = 4;
export function pageDimensions(kind: BindingKind, width: number, height: number) {
  const scale = kind === 'book' ? .985 : 1;
  return { width: width * scale, height: height * scale };
}
export const paperEdgeLinesPerTile = 32;
// A fixed physical pitch adds more visible layers as a stack gets thicker.
export const paperEdgeRepeat = (depth: number, height: number) => Math.max(0, depth) / (height * .0004 * paperEdgeLinesPerTile);
// Spread the fold further into the existing footprint for a gentler shoulder,
// including a small minimum so ordinary thin comics get the relaxed curve too.
export const comicSpineWidth = (width: number, depth: number) => Math.min(width * .2, Math.max(width * .008, depth * .75));
export function comicSpineProfile(distance: number, offset: number, halfDepth: number, taperWidth: number, skin: number) {
  const radius = Math.min(taperWidth * .3, halfDepth * .8, Math.max(taperWidth * .04, halfDepth * .1, halfDepth * skin * 2));
  const controlZ = Math.min(halfDepth * .8, Math.sqrt(radius * taperWidth * .45 / 1.5));
  const controlX = Math.min(taperWidth * .45, 1.5 * controlZ * controlZ / radius);
  // Parameterize the bevel by projected distance, rather than Bézier time.
  // Keeping the outer face's X coordinate fixed also keeps its printed image
  // at the original scale, without changing UVs during opening or closing.
  let t = clamp(distance / taperWidth, 0, 1);
  if (t > 0 && t < 1) {
    let low = 0, high = 1;
    for (let i = 0; i < 18; i++) {
      const middle = (low + high) / 2, x = middle * middle * (3 * controlX + (taperWidth - 3 * controlX) * middle);
      if (x < distance)
        low = middle;
      else
        high = middle;
    }
    t = (low + high) / 2;
  }
  const s = 1 - t;
  const fraction = clamp(offset / halfDepth, -1, 1);
  const z = 3 * s * s * t * controlZ + (3 * s * t * t + t * t * t) * halfDepth;
  return {
    x: radius * Math.sqrt(Math.max(0, 1 - fraction * fraction)) * s * s,
    z: offset * z / halfDepth,
  };
}
/** A rounded fold rolls the free corner back over the remaining sheet.
* u=0 is the fixed spine, u=1 the free edge; v=0 bottom, v=1 top.
* The part before the diagonal fold stays planar. The bend is a cylindrical
* strip, followed by a folded flap with the same tangent: no sharp crease.
*/
function foldFlex(v: number, { stiffness = 0, bendScale = 1, grab, corner = 0 }: Partial<PageOptions> = {}) {
  const handle = grab ?? { v: (1 + clamp(corner, -1, 1)) / 2 }, pull = clamp(grab?.pullY ?? 0, -1, 1);
  // Travel still loads the whole sheet. Bias follows the active curl height,
  // becoming balanced as the gesture crosses the middle of the page.
  const heightBias = 2 * curlGrabHeight(handle) - 1;
  const gain = 1 + Math.abs(pull) * (.75 + heightBias * (2 * v - 1) * .5);
  return { handle, gain, flex: clamp(bendScale, 0, 1) * (1 - clamp(stiffness, 0, 1)) * (1 - Math.exp(-3 * gain)) };
}
export function pageTurnRotation(v: number, progress: number, options: Partial<PageOptions> = {}) {
  const p = clamp(progress, 0, 1), envelope = p === 0 || p === 1 ? 0 : Math.sin(Math.PI * p);
  return Math.PI * p * (1 - foldFlex(v, options).flex * envelope);
}
export function samplePage(u: number, v: number, progress: number, { width, height, side = 1, curl = .45, restCurl = .085, corner = 0, bendScale = 1, stiffness = 0, grab }: PageOptions) {
  u = clamp(u, 0, 1);
  v = clamp(v, 0, 1);
  progress = clamp(progress, 0, 1);
  const options = { stiffness, bendScale, grab, corner };
  const { handle, gain, flex } = foldFlex(v, options);
  const envelope = progress === 0 || progress === 1 ? 0 : Math.sin(Math.PI * progress);
  const rotation = Math.PI * progress * (1 - flex * envelope), c = Math.cos(rotation), s = Math.sin(rotation);
  // The diagonal crease starts at the grabbed corner and travels all the way
  // toward the binding, straightening as the full sheet comes across.
  // From a middle-edge grab, reaching the top/bottom is half a page-height.
  // Give that same travel the full width of the curl, all the way to its seam.
  const verticalTravel = Math.abs(grab?.pullY ?? 0) * 2;
  const travel = progress + verticalTravel;
  const axisAngle = (2 * curlGrabHeight(handle) - 1) * .95 * (1 - progress);
  const ax = Math.cos(axisAngle), ay = Math.sin(axisAngle);
  // Steering reaches the top/bottom at half a page-height of travel. Keep
  // feeding the same roll after that: vertical distance advances its front
  // across the top/bottom edge toward the seam, just as sideways travel does.
  const extent = ax * width * Math.min(1, travel);
  const offset = ax * width + Math.abs(ay) * height / 2 - extent;
  const extraRoll = .35 + clamp(curl, 0, maxPageCurl) / 3;
  const roll = Math.min(Math.PI - rotation, flex * envelope * Math.PI * (travel + extraRoll * envelope));
  let x = u * width, y = (v - .5) * height, z = 0, dx = 1, dy = 0, dz = 0, nx = 0, ny = 0, nz = 1;
  const distance = ax * x + ay * y - offset;
  if (u > 0 && distance > 0 && extent > 0 && roll > 0) {
    const baseRadius = ax * width * .18 * envelope / (1 + gain * .25);
    const rounded = clamp(verticalTravel, 0, 1), roundBlend = rounded * rounded * (3 - 2 * rounded);
    // A deep vertical pull broadens the rolled strip instead of extending
    // an increasingly long straight flap. At full load the entire moving
    // region is a circular arc, retaining its original printed length.
    const radius = baseRadius + Math.max(0, extent / roll - baseRadius) * roundBlend;
    const arc = Math.min(distance, radius * roll), angle = arc / radius, flap = Math.max(0, distance - arc);
    const along = radius * Math.sin(angle) + flap * Math.cos(roll), shift = along - distance;
    x += ax * shift;
    y += ay * shift;
    z = radius * (1 - Math.cos(angle)) + flap * Math.sin(roll);
    // Tangent along a printed row, and the smooth fold normal. The cylinder
    // and its folded flap meet with matching positions and tangents.
    dx = 1 + ax * ax * (Math.cos(angle) - 1);
    dy = ax * ay * (Math.cos(angle) - 1);
    dz = ax * Math.sin(angle);
    nx = -ax * Math.sin(angle);
    ny = -ay * Math.sin(angle);
    nz = Math.cos(angle);
  }
  const projectedX = c * x - s * z, restU = clamp(Math.abs(projectedX) / width, 0, 1);
  const rise = width * restCurl * restU * (1 - restU);
  return { x: u === 0 ? 0 : side * projectedX, y, z: s * x + c * z + rise,
    tx: side * (c * dx - s * dz), ty: dy, tz: s * dx + c * dz,
    nx: side * (c * nx - s * nz), ny, nz: s * nx + c * nz };
}
// The same sampler keeps permanent covers, printed sheets and their blocks
// on one continuous surface. Resting bows keep their fixed printed footprint.
export const layerRestCurl = (value: number) => clamp(value, 0, maxPageCurl) * .18;
export const sampleLeaf = samplePage;
// Start an opening cover in its closed frame, curling upward from the
// selected free edge. Both covers use this mirror of the ordinary turn;
// reversing the closing deformation would begin at the end of its curl.
export function sampleOpeningLeaf(u: number, v: number, fold: number, options: PageOptions) {
  const p = sampleLeaf(u, v, 1 - fold, options);
  return { ...p, x: u === 0 ? 0 : -p.x, tx: -p.tx, ny: -p.ny, nz: -p.nz };
}
// DC's 100-page Giant format is the large-comic reference, not a physical
// printing standard. Use normalized reader pages, including cover faces.
export const comicThicknessBounds = Object.freeze({ min: .5, max: 3, referencePages: 100 });
export const comicThicknessPercent = (count: number) => clamp(count / comicThicknessBounds.referencePages * comicThicknessBounds.max, comicThicknessBounds.min, comicThicknessBounds.max);
export const comicThickness = (count: number, height: number) => height * comicThicknessPercent(count) / 100;
// Paper keeps the same resting curve in either binding. Only cover hinges
// control how that curve flattens during closing.
export function restingPageCurl(curl: number, frontFold = 0, backFold = 0) {
  const strength = clamp(curl, 0, maxPageCurl);
  return (.055 + Math.min(strength, 1) * .06 + Math.max(0, strength - 1) * .18) * (1 - Math.max(frontFold, backFold)) ** 2;
}
