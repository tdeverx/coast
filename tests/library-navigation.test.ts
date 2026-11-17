import {expect,test} from 'bun:test';
// @ts-expect-error Svelte's internal rune control runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {create,settle} from './fixtures/library-window';

for(const boundary of ['pending navigation','committed URL'])test(`a pending grid read cannot overwrite ${boundary} before its server props arrive`,async()=>{
  // Empty ownership controls supplement the separate genuine HTTP/DTO browser replay.
  // No fabricated catalogue identities or provider responses are needed for this race.
  let answer!:(value:unknown)=>void,signal!:AbortSignal,owner:any;
  const initial={items:[],page:1,pages:3,total:120};
  const dispose=runtime.effect_root(()=>{
    owner=create((_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
      signal=options.signal;
      return new Promise(resolve=>{answer=resolve;});
    },{user:{id:'ownership-control'},capabilities:{screen:true},contentRevision:{}},
    {embedded:false,options:{surface:'watch',layout:'grid',initial}});
  });
  try{
    await settle();
    const pending=owner.source.load(2,true);
    if(boundary==='pending navigation')owner.setNavigating('/library?view=listen');
    else owner.setUrl('/library?view=listen');
    answer({items:[],page:2,pages:3,total:120});
    await pending;await settle();
    expect(signal.aborted).toBe(true);
    expect(owner.navigation).toEqual([]);
    expect(owner.content).toBe(initial);
    expect(owner.source.busy).toBe(false);
  }finally{owner.dispose();dispose();}
});

test('Library retains entity navigation and sends medium-specific status to its paginated source', async () => {
  for (const [surface, kind, status, label] of [
    ['watch','show','watched','Watch status'],
    ['watch','show','paused','Watch status'],
    ['read','book','paused','Reading status'],
    ['play','all','paused','Playthrough status'],
  ]) {
    const paths: URL[] = [];
    let owner: any;
    const dispose = runtime.effect_root(() => {
      owner = create(async (path: string) => {
        paths.push(new URL(path,'https://fixture.test/'));
        return {items:[],page:1,pages:1,total:0};
      }, {
        user:{id:'filter-owner'}, experimentalBooks:true, experimentalGaming:true,
        capabilities:{screen:true,book:true,game:true}, contentRevision:{},
      }, { options:{surface,initialKind:kind,entitySegments:true,kindControl:false,layout:'grid'} });
    });
    try {
      await settle();
      const statuses = owner.source.controls.find((control:any) => control.label === label);
      expect(statuses.options.map((option:any) => option.value)).toContain(status);
      expect(owner.source.filters[0].type).toBe('segments');
      expect(owner.source.filters[0].value).toBe(kind);
      expect(paths).toHaveLength(0);
      statuses.change(status); await settle();
      expect(paths).toHaveLength(1);
      expect(paths[0].searchParams.get('selection')).toBe(status);
      expect(paths[0].searchParams.get('kind')).toBe(kind);
      expect(paths[0].searchParams.get('page')).toBe('1');
      expect(owner.source.filters[0].value).toBe(kind);
    } finally { owner.dispose(); dispose(); }
  }
});

test('Collection has one availability owner and named Collections preserve their user scope', async () => {
  const calls: URL[] = [];
  let owner: any;
  const dispose = runtime.effect_root(() => {
    owner = create(async (path: string) => {
      calls.push(new URL(path,'https://fixture.test/'));
      return {items:[],page:1,pages:1,total:0};
    }, {
      user:{id:'filter-owner'}, experimentalBooks:true, experimentalComics:true, experimentalMusic:true,
      capabilities:{screen:true,book:true,comic:true,music:true}, contentRevision:{},
    }, {options:{surface:'read',initialKind:'book',username:'friend',collection:true,entitySegments:true,kindControl:false,layout:'grid'}});
  });
  try {
    await settle();
    expect(owner.source.filters.map((control:any) => control.type)).toEqual(['segments']);
    expect(owner.source.filters[0].options.map((option:any) => option.value)).toEqual(['book','comic']);
    const availability = owner.source.controls.find((control:any) => control.label === 'Availability');
    expect(availability.options.find((option:any) => option.value === 'available').label).toBe('Available to read');
    availability.change('available'); await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe('/collection');
    expect(calls[0].searchParams.get('username')).toBe('friend');
    expect(calls[0].searchParams.get('availability')).toBe('available');
    owner.source.controls.find((control:any) => control.label === 'Reading status').change('paused');
    await settle();
    expect(calls[1].searchParams.get('activity')).toBe('paused');
    expect(calls[1].searchParams.get('username')).toBe('friend');
  } finally { owner.dispose(); dispose(); }
});

test('Library resets active filters in one read while preserving its entity and source defaults',async()=>{
 const calls:{url:URL;signal:AbortSignal;resolve:(value:unknown)=>void}[]=[];let owner:any;
 const dispose=runtime.effect_root(()=>{
  owner=create((path:string,_body:unknown,_method:string,{signal}:{signal:AbortSignal})=>new Promise(resolve=>calls.push({url:new URL(path,'https://fixture.test/'),signal,resolve})),{user:{id:'filter-owner'},capabilities:{screen:true},contentRevision:{}},{options:{surface:'watch',initialKind:'show',initialScope:'available',entitySegments:true,kindControl:false,layout:'grid'}});
 });
 try{
  await settle();expect(owner.source.filterReset.disabled).toBe(true);
  owner.source.controls.find((control:any)=>control.label==='Watch status').change('paused');
  owner.source.controls.find((control:any)=>control.label==='Sort by').change('title');
  const before=calls.length;const reset=owner.source.filterReset.run();
  expect(calls).toHaveLength(before+1);expect(calls[before-1].signal.aborted).toBe(true);
  const query=calls.at(-1)!.url.searchParams;
  expect(query.get('kind')).toBe('show');expect(query.get('selection')).toBe('all');expect(query.get('scope')).toBe('available');expect(query.get('sort')).toBe('default');expect(query.get('page')).toBe('1');
  calls.at(-1)!.resolve({items:[],page:1,pages:1,total:0});await reset;await settle();
  expect(owner.source.filterReset.disabled).toBe(true);
 }finally{owner.dispose();dispose();}
});

test('resetting an artist Library never reintroduces unavailable Collection or scope controls',async()=>{
 const paths:URL[]=[];let owner:any;
 const dispose=runtime.effect_root(()=>{
  owner=create(async(path:string)=>{paths.push(new URL(path,'https://fixture.test/'));return {items:[],page:1,pages:1,total:0};},{user:{id:'filter-owner'},experimentalMusic:true,capabilities:{music:true},contentRevision:{}},{options:{surface:'listen',initialSelection:'album',initialScope:'available',collection:true,entitySegments:true,kindControl:false,layout:'grid'}});
 });
 try{
  await settle();owner.source.filters[0].change('artist');await settle();
  owner.source.controls.find((control:any)=>control.label==='Sort by').change('title');await settle();
  await owner.source.filterReset.run();await settle();
  expect(paths.at(-1)!.pathname).toBe('/library');
  expect(paths.at(-1)!.searchParams.get('selection')).toBe('artist');
  expect(paths.at(-1)!.searchParams.get('scope')).toBe('all');
  expect(owner.source.filters.some((control:any)=>control.type==='collection'||control.type==='availability')).toBe(false);
  expect(owner.source.filterReset.disabled).toBe(true);
 }finally{owner.dispose();dispose();}
});
