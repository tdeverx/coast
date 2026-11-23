// Run only against the explicitly enabled local dev copy and its private publication.
import assert from 'node:assert/strict';
import {getSql,closeDb} from '../src/lib/server/db';
import {workCards} from '../src/lib/collection/query.server';
import {previewContext,previewMatches} from '../src/lib/social/taste-preview.server';
import {runTastePreviewWorker} from '../src/lib/social/taste-preview-worker.server';
import {titleTastes} from './benchmarks/incumbent-taste';

const viewer=process.env.COAST_TASTE_PREVIEW_USER;
if (!viewer) throw Error('Choose the local preview owner.');
const trials=Number(process.argv[2]??12);
if(!Number.isInteger(trials)||trials<4||trials>60) throw Error('Choose 4–60 measurements.');
const sql=getSql();
const round=(n:number)=>Number(n.toFixed(2));
function report(samples:number[]) {
  const sorted=[...samples].sort((a,b)=>a-b);
  return {medianMs:round(sorted[Math.floor((sorted.length-1)/2)]),p95Ms:round(sorted[Math.ceil(sorted.length*.95)-1])};
}
async function measure<T>(fn:()=>Promise<T>) {
  const start=performance.now();
  const value=await fn();
  return {value,elapsed:performance.now()-start};
}
try {
  await previewContext(viewer);
  const [sizes]=await sql`select sum(pg_column_size(model))::int as "modelBytes",sum(pg_column_size(observations))::int as "historyBytes",
    sum(pg_column_size(catalogue))::int as "catalogueCountBytes" from coast_taste_preview.profiles where user_id=${viewer}`;
  console.log(JSON.stringify({trials,sizes}));
  const eligible=await sql<{id:string;known:boolean}[]>`with hits as (
    select m.id,exists(select 1 from coast_taste_preview.known k where k.user_id=${viewer} and k.root=m.id) as known
    from media m where m.kind in ('movie','show') and cardinality(m.genres)>0),
    ordered as(select *,row_number() over(partition by known order by md5(id::text)) as n from hits) select id,known from ordered where n<=72 order by n`;
  for(const known of [true,false]) {
    const pool=eligible.filter(item=>item.known===known).map(item=>item.id);
    assert.equal(pool.length,72);
    for(const size of [24,72]) {
      const ids=pool.slice(0,size);
      const first=await measure(()=>previewMatches(viewer,ids));
      let pending=[...first.value.values()].filter(item=>item.pending).length;
      const requests=pending;
      const workerStart=performance.now();
      for(let turn=0; pending && turn<12;turn++) {
        await runTastePreviewWorker(viewer);
        pending=[...(await previewMatches(viewer,ids)).values()].filter(item=>item.pending).length;
      }
      assert.equal(pending,0);
      const queueMs=performance.now()-workerStart;
      const arms=[
        {name:'cards',run:()=>workCards(viewer,viewer,ids)},
        {name:'incumbentWithCards',run:()=>Promise.all([workCards(viewer,viewer,ids),titleTastes(viewer,ids)])},
        {name:'candidateWithCards',run:()=>Promise.all([workCards(viewer,viewer,ids),previewMatches(viewer,ids)])},
        {name:'candidateOnly',run:()=>previewMatches(viewer,ids)},
      ];
      const values=arms.map(()=>[] as number[]);
      for(let i=0;i<trials+1;i++) for(let j=0;j<arms.length;j++) {
        const index=(i%2===0?j:arms.length-1-j);
        const {elapsed}=await measure(async()=>await arms[index].run());
        if(i) values[index].push(elapsed);
      }
      const fresh=await previewMatches(viewer,ids,true);
      const displays=await previewMatches(viewer,ids);
      assert.equal(fresh.size,ids.length);
      for(const id of ids) assert.equal(fresh.get(id)?.match?.score,displays.get(id)?.match?.score);
      console.log(JSON.stringify({known,size,coldRequestMs:round(first.elapsed),requestedRefits:requests,servicingRefitsMs:round(queueMs),
        scorable:[...displays.values()].filter(row=>row.match?.score!=null).length,arms:Object.fromEntries(arms.map((arm,i)=>[arm.name,report(values[i])])),rssMiB:round(process.memoryUsage().rss/1048576)}));
    }
  }
} finally { await closeDb(); }
