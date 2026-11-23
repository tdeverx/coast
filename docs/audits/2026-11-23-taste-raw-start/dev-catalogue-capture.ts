// Capture only locally stored facts for a developer's private selected-rules publication.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {closeDb,getSql} from '../../../src/lib/server/db';
import {previewContext} from '../../../src/lib/social/taste-preview.server';
import {visitTasteObservations} from '../../../src/lib/social/taste-history.server';
import {workTasteFeatures} from '../../../src/lib/social/work-features.server';
import type {TasteV2Features,TasteV2Medium,TasteV2Observation} from '../../../src/lib/social/taste-v2';

const [username, output] = Bun.argv.slice(2);
const db=new URL(process.env.DATABASE_URL!);
assert(username && output && ['127.0.0.1','localhost','[::1]'].includes(db.hostname)
  && process.env.COAST_TASTE_PREVIEW_DATABASE && db.pathname.slice(1)===process.env.COAST_TASTE_PREVIEW_DATABASE,
  'Supply the account, a new private output path and the named loopback dev database.');
const sql=getSql();
try {
  const [user]=await sql`select id from users where username=${username} and not disabled`;
  assert(user);
  process.env.COAST_TASTE_PREVIEW_USER=user.id;
  const {revision,config,region}=await previewContext(user.id);
  const history:TasteV2Observation[]=[];
  await visitTasteObservations(user.id,['screen'],config.metadataSource,region,({work,features,credits})=>{
    if(work.medium==='movie'||work.medium==='show') history.push({work,features,credits});
  },true,true);
  const personal=await sql<{id:string;stars:number}[]>`select r.media_id as id,r.value::float as stars
    from ratings r join media m on m.id=r.media_id where r.user_id=${user.id} and m.kind in ('movie','show')`;
  const catalogue=await sql<{id:string;medium:TasteV2Medium;title:string;overview:string|null;
    facts:Record<string,unknown>|null;collections:string[]|null}[]>`
    select m.id,m.kind as medium,m.title,coalesce(nullif(btrim(o.overview),''),nullif(btrim(tm.overview),''),
      nullif(btrim(m.overview),''),nullif(btrim(tr.overview),''),nullif(btrim(j.overview),'')) as overview,
      jsonb_build_object('credits',tm.raw#>'{facts,credits}','networks',tm.raw#>'{facts,networks}',
        'studios',tm.raw#>'{facts,studios}','audience',tm.raw#>'{facts,audience}') as facts,
      (select array_agg(distinct r.parent_id::text order by r.parent_id::text) from media_relationships r
        where r.child_id=m.id and r.kind in ('collection','franchise')) as collections
    from media m left join metadata_overrides o on o.media_id=m.id
    left join lateral(select overview,raw from metadata_snapshots where media_id=m.id and provider='tmdb'
      order by (language='en') desc,updated_at desc,id limit 1) tm on true
    left join lateral(select overview from metadata_snapshots where media_id=m.id and provider='trakt'
      order by (language='en') desc,updated_at desc,id limit 1) tr on true
    left join lateral(select overview from metadata_snapshots where media_id=m.id and provider='jellyfin'
      order by (language='en') desc,updated_at desc,id limit 1) j on true
    where m.kind in ('movie','show') order by m.id`;
  const rows: (typeof catalogue[number] & {features:TasteV2Features})[]=[];
  for(let start=0;start<catalogue.length;start+=300){
    const batch=catalogue.slice(start,start+300);
    const features=await workTasteFeatures(batch.map(r=>r.id),config.metadataSource,undefined,region,undefined,true);
    for(const row of batch) rows.push({...row,features:features.get(row.id)??{}});
  }
  assert.equal((await previewContext(user.id)).revision,revision,'The copy changed during capture.');
  await writeFile(output,JSON.stringify({userId:user.id,revision,asOf:Date.now(),history,personal,rows}),{mode:0o600,flag:'wx'});
  console.log('Captured',rows.length,'screen roots,',history.length,'observed roots and',personal.length,'direct ratings.');
}finally{await closeDb();}
