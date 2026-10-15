import { expect, test } from 'bun:test';
import { matchTraktList } from '../src/lib/sync/trakt-list-matching';

type Entry={kind:string;ids:Record<string,unknown>;rankId?:number};
const aliases=['trakt','tmdb','tvdb','imdb'];
const matches=(a:Entry,b:Entry)=>a.kind===b.kind&&aliases.some(key=>a.ids[key]!=null&&b.ids[key]!=null&&String(a.ids[key])===String(b.ids[key]));
const oracle=(desired:Entry[],remote:Entry[])=>({removed:remote.filter(entry=>!desired.some(wanted=>matches(wanted,entry))),matches:desired.map(wanted=>remote.find(entry=>matches(wanted,entry)))});

test('list matching retains first remote occurrence across aliases, kinds and duplicate desired entries',()=>{
 const desired:Entry[]=[{kind:'movie',ids:{trakt:7,tmdb:'8'}},{kind:'movie',ids:{trakt:'7'}},{kind:'show',ids:{trakt:7}},{kind:'season',ids:{imdb:'season'}},{kind:'movie',ids:{trakt:0}},{kind:'episode',ids:{trakt:null}}];
 const remote:Entry[]=[{kind:'movie',ids:{tmdb:8},rankId:20},{kind:'movie',ids:{trakt:7},rankId:10},{kind:'show',ids:{trakt:'7'},rankId:30},{kind:'season',ids:{imdb:'season'},rankId:40},{kind:'movie',ids:{trakt:'0'},rankId:50},{kind:'movie',ids:{trakt:99},rankId:60}];
 expect(matchTraktList(desired,remote)).toEqual(oracle(desired,remote));
 expect(matchTraktList(desired,remote).matches.map(entry=>entry?.rankId)).toEqual([20,10,30,40,50,undefined]);
 expect(matchTraktList([],[])).toEqual({removed:[],matches:[]});
});

test('indexed matching is equivalent to the nested oracle for overlapping provider aliases',()=>{
 let seed=19;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let fixture=0;fixture<30;fixture++){
  const entries=(length:number):Entry[]=>Array.from({length},(_,rankId)=>({kind:['movie','show','season','episode'][random()%4],ids:Object.fromEntries(aliases.flatMap(key=>random()%3?[[key,random()%25]]:[])),rankId}));
  const desired=entries(100),remote=entries(120);
  expect(matchTraktList(desired,remote)).toEqual(oracle(desired,remote));
 }
});

test('alias reads remain linear for large complete lists',()=>{
 for(const size of [100,1000]){
  let reads=0;
  const entries=()=>Array.from({length:size},(_,id)=>({kind:'movie',ids:Object.defineProperty({},'trakt',{enumerable:true,get(){reads++;return id;}}),rankId:id}));
  const desired=entries(),remote=entries(),result=matchTraktList(desired,remote);
  expect(result.removed).toEqual([]);expect(result.matches.map(entry=>entry?.rankId)).toEqual(Array.from({length:size},(_,id)=>id));
  expect(reads).toBeLessThanOrEqual(size*16);
 }
});
