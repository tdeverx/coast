import {afterAll,expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {previewMatches,previewProfile} from '../src/lib/social/taste-preview.server';
import {prepareTastePreview,runTastePreviewWorker} from '../src/lib/social/taste-preview-worker.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const original={user:process.env.COAST_TASTE_PREVIEW_USER,database:process.env.COAST_TASTE_PREVIEW_DATABASE};
afterAll(()=>{
  for(const [key,value] of [['COAST_TASTE_PREVIEW_USER',original.user],['COAST_TASTE_PREVIEW_DATABASE',original.database]] as const) {
    if(value===undefined) delete process.env[key]; else process.env[key]=value;
  }
});
run('private publication, exact known-title refit, target metadata invalidation, isolation and owner access',async()=>{
  const sql=getSql(), viewer=crypto.randomUUID(), other=crypto.randomUUID();
  process.env.COAST_TASTE_PREVIEW_USER=viewer;
  process.env.COAST_TASTE_PREVIEW_DATABASE=new URL(process.env.DATABASE_URL!).pathname.slice(1);
  await sql`insert into users(id,username) values(${viewer},'preview-viewer'),(${other},'preview-other')`;
  await sql`insert into system_settings(key,value) values('coast','{"developerMode":true,"experimentalCardTasteScores":true}') on conflict(key) do update set value=excluded.value`;
  const roots=Array.from({length:6},()=>crypto.randomUUID());
  for(const id of roots) await sql`insert into media(id,kind,title,genres,release_date)
    values(${id},'movie','Preview fixture',array['Comedy'],'2010-01-01')`;
  await sql`insert into ratings(user_id,media_id,value) select ${viewer},unnest(${sql.array(roots.slice(0,4),'UUID')}::uuid[]),5`;
  await prepareTastePreview(viewer);
  expect((await runTastePreviewWorker(viewer)).published).toBe(true);
  const first=await previewMatches(viewer,[roots[0],roots[4]]);
  expect(first.get(roots[0])?.pending).toBe(true);
  expect(first.get(roots[4])?.match?.score).toBeGreaterThan(50);
  expect((await runTastePreviewWorker(viewer)).completed).toBe(1);
  const known=(await previewMatches(viewer,[roots[0]],true)).get(roots[0]);
  expect(known?.pending).toBe(false);
  expect(known?.match?.signals.flatMap(s=>s.supporting)).not.toContain(roots[0]);
  expect((await previewProfile(viewer,'movie','genres',1))?.works).toBe(4);
  await expect(previewMatches(other,[roots[0]])).rejects.toThrow();
  await sql`update ratings set value=1 where user_id=${viewer} and media_id=${roots[0]}`;
  await runTastePreviewWorker(viewer);
  await previewMatches(viewer,[roots[0]]);
  await runTastePreviewWorker(viewer);
  expect((await previewMatches(viewer,[roots[0]],true)).get(roots[0])?.match)
    .toEqual(known?.match);
  await sql`insert into metadata_overrides(media_id,genres) values(${roots[4]},array['Previously unseen genre'])`;
  await runTastePreviewWorker(viewer);
  expect((await previewMatches(viewer,[roots[4]])).get(roots[4])?.match?.score).toBeNull();
  const [live]=await sql`select count(*)::int as count from user_taste_profiles where user_id=${viewer}`;
  expect(live.count).toBe(0);
});
