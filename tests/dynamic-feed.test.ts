import {expect,test} from 'bun:test';
import type {InterestWork} from '../src/lib/recommendations/interests.server';
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const stateUrl=moduleUrl('export let works=[],reads=0,queries=0;export const setWorks=next=>{works=next;reads=0;queries=0;};export const interestWorks=async()=>{reads++;return works;};const sql=async()=>{queries++;return [];};sql.array=value=>value;export const getSql=()=>sql;export const getFeatureConfig=async()=>({features:{screen:true,personalisation:true,social:true},experimentalGaming:true,experimentalMusic:true,experimentalBooks:true,experimentalComics:true});');
const source=(await Bun.file(new URL('../src/lib/recommendations/feed.server.ts',import.meta.url)).text())
 .replaceAll("'valibot'",JSON.stringify(import.meta.resolve('valibot')))
 .replaceAll("'#lib/server/db/index.js'",JSON.stringify(stateUrl))
 .replaceAll("'#lib/server/features.js'",JSON.stringify(stateUrl))
 .replaceAll("'./interests.server'",JSON.stringify(stateUrl))
 .replaceAll("'#lib/server/security/errors.js'",JSON.stringify(import.meta.resolve('../src/lib/server/security/errors')))
 .replaceAll("'./row-titles'",JSON.stringify(import.meta.resolve('../src/lib/recommendations/row-titles')))
 .replaceAll("'./row-ranking'",JSON.stringify(import.meta.resolve('../src/lib/recommendations/row-ranking')));
// Only configuration/evidence/SQL are synthetic; definition construction and
// ranking run from the actual server owner without a database or provider.
const {dynamicFeed}:typeof import('../src/lib/recommendations/feed.server')=await import(moduleUrl(new Bun.Transpiler({loader:'ts'}).transformSync(source)));
const boundary=await import(stateUrl);
const work=(index:number,genres:string[],category:InterestWork['category']='screen'):InterestWork=>({id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,category,kind:category==='screen'?'movie':'game',title:`Work ${index}`,genres,weight:5,consumed:true,positive:true,updated:'2026-10-15'});
const feedUrl=()=>new URL('http://fixture/feed?seed=stable-seed');
test('a definition census includes every ordered identity once and never hydrates cards',async()=>{
 boundary.setWorks(Array.from({length:20},(_,index)=>work(index,[`Genre ${index}`])));
 const initial=await dynamicFeed('viewer',feedUrl());
 expect(initial.rows).toHaveLength(62);expect(new Set(initial.rows.map(row=>row.key)).size).toBe(62);
 expect(initial.rows.every(row=>!('items' in row)&&!('weight' in row))).toBe(true);
 expect(boundary.reads).toBe(1);expect(boundary.queries).toBe(1);
 expect((await dynamicFeed('viewer',feedUrl())).rows).toEqual(initial.rows);
 boundary.setWorks([work(999,['New genre'])]);await dynamicFeed('viewer',feedUrl());
 expect(initial.rows).toHaveLength(62);
});
test('the complete census accepts 10,000 definitions and explicitly rejects overflow without truncation',async()=>{
 const genres=Array.from({length:4996},(_,index)=>`Genre ${index}`);
 boundary.setWorks([work(1,genres),work(2,['Game A','Game B'],'game')]);
 expect((await dynamicFeed('viewer',feedUrl())).rows).toHaveLength(10000);
 boundary.setWorks([work(1,[...genres,'One extra']),work(2,['Game A','Game B'],'game')]);
 await expect(dynamicFeed('viewer',feedUrl())).rejects.toMatchObject({status:413,code:'feed_definition_limit'});
});
