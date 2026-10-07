import {expect,test} from 'bun:test';
import {SeerrAdapter,SeerrPermission} from '../src/lib/providers/seerr/adapter.server';

test('request scans reuse a verified identity for each page and retain authenticated user scope',async()=>{
  const paths:string[]=[],account={id:42,permissions:SeerrPermission.REQUEST};
  const adapter=new SeerrAdapter(async(path,init)=>{
    paths.push(path);expect(new Headers(init?.headers).get('X-Api-User')).toBe('42');
    return path.endsWith('/auth/me')?account:{results:[]};
  },'fixture-key',42);
  const verified=await adapter.user();
  await adapter.requests(0,false,verified);await adapter.requests(100,false,verified);
  expect(paths.filter(path=>path.endsWith('/auth/me'))).toHaveLength(1);
  expect(paths[2]).toContain('skip=100');expect(paths[2]).toContain('requestedBy=42');
  await expect(adapter.requests(0,false,{id:43,permissions:32})).rejects.toThrow('account changed');
  await expect(adapter.requests(0,true,verified)).rejects.toThrow('permission');
});

test('request list responses cannot import another account or repeated identities',async()=>{
  const account={id:42,permissions:SeerrPermission.REQUEST};
  for(const results of [
    [{id:1,status:1,requestedBy:{id:43}}],
    [{id:1,status:1},{id:1,status:1}],
    Array.from({length:101},(_,id)=>({id,status:1})),
  ])await expect(new SeerrAdapter(async()=>({results}),'fixture-key',42).requests(0,false,account)).rejects.toThrow('unexpected request page');
});
