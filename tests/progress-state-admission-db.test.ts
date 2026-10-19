import {afterAll,expect,test} from 'bun:test';
import {and,desc,eq,sql} from 'drizzle-orm';
import {getDb,getSql,closeDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {rewatchBoundary,rewatchFields} from '../src/lib/core/tracking/rewatch.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const source=await Bun.file(new URL('../src/lib/server/queries/progress.ts',import.meta.url)).text();
const beforeWhere='.where(eq(s.trackingState.userId, userId))';
const admittedWhere='.where(and(eq(s.trackingState.userId, userId), eq(s.trackingState.dropped, false), sql`(${s.trackingState.watched} or ${s.trackingState.positionSeconds}>0 or ${rewatchBoundary(userId, sql`${s.media.id}`)} is not null)`))';
const start=source.indexOf('  const states = await db'),end=source.indexOf('\n  const planned =',start);
const stateQuery=source.slice(start,end).replace('  const states = await ','').trim().replace(/;$/,'');
const started=source.match(/states\.filter\(\(row\) => !row\.dropped[\s\S]*?\.map\(\(row\) => row\.id\)/)?.[0];
const activeStart=source.indexOf('  const activeIds = states',end),activeEnd=source.indexOf('\n  for (const next of',activeStart);
const active=source.slice(activeStart,activeEnd).replace('  const activeIds = ','').trim().replace(/;$/,'');
if(start<0||end<0||!stateQuery.includes(admittedWhere)||!started||activeStart<0||activeEnd<0)
 throw Error('Continue state admission or its consumers changed; review replay admission before updating this contract.');
const compile=(expression:string,userId:string)=>{
 const body=new Bun.Transpiler({loader:'ts'}).transformSync(`function project(){return ${expression};}`);
 return new Function('db','s','and','desc','eq','sql','rewatchBoundary','rewatchFields','userId',body+';return project();')(getDb(),s,and,desc,eq,sql,rewatchBoundary,rewatchFields,userId).toSQL();
};
const used=(rows:unknown[])=>({started:new Function('states',`return ${started}`)(rows),active:new Function('states',`return ${active}`)(rows)});
afterAll(async()=>{if(process.env.COAST_AUDIT_REAL_DATA_CLONE==='1')await closeDb();});

run('Continue admits direct and inherited replay progress before projecting only usable states',async()=>{
 // Authored tableless correctness cases. They are never saved-media or performance evidence.
 const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,userId=id(999);
 const items=Array.from({length:17},(_,i)=>({id:id(i+1),kind:[7,8,11].includes(i+1)?'episode':i===8?'show':i===9?'season':'movie'}));
 const states=items.map((item,i)=>({user_id:userId,media_id:item.id,watched:[2,12,16,17].includes(i+1),last_watched_at:[16,17].includes(i+1)?'2026-10-05T00:00:00Z':'2026-10-01T00:00:00Z',position_seconds:i===2?20:i===3?30:i===13?95:i===14?-5:0,duration_seconds:100,dropped:[4,13].includes(i+1),updated_at:`2026-10-${String(18-i).padStart(2,'0')}T00:00:00Z`}));
 const episodes=[7,8,11].map(n=>({media_id:id(n),show_id:id(100+n),season_id:id(200+n)}));
 const seasons=[{media_id:id(209),show_id:id(9)},{media_id:id(10),show_id:id(110)}];
 const rewatches=[5,6,107,208,209,110,111,12,13,16,17].map(n=>({user_id:userId,media_id:id(n),started_at:'2026-10-02T00:00:00Z'}));
 const events=[5,7,8,9,10,13,17].map(n=>({id:id(500+n),user_id:userId,media_id:id(n),action:'progress',applied:true,occurred_at_known:true,occurred_at:'2026-10-03T00:00:00Z',position_seconds:20+n}));
 events.push({...events[events.length-1],id:id(600),action:'watch',occurred_at:'2026-10-04T00:00:00Z'});
 const tables:any={media:[items,'id uuid,kind text'],tracking_state:[states,'user_id uuid,media_id uuid,watched boolean,last_watched_at timestamptz,position_seconds real,duration_seconds real,dropped boolean,updated_at timestamptz'],episodes:[episodes,'media_id uuid,show_id uuid,season_id uuid'],seasons:[seasons,'media_id uuid,show_id uuid'],rewatches:[rewatches,'user_id uuid,media_id uuid,started_at timestamptz'],tracking_events:[events,'id uuid,user_id uuid,media_id uuid,action text,applied boolean,occurred_at_known boolean,occurred_at timestamptz,position_seconds real']};
 await getSql().begin(async tx=>{
  await tx`SET TRANSACTION READ ONLY`;await tx`SET LOCAL statement_timeout='10s'`;await tx`SET LOCAL lock_timeout='1s'`;
  expect((await tx`select current_setting('transaction_read_only') as read_only,current_setting('statement_timeout') as statement_timeout,current_setting('lock_timeout') as lock_timeout`)[0]).toMatchObject({read_only:'on',statement_timeout:'10s',lock_timeout:'1s'});
  const values:any={},queries:any={before:compile(stateQuery.replace(admittedWhere,beforeWhere),userId),after:compile(stateQuery,userId)};
  for(const [variant,query] of Object.entries(queries) as [string,any][]){
   const params=[...query.params],ctes=Object.entries(tables).map(([name,[rows,columns]]:any)=>{params.push(JSON.stringify(rows));return `${name} as (select * from jsonb_to_recordset($${params.length}::text::jsonb) x(${columns}))`;});
   // Name the source projection in its declared order; raw SQL bypasses Drizzle field mapping.
   values[variant]=Array.from(await tx.unsafe(`with ${ctes.join(',')} select id,own_rewatch as "ownRewatch",watched,progress,duration,dropped,kind from (${query.sql}) projected(id,own_rewatch,watched,progress,duration,dropped,kind)`,params));
  }
  expect(values.before).toHaveLength(17);
  expect(values.after.map((row:any)=>row.id)).toEqual([2,3,5,6,7,8,9,10,11,12,14,16,17].map(id));
  expect(values.after).toEqual(values.before.filter((row:any)=>values.after.some((admitted:any)=>admitted.id===row.id)));
  expect(used(values.after)).toEqual(used(values.before));
  expect(used(values.after)).toEqual({started:[2,3,5,7,8,9,10,14,16,17].map(id),active:[3,5,6,7,8,12].map(id)});
  expect(values.after.find((row:any)=>row.id===id(11))).toMatchObject({watched:false,progress:0,ownRewatch:false});
  expect(values.after.find((row:any)=>row.id===id(17))).toMatchObject({watched:true,progress:0,ownRewatch:true});
 });
});
