import { expect, test } from 'bun:test';
import { eraseTypeScript, moduleUrl } from './fixtures/ui-script';
import { normalizeComicPages } from '../src/lib/reading/reader/physical/page-layout';
import type { PhysicalOptions, PhysicalState } from '../src/lib/reading/reader/physical/model';
import type { ReaderOptions } from '../src/lib/reading/reader/engine';
import type { ReadingLocation } from '../src/lib/reading/model';
const source = (await Bun.file('src/lib/reading/reader/physical-reader.ts').text())
  .replace(/^import .*from ['"].*['"];\n/gm, '')
  .replace('export async function physicalReader', 'async function physicalReader');
const { connect } = await import(moduleUrl(eraseTypeScript(`
import { sameReadingLocation } from ${JSON.stringify(import.meta.resolve('../src/lib/reading/model'))};
import { readerLoad } from ${JSON.stringify(import.meta.resolve('../src/lib/reading/reader/load'))};
export function connect(physicalPages, createRenderer) { ${source}; return physicalReader; }
`)));
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 12; i++)
    await Promise.resolve();
};
async function fixture({ controlled = true, location = null as ReadingLocation | null, pending = false } = {}) {
  const signal = new AbortController();
  const changes: ReadingLocation[] = [];
  const errors: unknown[] = [];
  let calls: PhysicalOptions;
  let closed = 0;
  let dismissed = 0;
  let disposed = 0;
  let control = controlled;
  let state: PhysicalState = { opened: false, index: 1, busy: false, cascadeDirection: 0, canCascade: false, curlingPages: 0, backCover: false, focused: true, focusedPage: null, readingCover: false };
  const moved: number[] = [];
  const gate = deferred();
  const emit = (next: Partial<PhysicalState>) => {
    state = { ...state, ...next };
    calls.onState!(state);
  };
  const renderer = {
    setLight() {
    },
    enter: async () => {
      emit({});
    },
    turn: async (direction: number) => {
      moved.push(direction);
      emit({ busy: true, canCascade: true, cascadeDirection: direction });
    },
    showPage: async (page: number) => {
      moved.push(page);
      emit({ busy: true });
      if (pending)
        await gate.promise;
      emit({ opened: page > 1 && page < 12, index: page - 1, busy: false });
    },
    dispose() {
      disposed++;
    },
  };
  const create = connect(async () => ({
    count: 12,
    page: async () => ({ width: 10, height: 15 }),
    location: (face: number) => ({ format: 'cbz', page: Math.floor(face / 2) + 1, total: 6 }),
    pageFor: (target: ReadingLocation | null) => target && target.format !== 'epub' ? target.page * 2 : 1,
    close() {
      closed++;
    },
  }), async (_host: unknown, options: PhysicalOptions) => {
    calls = options;
    return renderer;
  });
  const engine = await create({
    host: { getAttribute: () => 'Actual title' }, format: 'cbz', kind: 'comic', source: 'coast-file',
    location, signal: signal.signal, controlled: () => control,
    dismiss: () => {
      dismissed++;
    },
    changed: (value: ReadingLocation) => changes.push(value), failed: (cause: unknown) => errors.push(cause),
  } as unknown as ReaderOptions);
  return { engine, changes, errors, emit, signal, moved, gate, calls: calls!, setControl(value: boolean) {
      control = value;
    }, get disposed() {
      return disposed;
    }, get dismissed() {
      return dismissed;
    },
    get closed() {
      return closed;
    } };
}
test('physical entry preserves saved locations; settled faces keep original archive numbering', async () => {
  const value = await fixture({ location: { format: 'cbz', page: 3, total: 6 } });
  try {
    expect(value.changes).toEqual([]);
    value.emit({ opened: true, index: 5 });
    expect(value.changes).toEqual([]);
    value.emit({ index: 7, busy: true });
    expect(value.changes).toEqual([]);
    value.emit({ busy: false });
    expect(value.changes).toEqual([{ format: 'cbz', page: 4, total: 6 }]);
    value.emit({ focusedPage: 1 });
    expect(value.changes).toHaveLength(2);
    value.emit({});
    expect(value.changes).toHaveLength(2);
  }
  finally {
    value.engine.destroy();
  }
  expect(value.closed).toBe(1);
  expect(value.disposed).toBe(1);
});
test('cascade turns settle at idle and prevent opposite-direction keyboard admission', async () => {
  const value = await fixture();
  try {
    let finished = false;
    const turn = value.engine.next().then(() => {
      finished = true;
    });
    await flush();
    expect(finished).toBe(false);
    expect(value.engine.canTurn!('next')).toBe(true);
    expect(value.engine.canTurn!('previous')).toBe(false);
    const second = value.engine.next();
    value.emit({ opened: true, index: 5, busy: false });
    await Promise.all([turn, second]);
    expect(value.moved).toEqual([1, 1]);
  }
  finally {
    value.engine.destroy();
  }
});
test('followers cannot navigate or publish; canonical party navigation still works', async () => {
  const value = await fixture({ controlled: false, location: { format: 'cbz', page: 3, total: 6 } });
  try {
    expect(value.moved).toEqual([6]);
    await value.engine.next();
    value.emit({ opened: true, index: 7 });
    expect(value.engine.canTurn!('next')).toBe(false);
    expect(value.changes).toEqual([]);
    await value.engine.go({ format: 'cbz', page: 5, total: 6 });
    expect(value.moved).toEqual([6, 10]);
    expect(value.changes).toEqual([]);
    value.setControl(true);
    value.emit({ opened: true, index: 11 });
    expect(value.changes).toEqual([{ format: 'cbz', page: 6, total: 6 }]);
  }
  finally {
    value.engine.destroy();
  }
});
test('new remote locations supersede queued ones without publishing intermediate saves', async () => {
  const value = await fixture();
  try {
    const turn = value.engine.next();
    const first = value.engine.go({ format: 'cbz', page: 2, total: 6 });
    const last = value.engine.go({ format: 'cbz', page: 5, total: 6 });
    value.emit({ busy: false });
    await Promise.all([turn, first, last]);
    expect(value.moved).toEqual([1, 10]);
    expect(value.changes).toEqual([]);
  }
  finally {
    value.engine.destroy();
  }
});
test('abort releases the scene and source and settles pending turns', async () => {
  const value = await fixture();
  const turn = value.engine.next();
  value.signal.abort(new DOMException('Closed', 'AbortError'));
  await expect(turn).rejects.toMatchObject({ name: 'AbortError' });
  value.engine.destroy();
  expect(value.closed).toBe(1);
  expect(value.disposed).toBe(1);
});
test('late renderer creation is disposed after cancellation', async () => {
  const signal = new AbortController();
  const pending = deferred<unknown>();
  let closed = 0;
  let disposed = 0;
  const create = connect(async () => ({ count: 4, close() {
      closed++;
    } }), () => pending.promise);
  const operation = create({ signal: signal.signal, host: { getAttribute: () => null } });
  await flush();
  signal.abort(new DOMException('Closed', 'AbortError'));
  await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
  pending.resolve({ dispose() {
      disposed++;
    } });
  await flush();
  expect(disposed).toBe(1);
  expect(closed).toBe(1);
});
test('wide scans retain both halves and the final source page; spare faces have no source location', async () => {
  const dimensions = [[600, 900], [1200, 900], [600, 900], [600, 900], [600, 900], [600, 900]];
  const pages = await normalizeComicPages({ count: 6, page: async (index: number) => ({ width: dimensions[index][0], height: dimensions[index][1] } as HTMLCanvasElement) }, new AbortController().signal,{sanitizeOddPages:false});
  expect(pages.count).toBe(8);
  expect(pages.sourcePage(1)).toBe(1);
  expect(pages.sourcePage(2)).toBe(1);
  expect(pages.physicalPage(1)).toBe(1);
  expect(pages.sourcePage(6)).toBeUndefined();
  expect(pages.sourcePage(7)).toBe(5);
  expect(pages.physicalPage(5)).toBe(7);
});
test('small and odd bindings retain every source page without inventing numbered blank pages',async()=>{
 for(const count of [1,2,3,4,5]){
  const pages=await normalizeComicPages({count,page:async()=>({width:600,height:900} as HTMLCanvasElement)},new AbortController().signal,{sanitizeOddPages:false});
  const sources=Array.from({length:pages.count},(_,index)=>pages.sourcePage(index)).filter(index=>index!==undefined);
  expect(sources).toEqual(Array.from({length:count},(_,index)=>index));
  expect(pages.count).toBe(Math.max(4,count+count%2));
  expect(pages.physicalPage(count-1)).toBe(count===1?0:pages.count-1);
 }
});
test('odd-face sanitization is on by default and can be disabled without dropping the tail',async()=>{
 for(const sanitizeOddPages of [undefined,true,false]){
  const pages=await normalizeComicPages({count:5,dimensions:async()=>({width:600,height:900}),page:async()=>({width:600,height:900} as HTMLCanvasElement)},new AbortController().signal,{sanitizeOddPages});
  expect(pages.count).toBe(sanitizeOddPages===false?6:4);
  expect(pages.sourcePage(pages.count-1)).toBe(sanitizeOddPages===false?4:3);
  expect(pages.physicalPage(4)).toBe(pages.count-1);
 }
});
test('outside dismissal uses the Coast callback and cannot fire after disposal', async () => {
  const value = await fixture();
  value.calls.onDismiss!();
  expect(value.dismissed).toBe(1);
  value.engine.destroy();
  value.calls.onDismiss!();
  expect(value.dismissed).toBe(1);
});
