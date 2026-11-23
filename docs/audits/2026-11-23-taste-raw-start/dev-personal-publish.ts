// Run the production publication and query it a second time warm on an explicitly named dev database copy.
import assert from 'node:assert/strict';
import {sql} from 'drizzle-orm';
import {closeDb,getDb,getSql} from '../../../src/lib/server/db';
import {requireFeature} from '../../../src/lib/server/features';
import {personalMatchRevision} from '../../../src/lib/social/taste-cache.server';
import {buildPersonalMatches,savePersonalMatches} from '../../../src/lib/social/taste-personal-publish.server';
import {selectedItemMatches} from '../../../src/lib/social/taste-personal-match.server';

const [username]=Bun.argv.slice(2);
const url=new URL(process.env.DATABASE_URL!);
assert(username&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&process.env.COAST_TASTE_PREVIEW_DATABASE
  &&url.pathname.slice(1)===process.env.COAST_TASTE_PREVIEW_DATABASE,'Expected a named loopback dev database.');
try{
  const [user]=await getSql()`select id,coalesce(settings->>'region','GB') as region from users where username=${username} and not disabled`;
  const config=await requireFeature(user.id,'personalisation');
  const revision=sql`select ${personalMatchRevision} as revision from users u where u.id=${user.id}::uuid and not u.disabled`;
  const [start]=await getDb().execute<{revision:string}>(revision);
  const t=performance.now();
  const result=await buildPersonalMatches(user.id,config,user.region);
  const fitMs=Math.round(performance.now()-t);
  await getDb().transaction(async tx=>{
    const [unchanged]=await tx.execute<{revision:string}>(sql`${revision} for update of u`);
    assert.equal(start.revision,unchanged?.revision,'The source changed during this publication.');
    await savePersonalMatches(tx,user.id,start.revision,result);
  });
  console.log('Published',result.models.length,'models and',result.members.length,'members in',fitMs,'ms of preparation.');
  for(const medium of new Set(result.models.map(m=>m.medium))){
    const rows=await getSql()`(select w.id,false as known from works w where w.kind=${medium==='music'?'album':medium}
       and not exists(select 1 from user_taste_match_members m where m.root=w.id and m.user_id=${user.id}) order by w.id limit 12)
      union all (select m.root as id,true as known from user_taste_match_members m where m.user_id=${user.id} and m.medium=${medium} order by m.root limit 12)`;
    for(const warm of [false,true]){
      const a=performance.now();const scored=await selectedItemMatches(user.id,rows.map(r=>r.id),true,config);
      for(const r of rows){const item=scored.get(r.id);assert(item&&!item.pending&&item.withheld===r.known);}
      console.log(medium,warm?'warm':'cold',scored.size,'returned,',[...scored.values()].filter(m=>m.score!==null).length,
        'scored,',Math.round(performance.now()-a),'ms');
    }
  }
}finally{await closeDb();}
