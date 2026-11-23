// Capture the same first-page data returned to personal For You shelves.
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {closeDb,getSql} from '../../../src/lib/server/db';
import {dynamicFeed} from '../../../src/lib/recommendations/feed.server';
import {recommendationRows} from '../../../src/lib/recommendations/query.server';
import {recentLibraryData} from '../../../src/lib/server/queries/recent-library';

const [username,output]=Bun.argv.slice(2);
const url=new URL(process.env.DATABASE_URL!);
assert(url.hostname==='127.0.0.1' && url.pathname==='/taste_card_benchmark' && output);
const seeds=['dispersion-1','dispersion-2','dispersion-3'];
const shelves=[];
const visits=[];
const ids=(items:readonly {id:string;workId?:string|null}[])=>items.map(row=>row.workId??row.id);
try {
  const sql=getSql();
  const [viewer]=await sql`select id from users where username=${username} and not disabled`;
  assert(viewer);
  const catalogue=await sql<{id:string;release:'released'|'unknown'|'future'}[]>`
    select id,case when release_date is null then 'unknown' when release_date<=current_date then 'released'
    else 'future' end as release from media where kind in ('movie','show')`;
  const recent=await recentLibraryData(viewer.id,{kind:'all',action:'watch',page:1,preview:true});
  shelves.push({seed:null,surface:'recent',ids:ids(recent.items)});
  for(const seed of seeds) {
    const source=new URL('http://localhost/experiments/feed');
    source.search=new URLSearchParams({category:'screen',seed}).toString();
    const {rows}=await dynamicFeed(viewer.id,source);
    const sampled=rows.filter(r=>['recommendations','seed','genre'].includes(r.surface)).slice(0,10);
    visits.push({seed,totalDefinitions:rows.length,sampledKeys:sampled.map(row=>row.key)});
    for(const row of sampled) {
      if(row.surface!=='recommendations' && row.surface!=='seed' && row.surface!=='genre') throw Error('Unexpected surface');
      const feature=row.surface==='recommendations'?'recommendations':'row';
      const params=new URLSearchParams({category:'screen',seed,page:'1',available:String('available' in row && row.available===true)});
      if(row.surface==='seed')params.set('work',row.workId);
      if(row.surface==='genre'){params.set('genre',row.genre);params.set('reason',row.reason);}
      if('kind' in row && row.kind)params.set('kind',row.kind);
      const target=new URL('http://localhost/experiments/'+feature);
      target.search=params.toString();
      const page=await recommendationRows(viewer.id,feature,target);
      shelves.push({seed,surface:row.surface,key:row.key,title:page.title,ids:ids(page.items)});
    }
  }
  const file=await open(output,'wx',0o600);
  try {await file.writeFile(JSON.stringify({visits,shelves,catalogue}));} finally {await file.close();}
  console.log(seeds.length,'visits;',shelves.length,'shelves;',new Set(shelves.flatMap(row=>row.ids)).size,'unique card IDs');
} finally {await closeDb();}
