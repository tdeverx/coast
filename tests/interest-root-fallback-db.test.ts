import {afterAll,expect,test} from 'bun:test';
import {closeDb,getSql} from '../src/lib/server/db';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const source=await Bun.file(new URL('../src/lib/recommendations/interests.server.ts',import.meta.url)).text();
const rootExpression=source.match(/select (coalesce\([^)]*\)) as id,p.updated/)?.[1];
const lateral=source.match(/left join lateral\((select parent_id from media_relationships[\s\S]*?)\) r on true/)?.[1];
const recent=source.match(/\), recent as \(([\s\S]*?)\n \) select w.id/)?.[1];
if(!rootExpression||!lateral||!recent||recent.split('${userId}').length!==2)throw new Error('Interest root SQL changed; review its fallback/fold contract.');
afterAll(async()=>{if(process.env.COAST_AUDIT_REAL_DATA_CLONE==='1')await closeDb();});
run('interest roots retain show precedence, album tie order, own roots and personal/global weight folds',async()=>{
 // Tableless authored semantic controls, not actual catalogue/performance evidence.
 await getSql().begin(async tx=>{
  await tx`SET TRANSACTION READ ONLY`;await tx`SET LOCAL statement_timeout='10s'`;await tx`SET LOCAL lock_timeout='1s'`;
  const [settings]=await tx`select current_setting('transaction_read_only') as read_only,current_setting('statement_timeout') as statement_timeout,current_setting('lock_timeout') as lock_timeout`;
  expect(settings).toMatchObject({read_only:'on',statement_timeout:'10s',lock_timeout:'1s'});
  const roots=await tx.unsafe(`with works(id,kind) as(values('album-a','album'),('album-z','album'),('collection','collection')),
   media_relationships(parent_id,child_id,kind,position) as(values
    ('album-a','episode','contains',0),('album-a','season','contains',0),('album-a','both','contains',0),
    ('collection','track-tie','contains',0),('album-z','track-tie','contains',1),('album-a','track-tie','contains',1),
    ('album-z','track-position','contains',0),('album-a','track-position','contains',1),('collection','plain','contains',0)),
   inputs(id,episode_show,season_show) as(values('episode','episode-show',null),('season',null,'season-show'),('both','episode-show','season-show'),('track-tie',null,null),('track-position',null,null),('plain',null,null),('absent',null,null))
   select p.id,${rootExpression} as root from inputs p
   left join lateral(select p.episode_show as show_id)e on true left join lateral(select p.season_show as show_id)s on true
   left join lateral(${lateral})r on true order by p.id`);
  expect(Array.from(roots)).toEqual([
   {id:'absent',root:'absent'},{id:'both',root:'episode-show'},{id:'episode',root:'episode-show'},
   {id:'plain',root:'plain'},{id:'season',root:'season-show'},{id:'track-position',root:'album-z'},{id:'track-tie',root:'album-a'},
  ]);
  for(const global of [false,true]){
   const rows=await tx.unsafe(`with roots(id,updated,weight,consumed,positive) as(values
    ('mixed','2026-01-01T00:00:00Z'::timestamptz,5::float8,false,true),('mixed','2026-01-02T00:00:00Z'::timestamptz,-6::float8,true,false),
    ('positive','2026-01-01T00:00:00Z'::timestamptz,1::float8,false,false),('positive','2026-01-01T00:00:00Z'::timestamptz,4::float8,true,false)
   ), recent as(${recent.replace('${userId}','$1')}) select id,weight,consumed,positive from recent order by id`,[global?null:'00000000-0000-4000-8000-000000000001']);
   expect(Array.from(rows)).toEqual([{id:'mixed',weight:global?5:-6,consumed:true,positive:true},{id:'positive',weight:4,consumed:true,positive:false}]);
  }
 });
});
