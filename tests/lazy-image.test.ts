import { expect, test } from 'bun:test';
import { lazyImage } from '../src/lib/ui/lazy-image';

test('fallbacks and artwork changes keep the horizontal rail request slot', async () => {
  const original = globalThis.IntersectionObserver;
  let intersect: IntersectionObserverCallback;
  const started: string[] = [];
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof IntersectionObserver;
  const rail = {} as Element;
  function image(index: number) {
    const target = new EventTarget();
    Object.assign(target, { style: { visibility: '' }, index, closest: () => rail, compareDocumentPosition: (other: { index: number }) => index < other.index ? 4 : 2 });
    Object.defineProperty(target, 'src', { set(value: string) { started.push(value); } });
    return target as HTMLImageElement;
  }
  const left = image(0), right = image(1);
  const actions = [lazyImage(left, 'left'), lazyImage(right, 'right')];
  try {
    intersect!([left, right].map(target => ({ target, isIntersecting: true })) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    await Promise.resolve();
    expect(started).toEqual(['left']);
    left.dispatchEvent(new Event('error'));
    await Promise.resolve();
    expect(started).toEqual(['left', 'right']);
    // Svelte may deliver an error fallback after the next card has claimed the slot.
    actions[0].update('left-fallback');
    expect(started).toEqual(['left', 'right']);
    right.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(started).toEqual(['left', 'right', 'left-fallback']);
    left.dispatchEvent(new Event('load'));
    await Promise.resolve();
    actions[1].update('right-new');
    actions[0].update('left-new');
    await Promise.resolve();
    expect(started.at(-1)).toBe('left-new');
    left.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(started.at(-1)).toBe('right-new');
    actions[1].update('right-new');
    expect(started.filter(source => source === 'right-new')).toHaveLength(1);
  } finally {
    actions.forEach(action => action.destroy());
    globalThis.IntersectionObserver = original;
  }
});

test('horizontal artwork starts left to right and failures/removal release the row queue', async () => {
  const original = globalThis.IntersectionObserver;
  let intersect: IntersectionObserverCallback;
  const started: string[] = [];
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof IntersectionObserver;
  const rail = {} as Element;
  function image(index: number, row = rail) {
    const target = new EventTarget() as EventTarget & { src: string; loading: string; closest: () => Element; compareDocumentPosition: (other: { index: number }) => number; index: number };
    Object.assign(target, { style: {visibility:''}, index, closest: () => row, compareDocumentPosition: (other: { index: number }) => index < other.index ? 4 : 2 });
    Object.defineProperty(target, 'src', { set(value: string) { started.push(value); } });
    return target as unknown as HTMLImageElement;
  }
  const left = image(0), middle = image(1), right = image(2), another = image(0, {} as Element);
  const actions = [lazyImage(right, 'right'), lazyImage(left, 'left'), lazyImage(middle, 'middle'), lazyImage(another, 'other-row')];
  try {
    intersect!([right, middle, left, another].map(target => ({ target, isIntersecting: true })) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    await Promise.resolve();
    expect(started).toEqual(['left', 'other-row']);
    expect(left.style.visibility).toBe('hidden');
    another.dispatchEvent(new Event('load'));
    expect(another.style.visibility).toBe('');
    left.dispatchEvent(new Event('error'));
    expect(left.style.visibility).toBe('hidden');
    await Promise.resolve();
    expect(started).toEqual(['left', 'other-row', 'middle']);
    actions[2].destroy();
    await Promise.resolve();
    expect(started).toEqual(['left', 'other-row', 'middle', 'right']);
    actions[0].update('right-fallback');
    expect(started.at(-1)).toBe('right-fallback');
  } finally {
    actions.forEach(action => action.destroy());
    globalThis.IntersectionObserver = original;
  }
});
