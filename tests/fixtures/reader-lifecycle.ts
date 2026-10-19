// Separate process: controlled bitmap/PDF boundaries cannot affect other tests.
import { expect, mock } from 'bun:test';
import { ZipWriter, BlobWriter, TextReader } from '@zip.js/zip.js';
import { physicalPages } from '../../src/lib/reading/reader/physical-pages';
import type { ReaderOptions } from '../../src/lib/reading/reader/engine';

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
};
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function archive(pages: number) {
  const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
  for (let i = 0; i < pages; i++) await writer.add(`${i + 1}.png`, new TextReader('Synthetic bitmap boundary.'));
  return new File([await writer.close()], 'fixture.cbz');
}
function options(source: File, controller: AbortController): ReaderOptions {
  return { source, host: {} as HTMLElement, signal: controller.signal, format: 'cbz', location: null, changed() {} };
}
const canvas = () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {}, fillStyle: '' }) });
globalThis.document = { createElement: canvas } as unknown as Document;
globalThis.window = { document: globalThis.document } as unknown as Window & typeof globalThis;
let bitmapsClosed = 0;
const bitmap = (width = 600, height = 900) => ({ width, height, close() { bitmapsClosed++; } }) as ImageBitmap;
let decode = async () => bitmap();
globalThis.createImageBitmap = (() => decode()) as typeof createImageBitmap;
const one = await archive(1), four = await archive(4);

// Cancelling a pending decoder closes a bitmap that arrives after its owner.
{
  const controller = new AbortController(), started = deferred(), pending = deferred<ImageBitmap>();
  decode = () => { started.resolve(); return pending.promise; };
  const opened = physicalPages(options(one, controller));
  await started.promise;
  controller.abort();
  await expect(opened).rejects.toMatchObject({ name: 'AbortError' });
  pending.resolve(bitmap());
  await settle();
  expect(bitmapsClosed).toBe(1);
}
// Normalization preserves original page identities and completes a discarded tail.
{
  let read = 0;
  decode = async () => bitmap(++read === 2 ? 1200 : 600);
  const controller = new AbortController(), source = await physicalPages(options(four, controller));
  expect(source.count).toBe(4);
  expect(source.location(1)).toEqual({ format: 'cbz', page: 2, total: 4 });
  expect(source.location(2)).toEqual({ format: 'cbz', page: 2, total: 4 });
  expect(source.location(3)).toEqual({ format: 'cbz', page: 4, total: 4 });
  expect(source.pageFor({ format: 'cbz', page: 4, total: 4 })).toBe(4);
  await source.close();
}
// Too-large decoded scans are rejected and released.
{
  const before = bitmapsClosed;
  decode = async () => bitmap(10000, 10000);
  await expect(physicalPages(options(one, new AbortController()))).rejects.toThrow('too large');
  expect(bitmapsClosed).toBe(before + 1);
}
// A required later image can retry after its decoder fails.
{
  decode = async () => bitmap();
  const controller = new AbortController(), source = await physicalPages(options(four, controller));
  decode = async () => { throw Error('Invalid image'); };
  await expect(source.page(0, controller.signal)).rejects.toThrow('Invalid image');
  decode = async () => bitmap();
  expect((await source.page(0, controller.signal)).width).toBe(600);
  await source.close();
}
// Native archive work is terminated on cancellation; retry owns a fresh worker.
const NativeWorker=globalThis.Worker;
class ArchiveWorker {
 onmessage:((event:{data:unknown})=>void)|null=null;onerror:((event:unknown)=>void)|null=null;
 terminated=0;messages:{id:number;type:string;index?:number}[]=[];
 constructor(){workers.push(this);}
 postMessage(message:{id:number;type:string;index?:number}){this.messages.push(message);}
 terminate(){this.terminated++;}
 reply(data:object){this.onmessage?.({data:{id:this.messages.at(-1)!.id,...data}});}
}
const workers:ArchiveWorker[]=[];
globalThis.Worker=ArchiveWorker as unknown as typeof Worker;
const {openArchiveComic}=await import('../../src/lib/reading/reader/archive');
const pageEntries=[{filename:'1.png',size:1,index:0},{filename:'2.png',size:1,index:1}];
{
 const controller=new AbortController(),opened=openArchiveComic(one,'cbr',controller.signal);await settle();
 const worker=workers.at(-1)!;controller.abort();await expect(opened).rejects.toMatchObject({name:'AbortError'});expect(worker.terminated).toBe(1);
}
{
 const controller=new AbortController(),opened=openArchiveComic(one,'cb7',controller.signal);await settle();
 const first=workers.at(-1)!;first.reply({entries:pageEntries});const archive=await opened;
 const pageOwner=new AbortController(),pending=archive.read(0,pageOwner.signal);await settle();pageOwner.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(first.terminated).toBe(1);
 const next=archive.read(1,new AbortController().signal);await settle();const second=workers.at(-1)!;expect(second).not.toBe(first);second.reply({entries:pageEntries});await settle();
 first.reply({page:new ArrayBuffer(3)});second.reply({page:new ArrayBuffer(1)});expect((await next).size).toBe(1);
 await archive.close();await archive.close();expect(second.terminated).toBe(1);
}
{
 const controller=new AbortController(),opened=openArchiveComic(one,'cbt',controller.signal);await settle();
 const worker=workers.at(-1)!;worker.reply({entries:pageEntries});controller.abort();await expect(opened).rejects.toMatchObject({name:'AbortError'});expect(worker.terminated).toBe(1);
}
globalThis.Worker=NativeWorker;

let renders = 0, cancelled = 0, destroyed = 0, cleaned = 0;
let render = () => Promise.resolve();
const pdf = {
  numPages: 3,
  async getPage() {
    return { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 900 * scale }), cleanup() { cleaned++; }, render() { renders++; return { cancel() { cancelled++; }, promise: render() }; } };
  },
};
let documentPromise = Promise.resolve(pdf);
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: documentPromise, async destroy() { destroyed++; } }) }));
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'synthetic-worker' }));
const { physicalPdfPages } = await import('../../src/lib/reading/reader/physical-pdf');
const pdfOptions = (controller: AbortController): ReaderOptions => ({ ...options(one, controller), format: 'pdf' });
{
  const controller = new AbortController(), source = await physicalPdfPages(pdfOptions(controller));
  expect(source.count).toBe(4);
  expect(source.location(2)).toEqual({ format: 'pdf', page: 3, total: 3 });
  expect(source.location(3)).toBeUndefined();
  expect(source.pageFor({ format: 'pdf', page: 3, total: 3 })).toBe(3);
  await source.page(2, controller.signal);
  const before = renders;
  await source.page(3, controller.signal);
  expect(renders).toBe(before);
  source.close(); source.close();
  expect(destroyed).toBe(1);
}
{
  const controller = new AbortController(), source = await physicalPdfPages(pdfOptions(controller));
  const started = deferred();
  render = () => { started.resolve(); return new Promise(() => {}); };
  const pending = source.page(0, controller.signal);
  await started.promise;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancelled).toBe(1);
  expect(destroyed).toBe(2);
  expect(cleaned).toBe(2);
}
{
  const controller = new AbortController(), source = await physicalPdfPages(pdfOptions(controller));
  render = () => Promise.reject(Error('Raster failed'));
  await expect(source.page(0, controller.signal)).rejects.toThrow('Raster failed');
  render = () => Promise.resolve();
  await source.page(0, controller.signal);
  source.close();
}
{
  const controller = new AbortController();
  documentPromise = new Promise(() => {});
  const pending = physicalPdfPages(pdfOptions(controller));
  await settle();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(destroyed).toBe(4);
}
console.log(JSON.stringify({ comicCases: 4, archiveCases: 3, pdfCases: 4 }));
