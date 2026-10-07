import {expect,test} from 'bun:test';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {ProviderHttpError} from '../src/lib/server/security/provider-fetch';

test('shared screen metadata omits discarded sources while user access keeps source identities',async()=>{
  const fields:string[]=[];
  const adapter=new JellyfinAdapter(async path=>{
    const query=new URL(path,'https://fixture.invalid').searchParams;
    fields.push(query.get('fields')!);
    expect(query.get('enableUserData')).toBe(fields.length===1?'false':'true');
    return {Items:[],TotalRecordCount:0};
  },'device');
  await adapter.library('user');await adapter.library('user',0,undefined,'user');
  expect(fields[0]).not.toContain('MediaSources');expect(fields[0]).not.toContain('MediaStreams');
  expect(fields[1]).toContain('MediaSources');
});

test('authenticated rich screen hydration is bounded, deduplicated and preserves omitted items',async()=>{
  const ids=Array.from({length:102},(_,n)=>n.toString(16).padStart(32,'0'));
  const lengths:number[]=[];
  const adapter=new JellyfinAdapter(async(path,init)=>{
    const query=new URL(path,'https://fixture.invalid').searchParams;
    expect(query.get('userId')).toBe('linked-user');
    expect(new Headers(init?.headers).get('Authorization')).toContain('Token="secret"');
    expect(query.get('fields')).toContain('ProviderIds');
    const batch=query.get('ids')!.split(',');lengths.push(batch.length);
    const visible=batch.filter(id=>id!==ids[1]);
    return {Items:visible.map(Id=>({Id,Type:'Movie',Name:'Fixture'})),TotalRecordCount:visible.length,StartIndex:0};
  },'device','secret');
  const items=await adapter.items('linked-user',[...ids,ids[0]]);
  expect(lengths).toEqual([100,2]);expect(items).toHaveLength(101);expect(items.some(item=>item.id===ids[1])).toBe(false);
  expect(await adapter.items('linked-user',[])).toEqual([]);
});

test('screen metadata-save cursors never restrict per-user state or access scans',async()=>{
  const queries:URLSearchParams[]=[];
  const adapter=new JellyfinAdapter(async path=>{queries.push(new URL(path,'https://fixture.invalid').searchParams);return {Items:[],TotalRecordCount:0};},'device');
  const since='2026-01-01T00:00:00.000Z';
  await adapter.library('user',0,since,'library');await adapter.library('user',0,since,'user','IsPlayed');
  expect(queries[0].get('minDateLastSaved')).toBe(since);expect(queries[1].get('minDateLastSaved')).toBeNull();
  expect(queries[1].get('filters')).toBe('IsPlayed');
});

test('malformed screen pages cannot publish completed traversal evidence',async()=>{
  for(const page of [
    {Items:[],TotalRecordCount:1},
    {Items:[],TotalRecordCount:-1},
    {Items:[],TotalRecordCount:1.5},
    {Items:[],TotalRecordCount:0,StartIndex:1},
    {Items:[{Id:'one',Type:'Movie'}],TotalRecordCount:0},
    {Items:[{Id:'one',Type:'Movie'},{Id:'one',Type:'Movie'}],TotalRecordCount:2},
  ])await expect(new JellyfinAdapter(async()=>page,'device').library('user')).rejects.toThrow();
});

test('rich lookups reject unrelated identities and tolerate equivalent GUID formatting',async()=>{
  const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const good=new JellyfinAdapter(async()=>({Items:[{Id:'a'.repeat(32),Type:'Movie'}],TotalRecordCount:1}),'device');
  expect((await good.items('user',[id]))[0].id).toBe(id);
  const bad=new JellyfinAdapter(async()=>({Items:[{Id:'b'.repeat(32),Type:'Movie'}],TotalRecordCount:1}),'device');
  await expect(bad.items('user',[id])).rejects.toThrow('unexpected item identities');
  const single=new JellyfinAdapter(async()=>({Id:'b'.repeat(32),Type:'Movie'}),'device');
  await expect(single.item('user',id)).rejects.toThrow('unexpected item identities');
});

test('only a missing individual item is skippable, never permissions or missing batch endpoint',async()=>{
  for(const status of [404,410]) {
    const adapter=new JellyfinAdapter(async()=>{throw new ProviderHttpError(status);},'device');
    expect(await adapter.itemIfAvailable('user','item')).toBeNull();
    await expect(adapter.items('user',['item'])).rejects.toThrow();
  }
  for(const status of [401,403,429,503]) {
    const adapter=new JellyfinAdapter(async()=>{throw new ProviderHttpError(status);},'device');
    await expect(adapter.itemIfAvailable('user','item')).rejects.toThrow();
  }
});

test('music scan projections separate metadata from personal observations without filtering user state by metadata time',async()=>{
  const queries:URLSearchParams[]=[];
  const adapter=new JellyfinAdapter(async path=>{queries.push(new URL(path,'https://fixture.invalid').searchParams);return {Items:[],TotalRecordCount:0};},'device');
  const since='2026-01-01T00:00:00.000Z';
  await adapter.musicLibrary('user',{kind:'track'},{scope:'library',since});
  await adapter.musicLibrary('user',{kind:'track',filter:'IsFavorite'},{scope:'user',since});
  await adapter.musicLibrary('user',{kind:'track'});
  expect(queries[0].get('minDateLastSaved')).toBe(since);expect(queries[0].get('enableUserData')).toBe('false');
  expect(queries[0].get('fields')).toContain('ProviderIds');
  expect(queries[1].get('minDateLastSaved')).toBeNull();expect(queries[1].get('enableUserData')).toBe('true');
  expect(queries[1].get('enableImages')).toBe('false');expect(queries[1].get('fields')).toBe('ChildCount');expect(queries[1].get('filters')).toBe('IsFavorite');
  expect(queries[2].get('enableImages')).toBe('true');expect(queries[2].get('fields')).toContain('Overview');
});

test('rich music batch keeps identity metadata and rejects item substitution',async()=>{
  const id='c'.repeat(32),mbid='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const adapter=new JellyfinAdapter(async path=>{
    const query=new URL(path,'https://fixture.invalid').searchParams;
    expect(query.get('ids')).toBe(id);expect(query.get('userId')).toBe('user');expect(query.get('enableImages')).toBe('true');
    return {Items:[{Id:id,Type:'Audio',ProviderIds:{MusicBrainzTrack:mbid},UserData:{PlayCount:2}}],TotalRecordCount:1};
  },'device');
  const [track]=await adapter.musicItems('user',[id,id]);expect(track.externalIds.musicbrainztrack).toBe(mbid);expect(track.playCount).toBe(2);
  const bad=new JellyfinAdapter(async()=>({Items:[{Id:'b'.repeat(32),Type:'Audio'}],TotalRecordCount:1}),'device');
  await expect(bad.musicItems('user',[id])).rejects.toThrow('unexpected item identities');
});
