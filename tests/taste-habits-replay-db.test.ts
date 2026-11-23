import {expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {captureTaste} from '../scripts/taste-replay';
import {replayShowHabits} from '../scripts/taste-habits-replay';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
run('show habit replay keeps the same labels and withholds undated opinions and later returns',async()=>{
  const db=getSql(),viewer=crypto.randomUUID(),name='habits-replay-'+viewer;
  const shows=Array.from({length:8},()=>crypto.randomUUID());
  const episodes=shows.map(()=>crypto.randomUUID());
  try{
    await db`insert into users(id,username) values(${viewer},${name})`;
    await db`insert into media(id,kind,title,release_date,genres) select id,'show','Replay series','2010-01-01',array['Drama'] from unnest(${db.array(shows,'UUID')}) id`;
    await db`insert into shows(media_id) select id from unnest(${db.array(shows,'UUID')}) id`;
    await db`insert into media(id,kind,title,release_date) select id,'episode','Episode','2010-01-01' from unnest(${db.array(episodes,'UUID')}) id`;
    await db`insert into episodes(media_id,show_id,season_number,episode_number) select e.id,s.id,1,1 from unnest(${db.array(episodes,'UUID')}) with ordinality e(id,n) join unnest(${db.array(shows,'UUID')}) with ordinality s(id,n) using(n)`;
    await db`insert into ratings(user_id,media_id,value,source) select ${viewer},id,case when n%2=0 then 5 else 2 end,'trakt' from unnest(${db.array(shows,'UUID')}) with ordinality e(id,n)`;
    await db`insert into tracking_events(user_id,media_id,action,source,occurred_at,occurred_at_known)
      select ${viewer},id,'watch','trakt',timestamptz '2020-01-01'+n*interval '30 days',true from unnest(${db.array(episodes,'UUID')}) with ordinality e(id,n)`;
    await db`insert into tracking_events(user_id,media_id,action,source,occurred_at,occurred_at_known,rewatch)
      values(${viewer},${episodes[0]},'watch','trakt','2022-01-01',true,true)`;
    const report=await replayShowHabits(await captureTaste(name,'show'),name);
    expect(report.datedRatings).toBe(0);
    expect(report.trainingTitlesBeforeCut).toBe(5);
    expect(report.temporalCoverage.returns.observed).toBe(0);
    for(const split of ['work','future']){
      const arms=report.results.filter(r=>r.split===split);
      expect(new Set(arms.map(r=>r.hash)).size).toBe(1);
      const control=arms.find(r=>r.arm==='full')!.pairedStandalone;
      expect(control.delta).toBe(control.pairs?0:null);
    }
  }finally{
    await db`delete from users where id=${viewer}`;
    await db`delete from media where id=any(${db.array([...episodes,...shows],'UUID')})`;
  }
});
