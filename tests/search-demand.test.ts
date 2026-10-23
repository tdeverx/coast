import { expect, test } from 'bun:test';
import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import {resolveAction,actionUrl} from '../src/lib/actions';
import { categoryEnabled, surfaceEnabled } from '../src/lib/experimental';
import { searchSelection, searchDemand } from '../src/lib/search-selection';

const code = new Bun.Transpiler({ loader: 'ts' }).transformSync((await Bun.file('src/routes/search/+page.server.ts').text())
  .replace(/^import[^;]+;\n?/gm, '').replace('export const load', 'const load'));
const enabled = { experimentalMusic: true, experimentalGaming: true, experimentalBooks: true, experimentalComics: true, siteAccess: 'public-read-only' };
function fixture(config: object = enabled, overrides: Record<string,unknown> = {}) {
  const calls: { owner: string; signal?: AbortSignal }[] = [];
  const empty = { items: [], discover: [], failure: '', truncated: false };
  const reading = { items: [], failure: '', notice: '', truncated: false, page: 1, pages: 1, total: 0 };
  const dependencies = { v, error, resolveAction, actionUrl, categoryEnabled, surfaceEnabled, searchSelection, searchDemand,
    getFeatureConfig: async () => config,
    publicSearch: async () => { calls.push({ owner: 'public' }); return []; },
    mediaViews: async () => { calls.push({ owner: 'watchInitial' }); return []; },
    readingSearchInitial: async () => { calls.push({ owner: 'readInitial' }); return reading; },
    searchMedia: async () => { calls.push({ owner: 'watch' }); return { items: [], providerUnavailable: false, truncated: false }; },
    searchPresentations: async (_user: string, surface: string, _query: string, _kind: string, signal?: AbortSignal) => { calls.push({ owner: surface, signal }); return empty; },
    readingSearch: async () => { calls.push({ owner: 'read' }); return reading; },
    ...overrides,
  };
  const load = new Function(...Object.keys(dependencies), code + ';return load;')(...Object.values(dependencies));
  const start = async (query: string, user: object | null = { id: 'viewer' }, signal?: AbortSignal) => {
    const url = new URL('http://coast/search?' + query), request = new Request(url, { signal });
    return load({ locals: { user }, url, request, depends() {} });
  };
  return { calls, start, async run(query: string, user?: object | null, signal?: AbortSignal) {
    const data = await start(query,user,signal);
    await Promise.all([data.watch, data.listen, data.play, data.read, data.readComplete]); return data;
  } };
}

test('selected action starts only its family, including All subtype and conflicting row parameters', async () => {
  for (const [query, owners] of [
    ['view=watch', ['watchInitial', 'watch']], ['view=listen', ['listen']], ['view=play', ['play']], ['view=read', ['readInitial', 'read', 'read']],
    ['availableType=movie&unavailableType=comic', ['watchInitial','watch']],
    ['availableType=movie', ['watchInitial','watch']],
  ] as const) {
    const f = fixture(); await f.run('q=title&' + query);
    expect(f.calls.map(call => call.owner).sort()).toEqual([...owners].sort());
  }
  const f = fixture(); await f.run('q='); expect(f.calls).toEqual([]);
});

test('withdrawn actions fall back before reads and conflicting subtypes never admit another family',async()=>{
 const config={...enabled,features:{music:false,book:false,comic:false}};
 for(const query of ['view=listen','type=book','availableType=comic']){
  const f=fixture(config);await f.run('q=title&'+query);
  expect(f.calls.map(call=>call.owner)).toEqual(['watchInitial','watch']);
 }
 const f=fixture(config);await f.run('q=title');expect(f.calls.map(call=>call.owner)).toEqual(['watchInitial','watch']);
});

test('public search remains public screen-only regardless of private medium row parameters', async () => {
  const f = fixture(); const data = await f.run('q=title&availableType=book&unavailableType=movie', null);
  expect(f.calls.map(call => call.owner)).toEqual(['public']);
  expect(data.rows).toEqual({ available: { kind: 'all', view: 'watch' }, unavailable: { kind: 'movie', view: 'watch' } });
  expect(data.demand).toEqual({ watch: true, listen: false, play: false, read: false });
});

test('search preserves request cancellation admission and the existing music signal', async () => {
  const controller = new AbortController(), f = fixture(); await f.run('q=title&view=listen', undefined, controller.signal);
  expect(f.calls).toHaveLength(1); expect(f.calls[0].signal).toBeDefined(); expect(f.calls[0].signal?.aborted).toBe(false);
  const stopped = fixture(); controller.abort(); await expect(stopped.run('q=title', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(stopped.calls).toEqual([]);
});


test('reading search publishes primary matches before optional enrichment and drains both stages',async()=>{
 let release!:(x:unknown)=>void;const full=new Promise(resolve=>release=resolve),stages:string[]=[];
 const primary={items:[{id:'primary'}],failure:'',notice:'',truncated:false,page:1,pages:1,total:1};
 const f=fixture(enabled,{readingSearch:async(_user:unknown,_input:unknown,_initial:unknown,stage='complete')=>{stages.push(stage);return stage==='primary'?primary:full;}});
 const data=await f.start('q=title&view=read');expect(await data.read).toEqual(primary);
 let complete=false;void data.readComplete.then(()=>complete=true);await Promise.resolve();expect(complete).toBe(false);
 const final={...primary,items:[...primary.items,{id:'series'}],total:2};release(final);
 expect(await data.readComplete).toEqual(final);expect(stages).toEqual(['primary','complete']);
});

test('an aborted search never admits its remaining series enrichment',async()=>{
 let release!:(x:unknown)=>void;const waiting=new Promise(resolve=>release=resolve),stages:string[]=[];
 const primary={items:[],failure:'',notice:'',truncated:false,page:1,pages:1,total:0},controller=new AbortController();
 const f=fixture(enabled,{readingSearch:async(_user:unknown,_input:unknown,_initial:unknown,stage='complete')=>{stages.push(stage);return waiting;}});
 const data=await f.start('q=title&view=read',undefined,controller.signal);controller.abort();release(primary);
 expect(await data.readComplete).toEqual(primary);expect(stages).toEqual(['primary']);
});

test('book-only searches have no optional comic enrichment stage',async()=>{
 const f=fixture();const data=await f.run('q=title&view=read&kind=book');
 expect(data.readComplete).toBe(data.read);expect(f.calls.filter(x=>x.owner==='read')).toHaveLength(1);
});
