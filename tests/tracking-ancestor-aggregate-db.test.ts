import {afterAll,expect,test} from 'bun:test';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/bun-sql';
import {closeDb,getSql} from '../src/lib/server/db';
import {episodes,trackingState} from '../src/lib/server/db/schema';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const source=await Bun.file(new URL('../src/lib/core/tracking/service.server.ts',import.meta.url)).text();
const episodeStart=source.indexOf('    const [children] = await tx'),episodeEnd=source.indexOf('    const total = children.total;',episodeStart);
const episodeQuery=source.slice(episodeStart,episodeEnd).replace('    const [children] = await ','').trim().replace(/;$/,'');
const collectionStart=source.indexOf('    const children = relationships.length'),collectionEnd=source.indexOf('    const existing = await ensureProjection',collectionStart);
const collectionExpression=source.slice(collectionStart,collectionEnd).replace('    const children = ','').trim().replace(/;$/,'');
const queryStart=collectionExpression.indexOf('? (await tx')+'? (await '.length,queryEnd=collectionExpression.indexOf('))[0]')+1;
const collectionQuery=collectionExpression.slice(queryStart,queryEnd);
function consumer(start:number,collection=false){
 const a=source.indexOf(collection?'    const watched =':'    const total = children.total;',start),b=source.indexOf('    await tx\n      .update(trackingState)',a);
 const setStart=source.indexOf('      .set({',b)+'      .set('.length,setEnd=source.indexOf('\n      })',setStart)+8;
 if(a<0||b<a||setStart<0||setEnd<setStart)throw Error('Review ancestor projection consumer source before updating this contract.');
 const body='function project(){'+source.slice(a,b)+'return '+source.slice(setStart,setEnd)+';}';
 return new Function('children','existing','rebuilding','relationships','Date',new Bun.Transpiler({loader:'ts'}).transformSync(body)+';return project();');
}
if(episodeStart<0||episodeEnd<episodeStart||collectionStart<0||collectionEnd<collectionStart||queryStart<10||queryEnd<queryStart||!episodeQuery.includes('.from(episodes)')||!collectionQuery.includes('.from(trackingState)')||!episodeQuery.includes('minimumPlayCount')||!collectionQuery.includes('minimumPlayCount'))throw Error('Review both real ancestor aggregate statements before updating this contract.');
const episodeConsumer=consumer(episodeEnd),collectionConsumer=consumer(collectionEnd,true);
const compile=(expression:string,values:Record<string,unknown>)=>{
 const names=['tx','episodes','trackingState','and','eq','inArray','sql',...Object.keys(values)];
 const body=new Bun.Transpiler({loader:'ts'}).transformSync('function query(){return '+expression+';}');
 return new Function(...names,body+';return query();')(drizzle.mock(),episodes,trackingState,and,eq,inArray,sql,...Object.values(values)).toSQL();
};
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const userId=id(900),otherUser=id(901),oldDate=new Date('2026-10-01T00:00:00Z'),early='2026-10-02T00:00:00Z',late='2026-10-03T00:00:00Z',clock=Date.UTC(2026,9,18);
class ObservationDate extends Date{constructor(){super(clock);}}
const existing={watched:false,playCount:7,lastWatchedAt:oldDate,dropped:true};
const tables=(rows:unknown[],episodeRows:unknown[]=[])=>({episodes:[episodeRows,'media_id uuid,show_id uuid,season_id uuid,is_special boolean'],tracking_state:[rows,'user_id uuid,media_id uuid,watched boolean,play_count integer,last_watched_at timestamptz']});
async function execute(tx:any,query:{sql:string;params:unknown[]},data:ReturnType<typeof tables>){
 const params=[...query.params],ctes=Object.entries(data).map(([name,[rows,columns]])=>{params.push(JSON.stringify(rows));return `${name} as(select * from jsonb_to_recordset($${params.length}::text::jsonb) x(${columns}))`;});
 const rows=await tx.unsafe(`with ${ctes.join(',')} select total,completed,minimum_play_count as "minimumPlayCount",last_watched_at as "lastWatchedAt" from (${query.sql}) projected(total,completed,minimum_play_count,last_watched_at)`,params);
 expect(rows).toHaveLength(1);
 const row=rows[0];return{...row,lastWatchedAt:row.lastWatchedAt===null?null:new Date(row.lastWatchedAt)};
}
async function readOnly(fn:(tx:any)=>Promise<void>){
 await getSql().begin(async tx=>{
  await tx`SET TRANSACTION READ ONLY`;await tx`SET LOCAL statement_timeout='10s'`;await tx`SET LOCAL lock_timeout='1s'`;
  expect((await tx`select current_setting('transaction_read_only') as read_only,current_setting('statement_timeout') as statement_timeout,current_setting('lock_timeout') as lock_timeout`)[0]).toMatchObject({read_only:'on',statement_timeout:'10s',lock_timeout:'1s'});
  await fn(tx);
 });
}
afterAll(async()=>{if(process.env.COAST_AUDIT_REAL_DATA_CLONE==='1')await closeDb();});

run('ancestor episode aggregates preserve empty, missing, partial, complete and special-excluded child projections',async()=>{
 // Authored tableless correctness cases, never actual catalogue or performance evidence.
 const episodeRows=[1,2,3,4,5,6,7].map(n=>({media_id:id(n),show_id:id(n<=2?101:n<=6?102:103),season_id:id(n<=2?201:n<=6?202:203),is_special:n===6}));
 episodeRows.push({media_id:id(8),show_id:id(103),season_id:id(203),is_special:false});
 const states=[{user_id:userId,media_id:id(3),watched:true,play_count:3,last_watched_at:early},{user_id:userId,media_id:id(4),watched:false,play_count:1,last_watched_at:late},{user_id:otherUser,media_id:id(5),watched:true,play_count:9,last_watched_at:late},{user_id:userId,media_id:id(6),watched:true,play_count:10,last_watched_at:'2026-10-10T00:00:00Z'},{user_id:userId,media_id:id(7),watched:true,play_count:3,last_watched_at:early},{user_id:userId,media_id:id(8),watched:true,play_count:2,last_watched_at:late}];
 const cases=[{parent:100,total:0,completed:0,min:0,watched:false,date:null},{parent:101,total:2,completed:0,min:0,watched:false,date:null},{parent:102,total:3,completed:1,min:0,watched:false,date:late},{parent:103,total:2,completed:2,min:2,watched:true,date:late}];
 await readOnly(async tx=>{
  for(const kind of ['show','season'])for(const c of cases){
   const parentId=id(c.parent+(kind==='season'?100:0)),children=await execute(tx,compile(episodeQuery,{userId,parentId,kind}),tables(states,episodeRows));
   expect(children).toEqual({total:c.total,completed:c.completed,minimumPlayCount:c.min,lastWatchedAt:c.date?new Date(c.date):null});
   for(const rebuilding of [false,true])expect(episodeConsumer(children,existing,rebuilding,[],ObservationDate)).toEqual({totalEpisodes:c.total,completedEpisodes:c.completed,watched:c.watched,dropped:rebuilding,playCount:rebuilding?c.min:c.watched?8:7,lastWatchedAt:c.date?new Date(c.date):rebuilding?null:oldDate,updatedAt:new Date(clock)});
   if(c.watched)expect(episodeConsumer(children,{...existing,watched:true},false,[],ObservationDate).playCount).toBe(7);
  }
 });
});

run('ancestor collection aggregates preserve distinct child admission, missing projections and empty no-query fallback',async()=>{
 const states=[{user_id:userId,media_id:id(1),watched:true,play_count:3,last_watched_at:early},{user_id:userId,media_id:id(2),watched:true,play_count:2,last_watched_at:late},{user_id:userId,media_id:id(3),watched:false,play_count:0,last_watched_at:null},{user_id:otherUser,media_id:id(4),watched:true,play_count:9,last_watched_at:late}];
 const cases=[{ids:[1,1,2],total:2,completed:2,min:2,watched:true,date:late},{ids:[1,1,4],total:1,completed:1,min:3,watched:false,date:early},{ids:[1,3],total:2,completed:1,min:0,watched:false,date:early},{ids:[4],total:0,completed:0,min:0,watched:false,date:null}];
 await readOnly(async tx=>{
  for(const c of cases){
   const relationships=c.ids.map((n,i)=>({childId:id(n),kind:i===1?'franchise':'collection'})),children=await execute(tx,compile(collectionQuery,{userId,relationships}),tables(states));
   expect(children).toEqual({total:c.total,completed:c.completed,minimumPlayCount:c.min,lastWatchedAt:c.date?new Date(c.date):null});
   for(const rebuilding of [false,true])expect(collectionConsumer(children,existing,rebuilding,relationships,ObservationDate)).toEqual({watched:c.watched,dropped:rebuilding,playCount:rebuilding?c.min:c.watched?8:7,lastWatchedAt:c.date?new Date(c.date):rebuilding?null:oldDate,updatedAt:new Date(clock)});
  }
 });
 const fallbackBody=new Bun.Transpiler({loader:'ts'}).transformSync('async function query(){return '+collectionExpression+';}');
 const empty=await new Function('tx','trackingState','and','eq','inArray','sql','userId','relationships',fallbackBody+';return query();')({select:()=>{throw Error('An empty collection must not execute a child query.');}},trackingState,and,eq,inArray,sql,userId,[]);
 expect(empty).toEqual({total:0,completed:0,minimumPlayCount:0,lastWatchedAt:null});
 for(const rebuilding of [false,true])expect(collectionConsumer(empty,existing,rebuilding,[],ObservationDate)).toEqual({watched:false,dropped:rebuilding,playCount:rebuilding?0:7,lastWatchedAt:rebuilding?null:oldDate,updatedAt:new Date(clock)});
});
