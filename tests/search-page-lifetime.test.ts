import { expect, test } from 'bun:test';
// @ts-expect-error Internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import { compileRunes, componentScript, moduleUrl, svelteUrl } from './fixtures/ui-script';
import { searchSelection, searchDemand, searchSelectionUrl } from '../src/lib/search-selection';
import { rankSearch } from '../src/lib/search';

const script = (await componentScript('src/routes/search/+page.svelte')).replace('let { data } = $props();', 'let data=$state.raw(initial);');
const source = compileRunes(`import {untrack} from ${JSON.stringify(svelteUrl)};
 export function create(initial,page,go,rankSearch,searchSelectionUrl){
  const cleanups=[],navigation=[],nativeHistory=new EventTarget(),window={location:{href:page.url.href},addEventListener:(...args)=>nativeHistory.addEventListener(...args),removeEventListener:(...args)=>nativeHistory.removeEventListener(...args)},beforeNavigate=fn=>navigation.push(fn),onDestroy=fn=>cleanups.push(fn),onMount=fn=>cleanups.push(fn()),reportFailure=()=>{},goto=go;
  ${script}
  return {select(bucket,kind){submit({bucket,kind});},submit,get busy(){return busy;},get items(){return searchItems;},get rows(){return data.rows;},get pending(){return pendingTargets.size;},get intentHref(){return intent?.href;},edit(value){query=value;},update(next){data=next;},history(url){window.location.href=url.href;nativeHistory.dispatchEvent(new Event('popstate'));},navigate(type,url){if(type==='popstate'){window.location.href=url.href;nativeHistory.dispatchEvent(new Event('popstate'));}for(const fn of navigation)fn({type,to:{url}});},cleanup(){for(const fn of cleanups)fn();}};
 }`);
const { create } = await import(moduleUrl(source));
const features = { experimentalMusic: true, experimentalGaming: true, experimentalBooks: true, experimentalComics: true };
const settle = async () => { for (let i = 0; i < 6; i++) { runtime.flush(); await Promise.resolve(); } };
function data(url: URL, items: object[] = [], pending?: Promise<unknown>) {
  const selection = searchSelection(url.searchParams), empty = { items: [], discover: [], failure: '', truncated: false }, reading = { items: [], failure: '', notice: '', truncated: false };
  return { ...selection, demand: searchDemand(selection, features), initial: { items: [], providerUnavailable: false }, readingInitial: reading,
    watch: Promise.resolve({ items, providerUnavailable: false }), listen: pending ?? Promise.resolve(empty), play: Promise.resolve(empty), read: Promise.resolve(reading), readComplete: Promise.resolve(reading) };
}

test('actual search controller pushes independent filter history, replaces query edits and restores both rows', async () => {
  const calls: { href: string; options: { replaceState: boolean } }[] = [], page = { url: new URL('http://coast/search?q=title&view=read') };
  let owner: any;
  const dispose = runtime.effect_root(() => { owner = create(data(page.url), page, (href: string, options: { replaceState: boolean }) => { calls.push({ href, options }); return Promise.resolve(); }, rankSearch, searchSelectionUrl); });
  try {
    await settle(); owner.select('available', 'movie');
    expect(calls[0].options.replaceState).toBe(false);
    page.url = new URL(calls[0].href, page.url); owner.update(data(page.url)); await settle();
    owner.select('unavailable', 'comic'); page.url = new URL(calls[1].href, page.url); owner.update(data(page.url)); await settle();
    expect(owner.rows).toEqual({ available: { kind: 'movie', view: 'watch' }, unavailable: { kind: 'comic', view: 'read' } });
    owner.edit('new title'); owner.submit(); expect(calls[2].options.replaceState).toBe(true);
    expect(new URL(calls[2].href, page.url).searchParams.get('availableType')).toBe('movie');
    expect(new URL(calls[2].href, page.url).searchParams.get('unavailableType')).toBe('comic');
    page.url = new URL(calls[0].href, page.url); owner.update(data(page.url)); await settle();
    expect(owner.rows.unavailable).toEqual({ kind: 'all', view: 'read' }); expect(owner.rows.available.kind).toBe('movie');
  } finally { owner.cleanup(); dispose(); }
});

test('pending independent filters retain rapid intent and fence older failures, Back and failed latest navigation', async () => {
  const page = { url: new URL('http://coast/search?q=title&view=read') };
  const calls: { href: string; resolve: () => void; reject: (failure: Error) => void }[] = [];
  let owner: any;
  const dispose = runtime.effect_root(() => { owner = create(data(page.url), page, (href: string) => {
    owner.navigate('goto', new URL(href));
    return new Promise<void>((resolve, reject) => calls.push({ href, resolve, reject }));
  }, rankSearch, searchSelectionUrl); });
  try {
    await settle(); owner.select('available', 'movie'); owner.select('unavailable', 'comic');
    expect(owner.pending).toBe(2);
    expect(new URL(calls[1].href).searchParams.get('availableType')).toBe('movie');
    expect(new URL(calls[1].href).searchParams.get('unavailableType')).toBe('comic');
    calls[0].reject(Error('Older navigation ended')); await settle(); expect(owner.pending).toBe(1); owner.edit('next title'); owner.submit();
    expect(new URL(calls[2].href).searchParams.get('availableType')).toBe('movie');
    expect(new URL(calls[2].href).searchParams.get('unavailableType')).toBe('comic');
    // Back changes authority even while both old promises remain pending.
    page.url = new URL('http://coast/search?q=back&availableType=album&unavailableType=game');
    owner.navigate('popstate', page.url); owner.update(data(page.url)); await settle();
    expect(owner.pending).toBe(0);
    owner.select('available', 'show');
    expect(new URL(calls[3].href).searchParams.get('unavailableType')).toBe('game');
    expect(new URL(calls[3].href).searchParams.get('q')).toBe('back');
    calls[1].resolve(); calls[2].resolve(); await settle();
    expect(owner.pending).toBe(1);
    // A failed latest intent must not become the base for the next attempt.
    calls[3].reject(Error('Latest navigation failed')); await settle(); expect(owner.pending).toBe(0); owner.select('unavailable', 'comic');
    expect(new URL(calls[4].href).searchParams.get('availableType')).toBe('album');
    calls[4].resolve(); await settle(); expect(owner.pending).toBe(0);
    owner.select('available', 'book'); owner.cleanup(); expect(owner.pending).toBe(0);
  } finally { owner.cleanup(); dispose(); for (const call of calls) call.resolve(); }
});

test('superseded streamed search cannot publish into the replacement selection', async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise(resolve => release = resolve), page = { url: new URL('http://coast/search?q=old') };
  let owner: any;
  const dispose = runtime.effect_root(() => { owner = create(data(page.url, [], pending), page, () => Promise.resolve(), rankSearch, searchSelectionUrl); });
  try {
    await settle(); page.url = new URL('http://coast/search?q=new&availableType=movie&unavailableType=comic'); owner.update(data(page.url, [{ id: 'current', kind: 'movie', title: 'Current' }])); await settle();
    release({ items: [{ id: 'stale', kind: 'album', title: 'Stale' }], failure: '', discover: [] }); await settle();
    expect(owner.items.map((item: { id: string }) => item.id)).toEqual(['current']);
  } finally { owner.cleanup(); dispose(); }
});

test('native Back retargets filter composition before route data and skipped Kit hooks catch up',async()=>{
  const page={url:new URL('http://coast/search?q=old&availableType=movie')},calls:{href:string;resolve:()=>void;reject:(error:Error)=>void}[]=[];
  let owner:any;
  const dispose=runtime.effect_root(()=>{owner=create(data(page.url),page,(href:string)=>new Promise<void>((resolve,reject)=>calls.push({href,resolve,reject})),rankSearch,searchSelectionUrl);});
  try{
    await settle();owner.select('available','album');
    page.url=new URL(calls[0].href);owner.update(data(page.url));await settle();
    // The address changed synchronously, but page.url/data still describe the
    // previous result and Kit omitted its beforeNavigate callback.
    owner.history(new URL('http://coast/search?q=back&availableType=movie'));
    expect(owner.pending).toBe(0);owner.select('unavailable','comic');
    const next=new URL(calls[1].href);expect(next.searchParams.get('q')).toBe('back');
    expect(next.searchParams.get('availableType')).toBe('movie');expect(next.searchParams.get('unavailableType')).toBe('comic');
    calls[0].reject(Error('Superseded navigation'));await settle();expect(owner.pending).toBe(1);
    calls[1].reject(Error('Latest navigation failed before Back data arrived'));await settle();
    owner.select('unavailable','game');expect(new URL(calls[2].href).searchParams.get('availableType')).toBe('movie');
    owner.edit('unsent draft');owner.history(new URL('http://coast/search?q=history&availableType=show'));
    owner.select('unavailable','book');const draft=new URL(calls[3].href);
    expect(draft.searchParams.get('q')).toBe('unsent draft');expect(draft.searchParams.get('availableType')).toBe('show');
    calls[2].resolve();await settle();expect(owner.pending).toBe(1);
    owner.cleanup();owner.history(new URL('http://coast/search?q=disposed'));
    expect(owner.pending).toBe(0);expect(owner.intentHref).toBeUndefined();
  }finally{owner.cleanup();dispose();for(const call of calls)call.resolve();}
});


test('reading completion owns loading and cannot be overwritten by a later primary page',async()=>{
  const page={url:new URL('http://coast/search?q=batman&view=read')};
  let primary!:(value:unknown)=>void,complete!:(value:unknown)=>void,owner:any;
  const initial={...data(page.url),read:new Promise(resolve=>primary=resolve),readComplete:new Promise(resolve=>complete=resolve)};
  const dispose=runtime.effect_root(()=>{owner=create(initial,page,()=>Promise.resolve(),rankSearch,searchSelectionUrl);});
  const result=(id:string)=>({items:[{id,kind:'comic',title:'Batman'}],failure:'',notice:'',truncated:false});
  try{
    await settle();expect(owner.busy).toBe(true);
    complete(result('complete'));await settle();expect(owner.busy).toBe(false);
    expect(owner.items.map((item:any)=>item.id)).toEqual(['complete']);
    primary(result('primary'));await settle();expect(owner.items.map((item:any)=>item.id)).toEqual(['complete']);
  }finally{owner.cleanup();dispose();}
});
