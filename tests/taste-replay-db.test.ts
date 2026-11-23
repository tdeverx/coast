import {expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {captureTaste,replayTaste} from '../scripts/taste-replay';
import {comparisonTitles,pairedPercentiles,singleTitleHoldouts} from '../scripts/taste-title-holdout';
import type {TasteReplayDataset} from '../scripts/taste-replay';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;

test('a single-title holdout removes child opinions and repeat evidence and uses the same unrelated comparison titles',async()=>{
 const ids=['a','b'],crew={directors:[{id:'tmdb:guest',name:'Guest'}]};
 const history:TasteReplayDataset['history']=ids.map(id=>({
  work:{id,medium:'show',kind:'show',rating:5,consumed:true,chosen:true,implicit:4,explicit:5,repeated:true,deliberateReturn:true},
  features:{genres:[{id:'comedy',name:'Comedy'}]},credits:[{rating:5,features:crew}],
 }));
 const data:TasteReplayDataset={medium:'show',asOf:Date.now(),history,chosenPools:{a:true,b:true},
  catalogue:[...ids,'peer'].map((id,i)=>({id,medium:'show',available:true,observed:i<2,poolSize:1,chosen:2,sampleOrder:i,features:history[0].features}))};
 expect(comparisonTitles(data).map(row=>row.id)).toEqual(['peer']);
 const folds=[];
 for await(const title of singleTitleHoldouts(data,'a'))folds.push(title);
 expect(folds).toHaveLength(1);
 expect(folds[0].full.works).toBe(2);
 expect(folds[0].full.dimensions.directors?.['tmdb:guest']).toBeDefined();
 expect(folds[0].blind.works).toBe(1);
 expect(folds[0].blind.dimensions.genres?.comedy).toBeUndefined();
 expect(folds[0].blind.dimensions.directors?.['tmdb:guest']).toBeUndefined();
 expect(pairedPercentiles(80,75,[90,80,40,null],[90,80,75,20])).toEqual({n:3,full:50,blind:100/6});
});

run('offline replay restores held-out opportunities, withholds future-known ratings and compares common baselines',async()=>{
 const db=getSql(),viewer=crypto.randomUUID(),titles=Array.from({length:12},()=>crypto.randomUUID());
 const username='replay-'+viewer;
 try{
  await db`insert into users(id,username) values(${viewer},${username})`;
  await db`insert into media(id,kind,title,release_date,genres)
   select id,'movie','Replay fixture',date '2010-01-01'+n::int,array['Drama'] from unnest(${db.array(titles,'UUID')}) with ordinality e(id,n)`;
  await db`insert into metadata_snapshots(media_id,provider,raw)
   select id,'tmdb',jsonb_build_object('facts',jsonb_build_object('audience',jsonb_build_object('score',7,'scale',10,'votes',n*20)))
   from unnest(${db.array(titles,'UUID')}) with ordinality e(id,n)`;
  await db`insert into tracking_events(user_id,media_id,action,source,occurred_at,occurred_at_known)
   select ${viewer},id,'watch','trakt',timestamptz '2020-01-01'+n*interval '10 days',true
   from unnest(${db.array(titles,'UUID')}) with ordinality e(id,n) where n<=10`;
  await db`insert into ratings(user_id,media_id,value,updated_at)
   select ${viewer},id,case when n%3=0 then 2 else 5 end,timestamptz '2022-01-01'
   from unnest(${db.array(titles,'UUID')}) with ordinality e(id,n) where n<=10`;
  await db`update ratings set source='trakt',updated_at=timestamptz '2019-01-01'
   where user_id=${viewer} and media_id=${titles[0]}`;
  const data=await captureTaste(username,'movie');
  expect(data.catalogue.filter(row=>row.observed)).toHaveLength(10);
  expect(data.catalogue.filter(row=>!row.observed)).toHaveLength(2);
  expect(data.history.every(row=>row.popularity!==undefined&&row.popularity>=20)).toBe(true);
  expect(data.history.find(row=>row.work.id===titles[0])?.ratingRecorded).toBeUndefined();
  expect(data.history.find(row=>row.work.id===titles[1])?.ratingRecorded).toBe(Date.UTC(2022,0,1));
  const report=await replayTaste(data);
  expect(report.results).toHaveLength(6);
  expect(report.methodology.chronologicalTrainingRatings).toBe(0);
  const work=report.results.find(result=>result.rated&&result.split==='work')!;
  expect(work.labels).toBe(10);
  expect(work.abstained+work.scored).toBe(work.labels);
  expect(work.confidenceBands.reduce((n,band)=>n+band.count,0)).toBe(work.scored);
  expect(work.popularityOrdering.pairs).toBe(work.tasteOnPopularityCoverage.pairs);
  expect(report.results.find(r=>r.split==='work'&&!r.rated)?.heldOutHash).toBe(work.heldOutHash);
 }finally{
  await db`delete from users where id=${viewer}`;
  await db`delete from media where id=any(${db.array(titles,'UUID')})`;
 }
});
