import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {getSql,closeDb} from '../../../src/lib/server/db';
import {workCards} from '../../../src/lib/collection/query.server';
import {handleProfile} from '../../../src/lib/server/api/profile.server';
import type {ApiContext} from '../../../src/lib/server/api/context.server';
import {previewContext} from '../../../src/lib/social/taste-preview.server';

const user=process.env.COAST_TASTE_PREVIEW_USER;
assert(user,'Choose the private dev account.');
const sql=getSql();
await previewContext(user);
// This process alone instruments Bun's completed queries. Building a tagged SQL
// fragment does not resolve a query and contributes no count or query text.
const prototype=Object.getPrototypeOf(sql`select 1`);
const resolve=prototype.resolve;
let completed=0;
prototype.resolve=function(...args:unknown[]){completed++;return Reflect.apply(resolve,this,args);};
const generation=()=>sql`select medium,epoch from coast_taste_preview.profiles where user_id=${user} order by medium`;
async function read(ids:string[]){
  const url=new URL('http://localhost/profile/card-taste');
  url.searchParams.set('ids',ids.join(','));
  url.searchParams.set('candidate','true');
  const response=await handleProfile({uid:user,subjectId:user,path:['profile','card-taste'],method:'GET',url,request:new Request(url)} as ApiContext);
  assert.equal(response?.status,200);
  return response!.json() as Promise<{scores:Record<string,number>;pending?:string[]}>;
}
async function measure(fn:()=>Promise<unknown>){
  const before=completed;
  const value=await fn();
  return {statements:completed-before,value};
}
try{
  const calibration=await measure(async()=>{
    const fragment=sql`1+1`;
    await sql`select ${fragment}`;await sql.unsafe('select 5').values();
  });
  assert.equal(calibration.statements,2);
  const first=Array.from(await generation());
  assert.equal(first.length,2);
  const eligible=await sql<{id:string;known:boolean}[]>`with choices as (
    select m.id,exists(select from coast_taste_preview.known k where k.user_id=${user} and k.root=m.id) as known
    from media m where m.kind in ('movie','show') and cardinality(m.genres)>0),
    ranked as (select *,row_number() over(partition by known order by md5(id::text)) as n from choices)
    select id,known from ranked where n<=72 order by n`;
  for(const known of [true,false])for(const size of [24,72]){
    const ids=eligible.filter(row=>row.known===known).slice(0,size).map(row=>row.id);
    assert.equal(ids.length,size);
    const before=completed,initial=await read(ids),initialStatements=completed-before;
    const limit=Date.now()+150000;
    let pending=initial.pending?.length??0;
    while(pending && Date.now()<limit){await delay(500);pending=(await read(ids)).pending?.length??0;}
    assert.equal(pending,0,'The private worker must service the batch on this publication.');
    const runs=[];
    for(let i=0;i<3;i++){
      const card=await measure(()=>workCards(user,user,ids));
      const score=await measure(()=>read(ids));
      const both=await measure(()=>Promise.all([workCards(user,user,ids),read(ids)]));
      runs.push({cardData:card.statements,candidateHTTP:score.statements,combined:both.statements});
    }
    console.log(JSON.stringify({known,size,initialPending:initial.pending?.length??0,initialStatements,runs}));
  }
  assert.deepEqual(Array.from(await generation()),first,'The publication changed during measurement.');
}finally{prototype.resolve=resolve;await closeDb();}
