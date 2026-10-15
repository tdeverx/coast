import {expect,test} from 'bun:test';
import {mergeProviderListItems,projectProviderList} from '../src/lib/sync/list-values.server';
import {decideSync} from '../src/lib/sync/values.server';

const value=(items:string[])=>({name:'List',description:'',items});

test('the transmitted list snapshot leaves a concurrent local edit pending',()=>{
  const sent=value(['movie-a']),local=value(['movie-a','movie-b']);
  expect(decideSync(local,sent,{remote:sent,agreed:sent,conflict:false})).toBe('local');
  expect(decideSync(value(['movie-b','movie-a']),sent,{remote:sent,agreed:sent,conflict:false})).toBe('local');
});

test('provider baselines ignore unsupported members, including older full-list baselines',()=>{
  const supported=new Set(['movie-a','movie-b']),local=value(['movie-a','game','book']);
  const projected=projectProviderList(local,supported);
  expect(projected.items).toEqual(['movie-a']);
  expect(local.items).toEqual(['movie-a','game','book']);
  expect(decideSync(projected,value(['movie-a']),{
    remote:projectProviderList(local,supported),agreed:projectProviderList(local,supported),conflict:false,
  })).toBe('agree');
});

test('remote membership and order replace only representable slots',()=>{
  const supported=new Set(['a','b','c']);
  expect(mergeProviderListItems(['game','a','book','b','music'],['c','a'],supported))
    .toEqual(['game','c','book','a','music']);
  expect(mergeProviderListItems(['a','game','book'],['b','c'],supported)).toEqual(['b','game','book','c']);
  expect(mergeProviderListItems(['a','game','b','book'],[],supported)).toEqual(['game','book']);
  expect(mergeProviderListItems(['game','book'],['a','a'],supported)).toEqual(['game','book','a']);
});
