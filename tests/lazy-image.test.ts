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
    Object.assign(target, { removeAttribute: () => {}, style: { visibility: '' }, index, closest: () => rail, compareDocumentPosition: (other: { index: number }) => index < other.index ? 4 : 2 });
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
    intersect!([{target:left,isIntersecting:true}] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    expect(started).toEqual(['left', 'right']);
    right.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(started).toEqual(['left', 'right', 'left-fallback']);
    left.dispatchEvent(new Event('load'));
    await Promise.resolve();
    actions[1].update('right-new');
    actions[0].update('left-new');
    intersect!([right, left].map(target=>({target,isIntersecting:true})) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
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

test('waiting artwork leaves the rail queue until it intersects again, without duplicate re-entry', async () => {
  const original = globalThis.IntersectionObserver;
  let intersect!: IntersectionObserverCallback;
  const observed = new Set<Element>();
  const started: string[] = [];
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe(node: Element) { observed.add(node); }
    unobserve(node: Element) { observed.delete(node); }
    disconnect() { observed.clear(); }
  } as unknown as typeof IntersectionObserver;
  const rail = {} as Element;
  function image(index: number) {
    const target = new EventTarget();
    Object.assign(target, { removeAttribute: () => {}, style: {visibility:''}, index, closest:()=>rail, compareDocumentPosition:(other:{index:number})=>index<other.index?4:2 });
    Object.defineProperty(target, 'src', {set(value:string){started.push(value);}});
    return target as HTMLImageElement;
  }
  const a=image(0), b=image(1), c=image(2);
  const actions=[lazyImage(a,'a'),lazyImage(b,'b'),lazyImage(c,'c')];
  const delivery = (entries: {target:HTMLImageElement;isIntersecting:boolean}[]) => intersect(entries as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
  try {
    delivery([a,b].map(target=>({target,isIntersecting:true})));
    await Promise.resolve();
    expect(started).toEqual(['a']);
    expect(observed.has(b)).toBe(true);
    delivery([{target:b,isIntersecting:false},{target:c,isIntersecting:true}]);
    a.dispatchEvent(new Event('load'));await Promise.resolve();
    expect(started).toEqual(['a','c']);
    delivery([{target:b,isIntersecting:true},{target:b,isIntersecting:true}]);
    c.dispatchEvent(new Event('load'));await Promise.resolve();
    expect(started).toEqual(['a','c','b']);
    b.dispatchEvent(new Event('load'));await Promise.resolve();
    actions[0].update('a-replacement');
    delivery([{target:a,isIntersecting:false}]);await Promise.resolve();
    expect(started).toEqual(['a','c','b']);
    delivery([{target:a,isIntersecting:true}]);
    actions[0].destroy();await Promise.resolve();
    expect(started.slice(0,-1)).toEqual(['a','c','b']);expect(started.at(-1)).toStartWith('data:image/gif');
  } finally {
    actions.forEach(action=>action.destroy());
    globalThis.IntersectionObserver=original;
  }
  expect(observed.size).toBe(0);
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
    Object.assign(target, { removeAttribute: () => {}, style: {visibility:''}, index, closest: () => row, compareDocumentPosition: (other: { index: number }) => index < other.index ? 4 : 2 });
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
    expect(started).toEqual(['left', 'other-row', 'middle', expect.stringContaining('data:image/gif'), 'right']);
    actions[0].update('right-fallback');
    expect(started.at(-1)).toBe('right-fallback');
  } finally {
    actions.forEach(action => action.destroy());
    globalThis.IntersectionObserver = original;
  }
});

test('destroy releases the owned image request exactly once',()=>{
 const original=globalThis.IntersectionObserver;const removed:string[]=[];const assigned:string[]=[];
 globalThis.IntersectionObserver=undefined as unknown as typeof IntersectionObserver;
 const node=new EventTarget();Object.assign(node,{style:{visibility:''},closest:()=>null,removeAttribute:(name:string)=>{removed.push(name);}});
 Object.defineProperty(node,'src',{set(value:string){assigned.push(value);}});
 try{const owner=lazyImage(node as HTMLImageElement,'/actual-artwork');expect(assigned).toEqual(['/actual-artwork']);owner.destroy();owner.destroy();expect(removed).toEqual(['srcset']);expect(assigned).toHaveLength(2);expect(assigned[1]).toStartWith('data:image/gif');}
 finally{globalThis.IntersectionObserver=original;}
});
