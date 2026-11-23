import {expect,test} from 'bun:test';
import {sql as query} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import {getFeatureConfig} from '../src/lib/server/features';
import {personalMatchRevision} from '../src/lib/social/taste-cache.server';
import {selectedItemMatches} from '../src/lib/social/taste-personal-match.server';
import {buildPersonalMatches,savePersonalMatches} from '../src/lib/social/taste-personal-publish.server';
import {matchMetadata,packDonor,readDonor} from '../src/lib/social/taste-personal-evidence.server';
import {selectedWork} from '../src/lib/social/taste-selected-rules';
import {tasteSynopsisModel} from '../src/lib/social/taste-synopsis.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
run('background references serve unseen metadata, hold out related titles and stay scoped to an owner',async()=>{
  const sql=getSql(),owner=crypto.randomUUID(),other=crypto.randomUUID();
  await sql`insert into users(id,username) values(${owner},'model-owner'),(${other},'model-other')`;
  const ids=Array.from({length:15},()=>crypto.randomUUID()),box=crypto.randomUUID();
  await sql`insert into media(id,kind,title) values(${box},'collection','Movie series')`;
  for(const id of ids)await sql`insert into media(id,kind,title,genres) values(${id},'movie','Film',array['Comedy'])`;
  await sql`insert into media_relationships(parent_id,child_id,kind) values
    (${box},${ids[0]},'collection'),(${box},${ids[1]},'collection')`;
  await sql`insert into ratings(user_id,media_id,value)
    select ${owner},unnest(${sql.array(ids.slice(0,12),'UUID')}::uuid[]),5`;
  const config=await getFeatureConfig(owner,sql);
  async function publish(){
    const programs=await buildPersonalMatches(owner,config,'GB');
    const [v]=await getDb().execute<{revision:string}>(query`select ${personalMatchRevision} as revision from users u where u.id=${owner}::uuid`);
    await getDb().transaction(tx=>savePersonalMatches(tx,owner,v.revision,programs));
  }
  await publish();
  const requested=[ids[0],ids[12]],initial=await selectedItemMatches(owner,requested,true);
  expect(initial.get(ids[0])).toMatchObject({pending:false,withheld:true});
  expect(initial.get(ids[12])?.score).toBeGreaterThan(50);
  expect(initial.get(ids[12])?.withheld).toBe(false);
  const members=await sql`select fold from user_taste_match_members where user_id=${owner}
    and root=any(${sql.array(ids.slice(0,2),'UUID')}::uuid[])`;
  expect(members.length).toBe(2);
  expect(members[0].fold).toBe(members[1].fold);
  // Unrelated peers remain usable even when the hash assigns them the same holdout fold.
  const [sameFold]=await sql`select p.root,q.root as peer,m.evidence->'residuals' ? q.root::text as independent
    from user_taste_match_members p join user_taste_match_members q using(user_id,medium,fold)
    join user_taste_match_models m using(user_id,medium,fold)
    where p.user_id=${owner} and p.root<>q.root and p.root=any(${sql.array(ids.slice(2,12),'UUID')}::uuid[])
      and q.root=any(${sql.array(ids.slice(2,12),'UUID')}::uuid[]) limit 1`;
  expect(sameFold?.independent).toBe(true);
  expect((await selectedItemMatches(other,requested)).get(ids[12])?.score).toBeNull();
  // A newly edited root and its relative cannot supply evidence for their own fold.
  await sql`update ratings set value=1 where user_id=${owner} and media_id=any(${sql.array(ids.slice(0,2),'UUID')}::uuid[])`;
  await publish();
  expect((await selectedItemMatches(owner,requested,true)).get(ids[0])?.score).toBe(initial.get(ids[0])?.score);
  // Runtime scoring reads current candidate metadata without waiting for a new publication.
  await sql`insert into metadata_overrides(media_id,genres) values(${ids[12]},array['No shared genre'])`;
  expect((await selectedItemMatches(owner,requested)).get(ids[12])?.score).toBeNull();
  await sql`update users set disabled=true where id=${owner}`;
  await expect(selectedItemMatches(owner,requested)).rejects.toThrow();
});

run('a changed synopsis or a different encoder immediately withdraws its optional vector',async()=>{
  const sql=getSql(),id=crypto.randomUUID();
  await sql`insert into media(id,kind,title,overview) values(${id},'movie','A vector fixture','  First description  ')`;
  await sql`insert into work_taste_synopses(work_id,model,synopsis_sha256,embedding)
    values(${id},${tasteSynopsisModel},encode(sha256(convert_to('First description','UTF8')),'hex'),
      array_append(array_fill(0::real,array[383]),1::real))`;
  const metadata=(await matchMetadata([id])).get(id)!;
  expect(metadata.synopsis?.length).toBe(384);
  // The driver's typed numeric vector must survive publication and JSONB serialization.
  const donor={...selectedWork(id,id,'movie',{},metadata),stars:4,native:70,publicNative:70};
  expect(readDonor(JSON.parse(JSON.stringify(packDonor(donor)))).synopsis).toEqual(Array.from(metadata.synopsis!));
  await sql`insert into metadata_overrides(media_id,overview) values(${id},'A completely different synopsis')`;
  expect((await matchMetadata([id])).get(id)?.synopsis).toBeFalsy();
  await sql`delete from metadata_overrides where media_id=${id}`;
  await sql`update work_taste_synopses set model='different-encoder' where work_id=${id}`;
  expect((await matchMetadata([id])).get(id)?.synopsis).toBeFalsy();
});

run('stored independent story, credit and synopsis evidence changes an unseen card and withdraws on a synopsis edit',async()=>{
  const db=getSql(),owner=crypto.randomUUID(),target=crypto.randomUUID();
  await db`insert into users(id,username) values(${owner},'story-witness')`;
  const ids=[target,...Array.from({length:13},()=>crypto.randomUUID())];
  for(const [i,id] of ids.entries()){
    const overview='Synopsis '+i;
    await db`insert into media(id,kind,title,genres,overview) values(${id},'movie',${overview},array['Drama'],${overview})`;
    // Three unrelated disliked films share a keyword, actor and story respectively. Favourites share the genre.
    const facts={credits:[{id:String(100+i),name:'Director '+i,role:'Director'}]};
    await db`insert into metadata_snapshots(media_id,provider,raw) values(${id},'tmdb',${{facts}}::jsonb)`;
    const features={...(i===0||i===1?{tags:[{id:'tmdb:15',name:'Shared premise'}]}:{}),
      ...(i===0||i===2?{cast:[{id:'tmdb:61',name:'Shared performer'}]}:{})};
    await db`insert into work_features(work_id,provider,features) values(${id},'tmdb',${features}::jsonb)`;
    if(i)await db`insert into ratings(user_id,media_id,value) values(${owner},${id},${i<=3?2.5:5})`;
    const cos=i===0?1:i===3?.90:i<=2?.1:.35;
    await db`insert into work_taste_synopses(work_id,model,synopsis_sha256,embedding) values
      (${id},${tasteSynopsisModel},encode(sha256(convert_to(${overview}::text,'UTF8')),'hex'),
      array[${cos}::real,${Math.sqrt(1-cos*cos)}::real]||array_fill(0::real,array[382]))`;
  }
  const config=await getFeatureConfig(owner,db),program=await buildPersonalMatches(owner,config,'GB');
  const [v]=await getDb().execute<{revision:string}>(query`select ${personalMatchRevision} as revision from users u where u.id=${owner}::uuid`);
  await getDb().transaction(tx=>savePersonalMatches(tx,owner,v.revision,program));
  const result=(await selectedItemMatches(owner,[target])).get(target)!;
  expect(result.rule).toBe('story-credit');
  expect(result.score!).toBeLessThan(result.native!);
  await db`insert into metadata_overrides(media_id,overview) values(${target},'A completely different story')`;
  const edited=(await selectedItemMatches(owner,[target])).get(target)!;
  expect(edited.rule).toBe('personal');
  expect(edited.score).toBe(result.native);
});
