import {expect,test} from 'bun:test';
import {setTimeout as delay} from 'node:timers/promises';
import {getSql} from '../src/lib/server/db';
import {prepareTastePreview,runTastePreviewWorker} from '../src/lib/social/taste-preview-worker.server';
import {previewMatches} from '../src/lib/social/taste-preview.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;

run('an interrupted two-medium publication rolls back and the next worker publishes a complete epoch',async()=>{
  const sql=getSql(), [{name}]=await sql`select current_database() as name`;
  expect(name).toMatch(/^coast_settings_test_[a-f0-9]{32}$/);
  const user=crypto.randomUUID(), root=crypto.randomUUID();
  process.env.COAST_TASTE_PREVIEW_DATABASE=name;
  process.env.COAST_TASTE_PREVIEW_USER=user;
  await sql`insert into users(id,username) values(${user},'interrupted-publication')`;
  await sql`insert into system_settings(key,value) values('coast','{"developerMode":true,"experimentalCardTasteScores":true}')
    on conflict(key) do update set value=excluded.value`;
  await sql`insert into media(id,kind,title,genres) values(${root},'movie','Known title',array['Comedy'])`;
  await sql`insert into ratings(user_id,media_id,value) values(${user},${root},5)`;
  await prepareTastePreview(user);
  expect((await runTastePreviewWorker(user)).published).toBe(true);
  await previewMatches(user,[root]);
  expect((await runTastePreviewWorker(user)).completed).toBe(1);
  const snapshot=async()=>{
    const profiles=await sql<{medium:string;epoch:string}[]>`select medium,epoch from coast_taste_preview.profiles where user_id=${user} order by medium`;
    const [known]=await sql`select count(*)::int as n from coast_taste_preview.known where user_id=${user}`;
    const [cached]=await sql`select count(*)::int as n from coast_taste_preview.targets where user_id=${user} and result is not null`;
    return {profiles:Array.from(profiles),known:known.n,cached:cached.n};
  };
  const original=await snapshot();
  expect(original.profiles.map(row=>row.medium)).toEqual(['movie','show']);
  expect(original.cached).toBe(1);
  const lease=await sql.reserve();
  let child:ReturnType<typeof Bun.spawn>|undefined;
  try{
    await lease`select pg_advisory_lock(810328,92147)`;
    // The movie upsert has already executed when the show upsert reaches this trigger.
    await sql.unsafe(`create function coast_taste_preview.pause_show_publication() returns trigger
      language plpgsql as $$begin if new.medium='show' then perform pg_advisory_xact_lock(810328,92147); end if; return new; end$$`);
    await sql.unsafe(`create trigger pause_show before insert or update on coast_taste_preview.profiles
      for each row execute function coast_taste_preview.pause_show_publication()`);
    child=Bun.spawn([process.execPath,'scripts/taste-preview-worker.ts','--rebuild'],{env:{...process.env,COAST_TASTE_PREVIEW_USER:user,COAST_TASTE_PREVIEW_DATABASE:name},stdout:'ignore',stderr:'inherit'});
    const deadline=Date.now()+10000;
    let blocked=false;
    while(Date.now()<deadline && !blocked){
      [{blocked}]=await sql`select exists(select from pg_locks where locktype='advisory' and classid=810328 and objid=92147
        and database=(select oid from pg_database where datname=current_database()) and not granted) as blocked`;
      if(!blocked) await delay(20);
    }
    expect(blocked).toBe(true);
    expect(await snapshot()).toEqual(original);
    child.kill('SIGKILL');
    expect(await child.exited).not.toBe(0);
  }finally{
    if(child?.exitCode===null){child.kill(); await child.exited;}
    try{await lease`select pg_advisory_unlock(810328,92147)`;}
    finally{lease.release();}
    await sql`drop trigger if exists pause_show on coast_taste_preview.profiles`;
    await sql`drop function if exists coast_taste_preview.pause_show_publication()`;
  }
  expect(await snapshot()).toEqual(original);
  expect((await runTastePreviewWorker(user,true)).published).toBe(true);
  const recovered=await snapshot();
  expect(recovered.profiles.map(row=>row.medium)).toEqual(['movie','show']);
  expect(recovered.profiles[0].epoch).not.toBe(original.profiles[0].epoch);
  expect(recovered.profiles[1].epoch).toBe(recovered.profiles[0].epoch);
  expect(recovered.known).toBe(original.known);
  expect(recovered.cached).toBe(0);
});
