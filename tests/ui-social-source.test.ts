import {expect,test} from 'bun:test';
// @ts-expect-error The rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,moduleUrl,resourceUrl} from './fixtures/ui-script';
const routeUrl=moduleUrl(compileRunes(`export const page=$state({url:new URL('http://fixture/for-you'),data:{user:{id:'viewer'},capabilities:{social:true},experimentalBooks:true,experimentalComics:true,contentRevision:{social:'one'}}});`));
const lifecycleUrl=moduleUrl(`export {untrack} from '${import.meta.resolve('svelte/internal/client')}';const hooks=[];export const onDestroy=fn=>hooks.push(fn);export const destroy=()=>hooks.splice(0).forEach(fn=>fn());`);
const clientUrl=moduleUrl(`export let delivery;export const set=next=>delivery=next;export const useClient=()=>({api:(...args)=>delivery(...args)});`);
const client=await import(clientUrl),lifecycle=await import(lifecycleUrl);
const code=compileRunes((await Bun.file(new URL('../src/lib/ui/shelves/social.svelte.ts',import.meta.url)).text())
 .replaceAll('$app/state',routeUrl).replaceAll('#lib/ui/client-context.js',clientUrl).replaceAll('#lib/ui/resource.svelte.js',resourceUrl)
 .replaceAll('#lib/ui/content-revision.svelte.js',moduleUrl('export const contentRevisionKey=data=>data.contentRevision.social;'))
 .replaceAll('#lib/social/model.js',import.meta.resolve('../src/lib/social/model'))
 .replaceAll('#lib/experimental.js',import.meta.resolve('../src/lib/experimental')).replaceAll("from 'svelte'",`from '${lifecycleUrl}'`));
const {createSocialSource}:typeof import('../src/lib/ui/shelves/social.svelte')=await import(moduleUrl(code));
const settle=async()=>{for(let i=0;i<8;i++){runtime.flush();await Promise.resolve();}};
const feed=(id:string,more=false)=>({items:[{id,title:id,kind:'book',entryId:id}],hasMore:more,next:more?{before:'2026-10-01T00:00:00Z',beforeId:'00000000-0000-4000-8000-000000000001',beforeKnown:'true'}:null});

test('item Activity stays lazy, sends its work filter on every cursor request and cancels replaced work',async()=>{
 const calls:{url:URL;signal:AbortSignal;finish:(value:ReturnType<typeof feed>)=>void}[]=[];
 client.set((path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>new Promise(resolve=>calls.push({url:new URL(path,'http://fixture'),signal:options.signal,finish:resolve})));
 const options=runtime.state({type:'social' as const,category:'reading',workId:'book-a',layout:'grid' as const,mediums:true});
 let source!:ReturnType<typeof createSocialSource>;
 const dispose=runtime.effect_root(()=>source=createSocialSource(()=>runtime.get(options)));runtime.flush();
 try{
  expect(calls).toHaveLength(0);
  const first=source.load();expect(calls[0].url.searchParams.get('workId')).toBe('book-a');calls[0].finish(feed('event-1',true));await first;
  const more=source.load(2,true);expect(calls[1].url.searchParams.get('workId')).toBe('book-a');expect(calls[1].url.searchParams.get('beforeId')).toBe('00000000-0000-4000-8000-000000000001');
  runtime.set(options,{...runtime.get(options),workId:'book-b'});await settle();
  expect(calls[1].signal.aborted).toBe(true);expect(source.items).toEqual([]);expect(calls[2].url.searchParams.get('workId')).toBe('book-b');expect(calls[2].url.searchParams.has('before')).toBe(false);
  calls[1].finish(feed('stale'));await more;expect(source.items).toEqual([]);
  calls[2].finish({...feed('book-b'),items:[]});await settle();expect(calls).toHaveLength(3);expect(source.items).toEqual([]);
 }finally{lifecycle.destroy();dispose();}
});

test('merged Activity segments preserve their selection in links/cursors and cancel old filter delivery',async()=>{
 const calls:{url:URL;signal:AbortSignal;finish:(value:unknown)=>void}[]=[];
 client.set((path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>new Promise(resolve=>calls.push({url:new URL(path,'http://fixture'),signal:options.signal,finish:resolve})));
 const options={type:'social' as const,category:'screen',workId:'movie',relationship:'all' as const,relationshipKind:'movie',href:'/media/movie?section=activity',layout:'row' as const};
 let source!:ReturnType<typeof createSocialSource>;const dispose=runtime.effect_root(()=>source=createSocialSource(()=>options));runtime.flush();
 try{
  expect(source.filters[0].options?.map(option=>option.label)).toEqual(['All','Watched','Watching','Watchlist','Lists','Favourites']);
  source.filters[0].change('favourites');await settle();expect(calls).toHaveLength(1);expect(calls[0].url.searchParams.get('relationship')).toBe('favourites');
  calls[0].finish({...feed('favourite',true),next:{before:'1970-01-01T00:00:00Z',beforeId:'00000000-0000-4000-8000-000000000001',beforeKnown:'false',beforeRelationship:'true'}});await settle();
  const append=source.load(2,true);expect(calls[1].url.searchParams.get('beforeRelationship')).toBe('true');expect(calls[1].url.searchParams.get('relationship')).toBe('favourites');
  source.filters[0].change('lists');await settle();expect(calls).toHaveLength(3);expect(calls[1].signal.aborted).toBe(true);expect(calls[2].url.searchParams.has('before')).toBe(false);expect(calls[2].url.searchParams.has('beforeRelationship')).toBe(false);expect(source.items).toEqual([]);
  calls[1].finish(feed('stale'));await append;expect(source.items).toEqual([]);calls[2].finish(feed('listed'));await settle();expect(source.items.map(item=>item.id)).toEqual(['listed']);expect(source.href).toBe('/media/movie?section=activity&relationship=lists');
 }finally{lifecycle.destroy();dispose();}
});

test('the same Activity control uses medium-specific relationship labels',()=>{
 for(const [kind,labels] of Object.entries({book:['Read','Reading','To read'],comic:['Read','Reading','To read'],game:['Played','Playing','Backlog'],album:['Listened','Listening','Saved for later'],track:['Listened','Listening','Saved for later'],artist:['Listened','Listening','Saved for later']})){
  let source!:ReturnType<typeof createSocialSource>;const dispose=runtime.effect_root(()=>source=createSocialSource(()=>({type:'social',workId:'item',relationship:'all',relationshipKind:kind})));runtime.flush();
  try{expect(source.filters[0].options?.slice(1,4).map(option=>option.label)).toEqual(labels);}finally{lifecycle.destroy();dispose();}
 }
});
