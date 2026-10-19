import type { CameraPose, FocusAnchor, FocusSession, Point, Rotation } from './model.ts';
export function pageFrame(width: number, height: number, aspect: number, planeZ = 0, inset = 0) {
  const visibleWidth = width * 1.08, visibleHeight = visibleWidth / Math.max(.1, aspect);
  return { planeZ, inset, distance: planeZ + visibleHeight / (2 * Math.tan(35 * Math.PI / 360)), visibleHeight, limit: Math.max(0, (height - visibleHeight * (1 - 2 * inset)) / 2) };
}
export const clampScroll = (position: number, limit: number) => Math.max(-limit, Math.min(limit, position));
export function swipeDirection(dx: number, dy: number) {
  return Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.25 ? (dx < 0 ? 1 : -1) : 0;
}
export function anchoredPosition(position: number, anchor: number, oldZoom: number, newZoom: number) {
  return anchor + (position - anchor) * oldZoom / newZoom;
}
export function manualFocusProgress(progress: number, delta: number) {
  return Math.max(0, Math.min(2, progress - delta / 650));
}
export function manualFocusZoom(progress: number) {
  return 1 + Math.max(0, progress - 1) * 1.5;
}
export function canRetargetFocus(session: FocusSession, hoverSide: number, delta: number) {
  return session.opened && delta < 0 && session.progress > 0 && (hoverSide === -1 || hoverSide === 1) && hoverSide !== session.side;
}
// Wheel travel advances the handoff even when manual zoom is already at its cap.
export const advanceFocusBlend = (blend: number, delta: number) => Math.max(0, Math.min(1, blend - delta / 260));
// After retargeting, zoom out from the current pose rather than revisiting
// the previous page's intermediate anchor, including a partially completed handoff.
export const focusReturnAnchor = (progress: number, pose: CameraPose) => progress > 0 ? { progress, pose } : undefined;
export function manualFocusPose(progress: number, spread: CameraPose, target: CameraPose, anchor?: FocusAnchor): CameraPose {
  const p = Math.max(0, Math.min(2, progress));
  let from = spread, to = target, fraction = Math.min(1, p);
  if (anchor?.blend !== undefined) {
    from = anchor.pose;
    to = manualFocusPose(p, spread, target);
    fraction = anchor.blend;
  }
  else if (anchor?.progress !== undefined) {
    if (p <= anchor.progress) {
      to = anchor.pose;
      fraction = p / anchor.progress;
    }
    else {
      from = anchor.pose;
      fraction = (p - anchor.progress) / ((anchor.progress < 1 ? 1 : 2) - anchor.progress);
    }
  }
  fraction = Math.max(0, Math.min(1, fraction));
  const t = fraction * fraction * (3 - 2 * fraction), mix = (a: number, b: number) => a + (b - a) * t;
  return { position: Object.fromEntries((['x', 'y', 'z'] as const).map(axis => [axis, mix(from.position[axis], to.position[axis])])) as Point, zoom: mix(from.zoom, to.zoom), rotation: from.rotation.map((value: number, i) => mix(value, to.rotation[i])) as Rotation };
}
export function recoverFocusProgress(distance: number, spreadDistance: number, pageDistance: number) {
  if (distance < pageDistance && spreadDistance > pageDistance)
    return Math.min(2, 1 + (pageDistance / Math.max(.001, distance) - 1) / 1.5);
  const span = spreadDistance - pageDistance;
  if (Math.abs(span) < 1e-8)
    return 0;
  const fraction = Math.max(0, Math.min(1, (spreadDistance - distance) / span));
  let low = 0, high = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    if (mid * mid * (3 - 2 * mid) < fraction)
      low = mid;
    else
      high = mid;
  }
  return fraction === 0 ? 0 : fraction === 1 ? 1 : (low + high) / 2;
}
export function wheelFocusMode(view: string, modified = false) {
  return view === 'page' && !modified ? 'scroll' : view === 'spread' ? 'focus' : 'cursor';
}
export function readingTurnBlend(progress: number) {
  const t = Math.max(0, Math.min(1, (progress - .3) / .7));
  return t * t * (3 - 2 * t);
}
export function readingStep({ opened, backCover, side, index, count }: {
  opened: boolean;
  backCover: boolean;
  side: number;
  index: number;
  count: number;
}, direction: number) {
  if (!opened)
    return ((!backCover && direction > 0) || (backCover && direction < 0)) ? 'open' : 'stay';
  if ((direction > 0 && side < 0 && index + 1 < count - 1) || (direction < 0 && side > 0))
    return 'side';
  if (direction < 0 && index <= 1)
    return 'front';
  if (direction > 0 && index + 2 >= count - 1)
    return 'back';
  return 'turn';
}
export const frameZoomDistance = (frame: {
  planeZ: number;
  distance: number;
}, zoom: number) => frame.planeZ + (frame.distance - frame.planeZ) / zoom;
// Reframe against the visible surface, preserving artwork size and zoom/pan.
export function reframeSurface(position: Point, before: {
  width: number;
  center: Point;
}, after: {
  width: number;
  center: Point;
}): Point {
  const scale = after.width / before.width;
  return Object.fromEntries((['x', 'y', 'z'] as const).map(axis => [axis, after.center[axis] + (position[axis] - before.center[axis]) * scale])) as Point;
}
