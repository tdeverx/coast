// Compare normal runtime matches to the immutable research publication; never train or write to the DB.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {closeDb,getSql} from '../../../src/lib/server/db';
import {requireFeature} from '../../../src/lib/server/features';
import {selectedItemMatches} from '../../../src/lib/social/taste-personal-match.server';

const [username,expectedInput,comparisonPath,output]=Bun.argv.slice(2),url=new URL(process.env.DATABASE_URL!);
assert(username&&output&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&process.env.COAST_TASTE_PREVIEW_DATABASE
  &&url.pathname.slice(1)===process.env.COAST_TASTE_PREVIEW_DATABASE);
const source=await Bun.file(expectedInput).json(),compare=await Bun.file(comparisonPath).json();
assert.equal(source.userId,compare.userId);
try{
  const [user]=await getSql()`select id from users where username=${username} and not disabled`;
  assert.equal(user.id,source.userId);
  const config=await requireFeature(user.id,'personalisation');
  const result=[];
  for(let start=0;start<source.rows.length;start+=72){
    const batch=source.rows.slice(start,start+72);
    const values=await selectedItemMatches(user.id,batch.map((r:{id:string})=>r.id),false,config);
    for(const r of batch){
      const match=values.get(r.id);
      assert(match&&!match.pending&&match.withheld===r.known);
      result.push({id:r.id,title:r.title,medium:r.medium,known:r.known,direct:r.ratingAt!==null,stars:r.stars,
        selected:compare.rows[r.id]?.score??null,referenceRule:compare.rows[r.id]?.rule??null,
        base:match.native,score:match.score,rule:match.rule});
    }
  }
  await writeFile(output,JSON.stringify(result),{mode:0o600,flag:'wx'});
  console.log('Read',result.length,'dynamic movie and show matches.');
}finally{await closeDb();}
