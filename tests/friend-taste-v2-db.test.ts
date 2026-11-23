import {beforeAll,afterAll,expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {friendItemSignalsV2,snapshotFriendOutcomesV2} from '../src/lib/social/friend-taste-v2.server';
import {handler} from '../src/lib/server/api/index.server';
import {friendInsights} from '../src/lib/social/insights.server';
import {requestFriend,changeFriend} from '../src/lib/social/service.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const [me,them]=[crypto.randomUUID(),crypto.randomUUID()];
const shared=Array.from({length:5},()=>crypto.randomUUID());
const onlyMe=Array.from({length:4},()=>crypto.randomUUID());
const onlyThem=Array.from({length:4},()=>crypto.randomUUID());
const show=crypto.randomUUID(),episodes=[crypto.randomUUID(),crypto.randomUUID()];
const all=[...shared,...onlyMe,...onlyThem];
let friendship:string;
async function compare(medium:'movies'|'tv'|'game') {
 return (await friendInsights(me,them,{medium})).media.find(row=>row.medium===medium)!.comparison;
}
async function overlaps(medium:'movies'|'tv',overlap:'shared'|'onlyYou'|'onlyFriend',page:number) {
 const data=await friendInsights(me,them,{medium,overlap,page});
 return {total:data.total,page:data.page,progress:data.media.find(row=>row.medium===medium)!.progressComparisons};
}

beforeAll(async()=>{
  if (process.env.COAST_DB_TEST!=='1') return;
  const db=getSql();
  for (const id of [me,them]) await db`insert into users(id,username) values(${id},${'fv2-'+id})`;
  const request=await requestFriend(me,{username:'fv2-'+them});friendship=request.id;
  await changeFriend(them,friendship,{action:'accept'});
  await db`insert into media(id,kind,title,genres) select id,'movie','Friend taste',array['Drama','Animation'] from unnest(${db.array(all,'UUID')}) id`;
  await db`insert into tracking_state(user_id,media_id,watched) select ${me},id,true from unnest(${db.array([...shared,...onlyMe],'UUID')}) id`;
  await db`insert into tracking_state(user_id,media_id,watched) select ${them},id,true from unnest(${db.array([...shared,...onlyThem],'UUID')}) id`;
  await db`insert into ratings(user_id,media_id,value) select ${me},id,5 from unnest(${db.array([...shared,...onlyMe],'UUID')}) id`;
  await db`insert into ratings(user_id,media_id,value) select ${them},id,1 from unnest(${db.array(shared,'UUID')}) id`;
  await db`insert into ratings(user_id,media_id,value) select ${them},id,5 from unnest(${db.array(onlyThem,'UUID')}) id`;
  await db`insert into media(id,kind,title) values(${show},'show','Friend comparison series')`;
  await db`insert into shows(media_id) values(${show})`;
  await db`insert into media(id,kind,title) select id,'episode','Friend comparison episode' from unnest(${db.array(episodes,'UUID')}) id`;
  await db`insert into episodes(media_id,show_id,season_number,episode_number) select id,${show},1,n from unnest(${db.array(episodes,'UUID')}) with ordinality as ep(id,n)`;
  await db`insert into ratings(user_id,media_id,value) values(${me},${episodes[0]},5),(${them},${episodes[1]},1)`;
});
afterAll(async()=>{
  if (process.env.COAST_DB_TEST!=='1') return;
  const db=getSql();
  await db`delete from users where id in (${me},${them})`;
  await db`delete from works where id=any(${db.array([...all,...episodes,show],'UUID')}::uuid[])`;
});

run('same visible watches, opposing shared opinions and matching independent titles remain separate',async()=>{
  const result=await compare('movies');
  const db=getSql();
  await db`update tracking_state set play_count=2 where user_id=${them} and media_id=${onlyThem[0]}`;
  await db`insert into tracking_events(user_id,media_id,action,source,applied,occurred_at,rewatch)
    values(${them},${onlyThem[0]},'watch','trakt',true,'2021-02-03',true),(${them},${onlyThem[0]},'watch','jellyfin',true,'2021-02-03',true)`;
  expect(await compare('movies')).toEqual(result);
  expect(result.viewing).toEqual({shared:5,onlyYou:4,onlyFriend:4});
  expect(result.agreement).toMatchObject({works:5,score:11});
  expect(result.preferences.score).toBeGreaterThan(75);
  expect((await compare('tv')).agreement).toMatchObject({works:0,score:null});
  const unused=await snapshotFriendOutcomesV2(me,them);
  expect(unused.filter(item=>item.medium==='movie').map(item=>item.id).sort()).toEqual([...onlyThem].sort());
  const peer=await friendItemSignalsV2(me,shared[0],'movie',65);
  expect(peer).toMatchObject({personalScore:65,assistedScore:null,visibleRatings:1,reason:'insufficient-evidence'});
});
run('the paged shelf retains shared and exclusive titles, per-episode identity and visible progress',async()=>{
  const common=await overlaps('movies','shared',99999);
  expect(common.total).toBe(5);expect(common.page).toBe(1);
  expect(common.progress.map(r=>r.workId).sort()).toEqual([...shared].sort());
  expect(common.progress.every(row=>row.you===100&&row.friend===100)).toBe(true);
  expect((await overlaps('movies','onlyFriend',1)).progress.map(r=>r.workId).sort()).toEqual([...onlyThem].sort());
  expect((await overlaps('tv','onlyYou',1)).progress.map(r=>r.workId)).toEqual([episodes[0]]);
  const db=getSql();
  try {
    await db`update users set settings=${{social:{sections:{activity:'private',progress:'private'}}}}::jsonb where id=${them}`;
    expect((await overlaps('movies','shared',1)).progress.every(row=>row.friend===null)).toBe(true);
    await db`update users set settings=${{social:{sections:{activity:'private',progress:'private',ratings:'private'}}}}::jsonb where id=${them}`;
    expect((await overlaps('movies','onlyFriend',1)).total).toBe(0);
  } finally {await db`update users set settings='{}' where id=${them}`;}
});
run('normal API and All media use identical comparisons for every visible medium',async()=>{
  const db=getSql(),games=Array.from({length:11},()=>crypto.randomUUID());
  await db`insert into system_settings(key,value) values('coast','{"experimentalGaming":true}') on conflict(key) do update set value=system_settings.value||excluded.value`;
  try {
    await db`insert into games(id,title,genres) select id,'Shared game taste',array['Adventure','Puzzle'] from unnest(${db.array(games,'UUID')}) id`;
    for(const [user,selected] of [[me,games.slice(0,8)],[them,[...games.slice(0,5),...games.slice(8)]]] as const)
      await db`insert into ratings(user_id,media_id,value) select ${user},id,5 from unnest(${db.array([...selected],'UUID')}) id`;
    const all=await friendInsights(me,them);
    const url=new URL('http://localhost/api/social/insights');
    url.searchParams.set('friendId',them);url.searchParams.set('medium','game');url.searchParams.set('overlap','onlyFriend');
    const response=()=>handler({request:new Request(url),url,params:{path:'social/insights'},locals:{user:{id:me,username:'fv2-'+me,role:'user',settings:{}}}} as never);
    const actual=await response();
    expect(actual.status).toBe(200);
    const data=await actual.json();
    const result=data.media.find((r:{medium:string})=>r.medium==='game').comparison;
    expect(data.ids.sort()).toEqual(games.slice(8).sort());
    expect(result).toEqual(all.media.find(r=>r.medium==='game')!.comparison);
    expect(result.agreement).toEqual({works:5,score:100});
    expect(result.preferences.traits).toBeGreaterThanOrEqual(2);
    expect(result.preferences.score).toBeGreaterThan(75);
    expect(await compare('movies')).toEqual(all.media.find(r=>r.medium==='movies')!.comparison);
    await db`update users set settings=${{social:{categories:{game:'private'}}}}::jsonb where id=${them}`;
    expect((await response()).status).toBe(404);
    expect((await friendInsights(me,them)).media.some(r=>r.medium==='game')).toBe(false);
  } finally {
    await db`delete from works where id=any(${db.array(games,'UUID')}::uuid[])`;
    await db`update users set settings='{}' where id=${them}`;
  }
});
run('field and category revocation withdraw derived results without cache warming or waiting',async()=>{
  const db=getSql();
  try {
    await db`update users set settings=${{social:{sections:{ratings:'private'}}}}::jsonb where id=${them}`;
    const masked=await compare('movies');
    expect(masked.agreement.works).toBe(0);
    const peer=await friendItemSignalsV2(me,shared[0],'movie',65);
    expect(peer.visibleRatings).toBe(0);
    expect((await snapshotFriendOutcomesV2(me,them)).every(item=>item.stars===null)).toBe(true);
    await db`update ratings set value=.5 where user_id=${them}`;
    expect(await compare('movies')).toEqual(masked);
    await db`update users set settings=${{social:{sections:{ratings:'private',activity:'private'}}}}::jsonb where id=${them}`;
    const privateTastes=await compare('movies');
    expect(privateTastes.preferences).toEqual({score:null,traits:0,examples:[]});
    expect(privateTastes.viewing.onlyFriend).toBe(0);
    await db`update users set settings=${{social:{categories:{screen:'private'}}}}::jsonb where id=${them}`;
    await expect(compare('movies')).rejects.toThrow();
    expect((await friendItemSignalsV2(me,shared[0],'movie',65)).visibleRatings).toBe(0);
  } finally { await db`update users set settings='{}' where id=${them}`; }
});
run('only validated, still visible pairs can contribute an item adjustment',async()=>{
  const db=getSql(),past=Array.from({length:24},()=>crypto.randomUUID());
  const stamp=(n:number)=>new Date(Date.UTC(2021,0,n)).toISOString();
  const records=past.map((id,i)=>({id,personal:50,friendStars:i%2?5:1,viewerStars:i%2?5:1,
    predictedAt:stamp(i+2),friendObservedAt:stamp(i+1),viewerRatedAt:stamp(i+3)}));
  const study={viewerId:me,friendId:them,medium:'movie' as const,forecasts:records};
  try {
    await db`insert into media(id,kind,title) select id,'movie','Consented paired test' from unnest(${db.array(past,'UUID')}) id`;
    for (const user of [me,them]) await db`insert into ratings(user_id,media_id,value)
      select ${user},id,case when pos%2=0 then 5 else 1 end from unnest(${db.array(past,'UUID')}) with ordinality as item(id,pos)`;
    const assisted=await friendItemSignalsV2(me,shared[0],'movie',65,undefined,[study]);
    expect(assisted.reason).toBe('validated');
    expect(assisted.calibrationWorks).toBe(24);
    expect(assisted.assistedScore).toBeLessThan(65);
    await db`delete from ratings where user_id=${them} and media_id=any(${db.array(past.slice(0,18),'UUID')}::uuid[])`;
    const withdrawn=await friendItemSignalsV2(me,shared[0],'movie',65,undefined,[study]);
    expect(withdrawn.assistedScore).toBeNull();
    await db`update users set settings=${{social:{sections:{ratings:'private'}}}}::jsonb where id=${them}`;
    expect((await friendItemSignalsV2(me,shared[0],'movie',65,undefined,[study])).assistedScore).toBeNull();
  } finally {
    await db`delete from works where id=any(${db.array(past,'UUID')}::uuid[])`;
    await db`update users set settings='{}' where id=${them}`;
  }
});
run('unfriending revokes viewing, profile similarity and peer-assisted forecasts immediately',async()=>{
  await changeFriend(me,friendship,{action:'remove'});
  await expect(compare('movies')).rejects.toThrow();
  expect(await friendItemSignalsV2(me,shared[0],'movie',65)).toMatchObject({assistedScore:null,visibleRatings:0});
});
