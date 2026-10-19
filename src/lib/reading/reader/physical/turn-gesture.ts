import type { PageGrab } from './model.ts';
type Draw = (progress: number) => void;
type GestureOptions = {
  isOpen(event: PointerEvent): boolean;
  isBusy(): boolean;
  canTurn(direction: number): boolean;
  turn(direction: number): unknown;
  fit(): unknown;
  tap?(event: PointerEvent): void;
  grabAt?(event: PointerEvent): PageGrab | null;
  pan?(dy: number): void;
  swipe?(dx: number, dy: number): void;
  canRotate?(direction: number): boolean;
  rotate?(dx: number): void;
  finishRotate?(): unknown;
};
type Drag = {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  progress: number;
  grab: PageGrab | null;
  corner: number;
  started: boolean;
  rotating: boolean;
  direction: number;
  ended?: boolean;
  commit?: boolean;
  draw?: Draw;
  finish?: () => void;
};
export const dragProgress = (distance: number, width: number) => Math.max(0, Math.min(1, distance / Math.max(1, width * .55)));
export const shouldCommit = (progress: number) => progress >= .38;
export const turnEase = (t: number) => t * t * (3 - 2 * t);
export function releaseTiming(fullDuration: number, progress: number, commit: boolean) {
  const value = Math.max(0, Math.min(1, progress));
  let low = 0, high = 1;
  for (let i = 0; i < 32; i++) {
    const middle = (low + high) / 2;
    if (turnEase(middle) < value)
      low = middle;
    else
      high = middle;
  }
  const phase = value === 0 ? 0 : value === 1 ? 1 : (low + high) / 2, target = commit ? 1 : 0;
  return { phase, target, duration: fullDuration * Math.abs(target - phase) };
}
/** Owns curl gestures; renderer retains ownership of pages and textures. */
export function dragTurns(host: HTMLElement, { isOpen, isBusy, canTurn, turn, fit, tap = fit, grabAt = () => null, pan = () => {
}, swipe = () => {
}, canRotate = () => false, rotate = () => {
}, finishRotate = () => {
} }: GestureOptions) {
  const lifetime = new AbortController();
  let active: Drag | undefined;
  const listen = (name: keyof HTMLElementEventMap, fn: (event: PointerEvent) => void) => host.addEventListener(name, fn as EventListener, { capture: true, signal: lifetime.signal });
  listen('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || !isOpen(e) || isBusy())
      return;
    e.stopImmediatePropagation();
    const grab = grabAt(e);
    active = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, progress: 0, grab: grab ? { ...grab, pullY: 0 } : null, corner: Math.max(-1, Math.min(1, ((e.clientY - host.getBoundingClientRect().top) / host.clientHeight - .5) * 1.4)), started: false, rotating: false, direction: 1 };
    host.setPointerCapture(e.pointerId);
  });
  listen('pointermove', (e: PointerEvent) => {
    const a = active;
    if (!a || a.id !== e.pointerId)
      return;
    e.stopImmediatePropagation();
    const dx = e.clientX - a.x, dy = e.clientY - a.y;
    if (!a.started && !a.rotating && Math.abs(dy) > Math.abs(dx))
      pan(e.clientY - a.lastY);
    a.corner = Math.max(-1, Math.min(1, ((a.y - host.getBoundingClientRect().top) / host.clientHeight - .5) * 1.4 + dy / host.clientHeight * 2));
    if (a.grab)
      a.grab.pullY = Math.max(-1, Math.min(1, -dy / Math.max(1, a.grab.height ?? host.clientHeight)));
    if (!a.started && !a.rotating && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      a.direction = dx < 0 ? 1 : -1;
      if (canTurn(a.direction)) {
        a.started = true;
        void turn(a.direction);
      }
      else if (canRotate(a.direction))
        a.rotating = true;
    }
    if (a.rotating)
      rotate(e.clientX - a.lastX);
    else if (a.started) {
      a.progress = dragProgress(-dx * a.direction, host.clientWidth);
      a.draw?.(a.progress);
    }
    a.lastX = e.clientX;
    a.lastY = e.clientY;
  });
  function release(e: PointerEvent, cancel = false) {
    const a = active;
    if (!a || a.id !== e.pointerId)
      return;
    e.stopImmediatePropagation();
    a.ended = true;
    a.commit = !cancel && shouldCommit(a.progress);
    if (host.hasPointerCapture(e.pointerId))
      host.releasePointerCapture(e.pointerId);
    if (a.rotating) {
      active = undefined;
      void finishRotate();
    }
    else if (a.started) {
      a.finish?.();
    }
    else {
      active = undefined;
      if (!cancel) {
        if (Math.hypot(e.clientX - a.x, e.clientY - a.y) < 8)
          tap(e);
        else
          swipe(e.clientX - a.x, e.clientY - a.y);
      }
    }
  }
  listen('pointerup', (e: PointerEvent) => release(e));
  listen('pointercancel', (e: PointerEvent) => release(e, true));
  return { isDragging: () => Boolean(active?.started), corner: () => active?.corner || 0, grab: () => active?.grab, async animate(duration: number, draw: Draw, automatic: (duration: number, draw: Draw) => Promise<void>) {
      const a = active;
      if (!a?.started) {
        await automatic(duration, draw);
        return true;
      }
      let stop = () => {
      };
      await new Promise<void>(resolve => {
        stop = () => resolve();
        a.draw = draw;
        draw(a.progress);
        a.finish = () => {
          const timing = releaseTiming(duration, a.progress, Boolean(a.commit)), start = performance.now();
          const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : timing.duration;
          function tick(now: number) {
            if (lifetime.signal.aborted) {
              resolve();
              return;
            }
            const t = ms ? Math.min(1, (now - start) / ms) : 1;
            draw(turnEase(timing.phase + (timing.target - timing.phase) * t));
            if (t < 1)
              requestAnimationFrame(tick);
            else
              resolve();
          }
          requestAnimationFrame(tick);
        };
        if (a.ended)
          a.finish();
        lifetime.signal.addEventListener('abort', stop, { once: true });
      });
      lifetime.signal.removeEventListener('abort', stop);
      if (active === a)
        active = undefined;
      return a.commit;
    }, dispose() {
      lifetime.abort();
      active = undefined;
    } };
}
