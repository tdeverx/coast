import { expect, test } from 'bun:test';
import { contextGesture } from '../src/lib/ui/context-gesture';

class Target {
  listeners = new Map<string, Set<(event: any) => void>>();
  addEventListener(type: string, callback: (event: any) => void) {
    const callbacks = this.listeners.get(type) ?? new Set(); callbacks.add(callback); this.listeners.set(type, callbacks);
  }
  removeEventListener(type: string, callback: (event: any) => void) { this.listeners.get(type)?.delete(callback); }
  dispatch(type: string, extra: Record<string, unknown> = {}) {
    const event = { target: this, clientX: 10, clientY: 20, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    for (const callback of [...this.listeners.get(type) ?? []]) callback(event);
    return event;
  }
  count(type: string) { return this.listeners.get(type)?.size ?? 0; }
}
class ElementTarget extends Target {
  closest() { return null; }
  getBoundingClientRect() { return { left: 2, top: 3, width: 100, height: 80 }; }
}

test('global scroll cancellation exists only during a hold and preserves context, movement, keyboard and cleanup behavior', () => {
  const original = { window: globalThis.window, Element: globalThis.Element, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const windowTarget = new Target(), timers = new Map<number, () => void>();
  let nextTimer = 0;
  Object.assign(globalThis, { window: windowTarget, Element: ElementTarget,
    setTimeout(callback: () => void) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const fire = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); };
  try {
    const node = new ElementTarget(), opened: unknown[] = [];
    const action = contextGesture(node as unknown as HTMLElement, point => opened.push(point));
    expect(windowTarget.count('scroll')).toBe(0);
    node.dispatch('pointerdown', { pointerType: 'mouse' }); fire();
    expect(opened).toHaveLength(0); expect(windowTarget.count('scroll')).toBe(0);
    node.dispatch('pointerdown', { pointerType: 'touch' }); expect(windowTarget.count('scroll')).toBe(1);
    windowTarget.dispatch('scroll'); fire(); expect(opened).toHaveLength(0); expect(windowTarget.count('scroll')).toBe(0);
    node.dispatch('pointerdown', { pointerType: 'touch' }); node.dispatch('pointermove', { clientX: 30 }); fire();
    expect(opened).toHaveLength(0); expect(windowTarget.count('scroll')).toBe(0);
    node.dispatch('pointerdown', { pointerType: 'touch' }); fire();
    expect(opened).toEqual([{ x: 10, y: 20 }]); expect(windowTarget.count('scroll')).toBe(0);
    expect(node.dispatch('click').prevented).toBe(true);
    expect(node.dispatch('click').prevented).toBe(false);
    node.dispatch('contextmenu'); expect(opened).toHaveLength(2);
    node.dispatch('keydown', { key: 'F10', shiftKey: true }); expect(opened.at(-1)).toEqual({ x: 52, y: 63 });
    node.dispatch('pointerdown', { pointerType: 'touch' }); action.destroy(); fire();
    expect(opened).toHaveLength(3); expect(windowTarget.count('scroll')).toBe(0); expect(timers.size).toBe(0);
    expect([...node.listeners.values()].every(callbacks => !callbacks.size)).toBe(true);
  } finally { Object.assign(globalThis, original); }
});
