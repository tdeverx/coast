import {expect,test} from 'bun:test';
import {drizzle} from 'drizzle-orm/pg-proxy';
import type {ProgressExperimentContent} from '../src/lib/progress-experiment';

// Exercise the real mixed query builder and hydrator boundary with an authored
// candidate set. Native SQL/metadata equivalence is checked separately on dev data.
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const state={count:95,queries:[] as {sql:string;params:unknown[]}[],hydrated:[] as string[][],viewers:[] as string[],mediums:[] as string[],comic:false,abortAtCount:undefined as AbortController|undefined,featureReads:0,historyReads:0};
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids=()=>Array.from({length:state.count},(_,index)=>id(index+1));
const database=drizzle(async(query,params)=>{
  state.queries.push({sql:query,params});
  if(query.startsWith('select count(')){
    state.abortAtCount?.abort();return {rows:[[state.count]]};
  }
  if(query.startsWith('select distinct on'))return {rows:[]};
  const limit=query.match(/limit \$(\d+)/),offset=query.match(/offset \$(\d+)/);
  if(!limit)throw Error('The card projection must have a SQL LIMIT.');
  const take=Number(params[Number(limit[1])-1]),start=offset?Number(params[Number(offset[1])-1]):0;
  return {rows:ids().slice(start,start+take).map(value=>[value,true])};
});
const fixtureUrl=moduleUrl(`
  export let fixture;export const install=next=>fixture=next;
  export const getDb=()=>fixture.database;
  export const getFeatureConfig=async()=>{fixture.state.featureReads++;return {features:{screen:true},experimentalMusic:true,experimentalGaming:false,experimentalBooks:false,experimentalComics:false};};
  export const screenProgressPlan=async()=>({allIds:fixture.ids(),sequenceById:new Map()});
  export const mediumProgressIds=async(_user,options)=>{fixture.state.mediums.push(options.category);return [];};export const readingProgressIds=async()=>[];
  export const listCandidateIds=async()=>fixture.ids();
  export const collectionCTE=()=>'';
  export const collectionRead=async()=>{fixture.state.historyReads++;return fixture.ids().map(id=>({id}));};
  export const decorateProgressCards=()=>{};
  export const workCards=async(_owner,viewer,ids)=>{fixture.state.viewers.push(viewer);fixture.state.hydrated.push(ids);return ids.map(id=>({id,title:id,kind:fixture.state.comic?'comic':'movie'}));};
`);
const fixture=await import(fixtureUrl);fixture.install({database,state,ids});
let code=new Bun.Transpiler({loader:'ts'}).transformSync(await Bun.file(new URL('../src/lib/server/queries/progress-experiment.ts',import.meta.url)).text());
for(const path of ['#lib/collection/query.server.js','../features','../db','./lists','./progress'])code=code.replaceAll(`from "${path}"`,`from ${JSON.stringify(fixtureUrl)}`);
const resolve:Record<string,string>={
  'valibot':import.meta.resolve('valibot'),'drizzle-orm':import.meta.resolve('drizzle-orm'),
  '#lib/experimental.js':import.meta.resolve('../src/lib/experimental'),
  '#lib/progress-experiment.js':import.meta.resolve('../src/lib/progress-experiment'),
  '#lib/progress.js':import.meta.resolve('../src/lib/progress'),
  '#lib/page-window.js':import.meta.resolve('../src/lib/page-window'),
  '../db/schema':import.meta.resolve('../src/lib/server/db/schema'),
  '../experimental':import.meta.resolve('../src/lib/server/experimental'),
  './media':import.meta.resolve('../src/lib/server/queries/media'),
  './viewing-recency':import.meta.resolve('../src/lib/server/queries/viewing-recency'),
  '#lib/core/tracking/rewatch.server.js':import.meta.resolve('../src/lib/core/tracking/rewatch.server'),
  './pagination':import.meta.resolve('../src/lib/server/queries/pagination'),
  './library':import.meta.resolve('../src/lib/server/queries/library'),
};
for(const [path,resolved]of Object.entries(resolve))code=code.replaceAll(`from "${path}"`,`from ${JSON.stringify(resolved)}`);
const {progressExperimentData}:typeof import('../src/lib/server/queries/progress-experiment')=await import(moduleUrl(code));
const reset=()=>{state.count=95;state.queries=[];state.hydrated=[];state.viewers=[];state.mediums=[];state.comic=false;state.abortAtCount=undefined;state.featureReads=0;state.historyReads=0;};

test('row demand hydrates twenty cards while expanded pages preserve exact totals and the sixty-card boundary',async()=>{
  reset();
  const row=await progressExperimentData(id(999),{},{preview:true});
  expect(row.items.map(item=>item.id)).toEqual(ids().slice(0,20));expect(row.total).toBe(95);expect(row.pages).toBe(5);
  expect(state.hydrated.map(batch=>batch.length)).toEqual([20]);
  const first=await progressExperimentData(id(999),{});
  expect(first.items.map(item=>item.id)).toEqual(ids().slice(0,60));
  const second=await progressExperimentData(id(999),{page:2});
  expect(second.items.map(item=>item.id)).toEqual(ids().slice(60));expect(second.total).toBe(95);
  const clamped=await progressExperimentData(id(999),{page:999});expect(clamped).toEqual(second);
  const preview=await progressExperimentData(id(999),{page:2},{preview:true});expect(preview.page).toBe(2);expect(preview.items.map(item=>item.id)).toEqual(ids().slice(20,40));
  const batches=[];
  for(let page=1;page<=row.pages;page++)batches.push(...(await progressExperimentData(id(999),{page},{preview:true})).items);
  expect(batches.map(item=>item.id)).toEqual(ids());
});

test('candidate volume does not grow SQL parameter shape and availability is projected only by the bounded page query',async()=>{
  reset();await progressExperimentData(id(999),{},{preview:true});
  const first=state.queries.map(query=>({sql:query.sql,parameters:query.params.length}));
  expect(first[0].sql).not.toContain('permitted');
  expect(first[1].sql).toContain('limit');expect(first[1].sql).toContain('::uuid[]');
  state.count=190;state.queries=[];
  await progressExperimentData(id(999),{},{preview:true});
  expect(state.queries.map(query=>({sql:query.sql,parameters:query.params.length}))).toEqual(first);
  expect(state.hydrated.map(batch=>batch.length)).toEqual([20,20]);
});

test('aborted requests do not begin planning or subsequent card hydration',async()=>{
  reset();const cancelled=new AbortController();cancelled.abort();
  await expect(progressExperimentData(id(999),{},{signal:cancelled.signal})).rejects.toThrow();
  expect(state.featureReads).toBe(0);expect(state.queries).toHaveLength(0);
  const midway=new AbortController();state.abortAtCount=midway;
  await expect(progressExperimentData(id(999),{},{signal:midway.signal})).rejects.toThrow();
  expect(state.queries).toHaveLength(1);expect(state.hydrated).toHaveLength(0);
});

test('saved segments retain bounded hydration and reading collection lookup stays one query per page',async()=>{
  for(const view of ['watchlist','favourites'] as const){
    reset();state.comic=true;
    const result:ProgressExperimentContent=await progressExperimentData(id(999),{view},{preview:true});
    expect(result.items).toHaveLength(20);expect(result.total).toBe(95);
    expect(state.hydrated).toHaveLength(1);
    const groups=state.queries.filter(query=>query.sql.startsWith('select distinct on'));
    expect(groups).toHaveLength(1);expect(groups[0].params).toHaveLength(1);
  }
});

test('profile Finished/Dropped reuse state assessment and keep viewer privacy before count and hydration',async()=>{
  for(const view of ['continue','next','watchlist','favourites','finished','dropped'] as const){
    reset();
    const owner=id(999),viewer=id(998);
    const result=await progressExperimentData(owner,{view},{preview:true,viewerId:viewer});
    expect(result.items).toHaveLength(20);expect(result.pages).toBe(5);expect(state.viewers).toEqual([viewer]);
    expect(state.historyReads).toBe(['finished','dropped'].includes(view)?1:0);
    const count=state.queries[0];expect(count.sql).toContain('social_visible');expect(count.params).toContain(owner);expect(count.params).toContain(viewer);
    expect(count.sql).toMatch(/"works"\."category" <> \$\d+/);
    expect(count.params).toContain('music');expect(state.mediums).not.toContain('music');
    expect(count.params).toContain(view==='favourites'?'favourites':view==='watchlist'?'collection':'progress');
    if(view==='next')expect(count.sql).toContain("'collection'");
  }
});
