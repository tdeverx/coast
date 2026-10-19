import {afterAll,expect,test} from 'bun:test';
import {closeDb,getSql} from '../src/lib/server/db';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const source=await Bun.file(new URL('../src/lib/recommendations/query.server.ts',import.meta.url)).text();
const aggregate=source.match(/\), evidence_genres as materialized \(([\s\S]*?)\n \), provider_matches as \(/)?.[1];
const start=source.indexOf('least(30,coalesce('),end=source.indexOf('-3*(select count(*)',start);
if(!aggregate||start<0||end<0)throw new Error('Recommendation genre scoring source changed; review its SQL contract.');
const genreScore=source.slice(start,end);
const previousScore='least(30,coalesce((select sum(e.weight*(select count(*) from unnest(c.genres) genre where genre=any(e.genres))) from evidence e where c.genres&&e.genres),0))';

afterAll(async()=>{if(process.env.COAST_AUDIT_REAL_DATA_CLONE==='1')await closeDb();});

run('genre evidence counts each root once and each candidate occurrence, preserving nulls, cap and float type',async()=>{
 // Tableless authored correctness controls, never an actual-media performance cohort.
 const cases:{evidence:{weight:number;genres:(string|null)[]|null}[];candidate:(string|null)[]|null;score:number}[]=[
  {evidence:[{weight:3,genres:['A','A']}],candidate:['A'],score:3},
  {evidence:[{weight:3,genres:['A']}],candidate:['A','A'],score:6},
  {evidence:[{weight:3,genres:['A','A']},{weight:2,genres:['A']}],candidate:['A','A'],score:10},
  {evidence:[{weight:5,genres:['A','B','A']},{weight:2,genres:['B','C']}],candidate:['A','B','B',null],score:19},
  {evidence:[{weight:3,genres:null},{weight:4,genres:[]},{weight:2,genres:[null,'A',null]}],candidate:['A',null],score:2},
  {evidence:[{weight:5,genres:['A']}],candidate:null,score:0},
  {evidence:[{weight:5,genres:['A']}],candidate:[],score:0},
  {evidence:[{weight:5,genres:[null]}],candidate:[null],score:0},
  {evidence:[],candidate:['A'],score:0},
  {evidence:[{weight:4,genres:['A']}],candidate:['B'],score:0},
  {evidence:[{weight:5,genres:['A']}],candidate:Array(8).fill('A'),score:30},
 ];
 await getSql().begin(async tx=>{
  await tx`SET TRANSACTION READ ONLY`;
  await tx`SET LOCAL statement_timeout='10s'`;
  await tx`SET LOCAL lock_timeout='1s'`;
  const [settings]=await tx`select current_setting('transaction_read_only') as read_only,current_setting('statement_timeout') as statement_timeout,current_setting('lock_timeout') as lock_timeout`;
  expect(settings).toMatchObject({read_only:'on',statement_timeout:'10s',lock_timeout:'1s'});
  for(const value of cases){
   const [result]=await tx.unsafe(`with evidence as (
    select * from jsonb_to_recordset($1::text::jsonb) e(weight double precision,genres text[])
   ), evidence_genres as materialized (${aggregate}), candidates as (
    select * from jsonb_to_recordset($2::text::jsonb) c(genres text[])
   ) select ${genreScore} as score,${previousScore} as previous_score,pg_typeof(${genreScore})::text as score_type from candidates c`,[JSON.stringify(value.evidence),JSON.stringify([{genres:value.candidate}])]);
   expect(result.score).toBe(value.score);
   expect(result.previous_score).toBe(value.score);
   expect(result.score_type).toBe('double precision');
  }
 });
});
