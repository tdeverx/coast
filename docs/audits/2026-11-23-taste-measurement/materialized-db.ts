// bun materialized-db.ts, with TEST_DATABASE_URL pointing to a local PostgreSQL dev account.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {ingestMetadata} from '../../../src/lib/catalogue/service.server';
import {track} from '../../../src/lib/core/tracking/service.server';
import {getSql,closeDb} from '../../../src/lib/server/db';
import {cardTastePublication,refreshTasteCaches} from '../../../src/lib/social/taste-cache.server';
import {handleProfile} from '../../../src/lib/server/api/profile.server';
import type {ApiContext} from '../../../src/lib/server/api/context.server';
import type {Metadata} from '../../../src/lib/providers/contracts';

const target=new URL(process.env.TEST_DATABASE_URL??'');
if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname))throw new Error('Use a local disposable database administrator.');
const admin=new Bun.SQL(target.toString(),{max:1,connectionTimeout:5});
const name='coast_taste_audit_'+crypto.randomUUID().replaceAll('-','');
const folder=await mkdtemp(join(tmpdir(),'coast-taste-materialized-'));
let created=false;
try{
  await admin.unsafe('CREATE DATABASE '+name);
  created=true;
  target.pathname='/'+name;
  process.env.DATABASE_URL=target.toString();
  process.env.COAST_DATA_DIR=folder;
  const migration=await Bun.spawn([process.execPath,'scripts/migrate.ts'],{env:process.env,stdout:'inherit',stderr:'inherit'}).exited;
  assert.equal(migration,0);
  const db=getSql(),owner=crypto.randomUUID();
  await db`insert into users(id,username) values(${owner},'research-fixture')`;
  await db`insert into system_settings(key,value) values('coast','{"experimentalCardTasteScores":true}') on conflict(key) do update set value=excluded.value`;
  const ref=(index:number):Metadata=>({kind:'movie',provider:'tmdb',externalId:String(90001+index),title:'Fixture '+index,
    genres:['Drama'],tasteFeatures:{tags:[{id:'tmdb:space',name:'Space exploration'}],cast:[{id:'tmdb:actor',name:'Shared performer'}]}});
  const movies=await Promise.all(Array.from({length:5},(_,i)=>ingestMetadata(ref(i),{complete:true})));
  for(const {id} of movies.slice(0,3))await track(owner,{mediaId:id,action:'favourite',value:true});
  await refreshTasteCaches();
  const candidate=movies[3].id,control=movies[4].id;
  const warmCount=async()=>Number((await db`select count(*) from user_taste_scores where user_id=${owner} and work_id in (${candidate},${control})`)[0].count);
  async function read(){
    async function json(path:string,params:Record<string,string>){
      const url=new URL('/api/v1/profile/'+path+'?'+new URLSearchParams(params),'http://coast.test');
      const res=await handleProfile({uid:owner,subjectId:owner,url,request:new Request(url),method:'GET',path:['profile',path]} as ApiContext);
      assert.equal(res?.status,200);
      return res!.json();
    }
    const cards=await json('card-taste',{ids:candidate+','+control});
    const detail=await json('taste-match',{workId:candidate,breakdown:'true'});
    return {card:cards.scores[candidate]??null,detail:detail.match?.score??null,control:cards.scores[control]??null,warm:await warmCount()};
  }
  const original=await read(),publication=await cardTastePublication(owner);
  assert.equal(original.warm,2);
  assert.ok(original.card>50&&original.card===original.detail);
  await ingestMetadata({...ref(3),genres:['Unrelated genre'],tasteFeatures:{}},{mediaId:candidate,complete:true});
  const updated=await read();
  assert.deepEqual(await cardTastePublication(owner),publication);
  assert.equal(updated.warm,2);
  assert.equal(updated.card,original.card);
  assert.notEqual(updated.card,updated.detail);
  // Isolate what evicting one changed title would fix, preserving the user's published reference.
  await db`delete from user_taste_scores where work_id=${candidate}`;
  const evicted=await read();
  assert.equal(evicted.warm,1);
  assert.equal(evicted.card,updated.detail);
  assert.equal(evicted.control,original.control);
  console.log(JSON.stringify({original,updated,evicted,publicationChanged:false}));
}finally{
  try{await closeDb();if(created)await admin.unsafe('DROP DATABASE '+name+' WITH (FORCE)');}
  finally{await admin.close();await rm(folder,{recursive:true,force:true});}
}
