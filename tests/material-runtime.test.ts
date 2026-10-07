import { expect, test } from 'bun:test';
import { liquidGlass } from '../src/lib/ui/materials/glass';

/** Exercise the material lifecycle without a provider, server or raster browser. */
test('material activation is explicit and native graphs stay stable until geometry changes', () => {
  const keys = ['CSS', 'navigator', 'document', 'matchMedia', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout'] as const;
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = new Map<number, FrameRequestCallback>();
  const delayed: (() => void)[] = [];
  let sequence = 0;
  class Element {
    styleValues = new Map<string, string>();
    style = { setProperty: (key: string, value: string) => this.styleValues.set(key, value), getPropertyValue: (key: string) => this.styleValues.get(key) ?? '', removeProperty: (key: string) => this.styleValues.delete(key) };
    dataset: Record<string, string> = {};
    classes = new Set<string>();
    classList = { add: (value: string) => this.classes.add(value), remove: (value: string) => this.classes.delete(value) };
    children: Element[] = [];
    parent?: Element;
    attributes: Record<string, string> = {};
    offsetWidth = 58;
    offsetHeight = 58;
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    append(child: Element) { child.parent = this; this.children.push(child); }
    prepend(child: Element) { child.parent = this; this.children.unshift(child); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
  }
  const body = new Element(), node = new Element();
  const root = new Element();
  let resized: (() => void) | undefined;
  const flush = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } };
  let action: ReturnType<typeof liquidGlass> | undefined;
  try {
    const mocked = {
      CSS: { supports: () => true }, navigator: { userAgent: 'Chrome/149.0' },
      document: { body, querySelector: () => root, createElementNS: () => new Element(), createElement: (name: string) => name === 'canvas' ? {
        width: 0, height: 0, getContext: () => ({ createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData() {} }), toDataURL: () => 'data:image/png;base64,map',
      } : new Element() },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      MutationObserver: class { observe() {} disconnect() {} },
      ResizeObserver: class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} },
      getComputedStyle: () => ({ borderTopLeftRadius: '29px' }),
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; }, cancelAnimationFrame: (id: number) => frames.delete(id),
      setTimeout: (callback: () => void) => { delayed.push(callback); return 1; },
    };
    for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: mocked[key] });
    action = liquidGlass(node as unknown as HTMLElement, { enabled: false, fallback: { noiseOpacity: 10 } });
    expect(node.style.getPropertyValue('backdrop-filter')).toBe('none');
    expect(node.children).toHaveLength(0);
    expect(body.children).toHaveLength(0);
    action.update({ enabled: true });
    expect(node.style.getPropertyValue('backdrop-filter')).toStartWith('url(');
    flush();
    const initial = body.children[0];
    expect(initial).toBeDefined();
    resized?.(); flush();
    expect(body.children[0]).toBe(initial);
    action.update({ enabled: true, surface: { fillOpacity: 20, brightness: 90, noiseOpacity: 5 } }); flush();
    expect(body.children[0]).toBe(initial);
    expect(node.children).toHaveLength(1);
    action.update({ enabled: true, surface: { depth: 24 } }); flush();
    expect(body.children[0]).not.toBe(initial);
    node.offsetWidth = 0; resized?.(); flush();
    expect(body.children).toHaveLength(0);
    expect(node.dataset.coastGlassRenderer).toBe('hidden');
    expect(node.style.getPropertyValue('backdrop-filter')).toStartWith('blur(');
    node.offsetWidth = 58; resized?.(); flush();
    expect(body.children).toHaveLength(1);
    action.update({ enabled: false });
    expect(node.style.getPropertyValue('backdrop-filter')).toBe('none');
    flush();
    expect(body.children).toHaveLength(0);
    expect(node.children).toHaveLength(0);
    expect(node.style.getPropertyValue('--coast-glass-fill')).toBe('');
    expect(node.style.getPropertyValue('backdrop-filter')).toBe('none');
    action.destroy(); action = undefined;
    for (const callback of delayed) callback(); flush();
    expect(frames.size).toBe(0);
  } finally {
    action?.destroy();
    for (const callback of delayed) callback(); flush();
    for (const key of keys) { const descriptor = originals.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
