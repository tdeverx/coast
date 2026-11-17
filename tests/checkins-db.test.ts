import { afterAll, beforeAll, expect, test } from 'bun:test';
import { getSql } from '../src/lib/server/db';
import { workActionData } from '../src/lib/collection/query.server';
import { mediaActionData } from '../src/lib/server/queries/media-actions';
import { checkinArtistTracks, checkinEpisodes } from '../src/lib/social/checkins-query.server';
import { artistMusicQueue } from '../src/lib/music/queue.server';
import { cancelCheckin, completeCheckin, finishCheckin, startCheckin } from '../src/lib/social/checkins.server';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const [owner, other, show, season, collection] = Array.from({ length: 5 }, () => crypto.randomUUID());
const manualWorks = ['game', 'book', 'comic', 'track', 'album'].map(kind => ({
  id: crypto.randomUUID(), kind, category: ['track', 'album'].includes(kind) ? 'music' : kind,
}));
const episodes = Array.from({ length: 25 }, () => crypto.randomUUID());
const [artist,instance,connection] = Array.from({length:3},()=>crypto.randomUUID());
const tracks = Array.from({length:23},()=>crypto.randomUUID());
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const db = getSql();
  await db`insert into system_settings(key,value) values('coast',${{
    experimentalBooks: true, experimentalComics: true, experimentalGaming: true, experimentalMusic: true,
  }}::jsonb) on conflict(key) do update set value=excluded.value`;
  await db`insert into users(id,username) values(${owner},${'checkin-'+owner}),(${other},${'checkin-'+other})`;
  await db`insert into media(id,kind,title) values(${show},'show','Check-in show'),(${season},'season','Check-in season'),(${collection},'collection','Check-in collection')`;
  await db`insert into shows(media_id) values(${show})`;
  await db`insert into seasons(media_id,show_id,season_number) values(${season},${show},1)`;
  for (const [index, id] of episodes.entries()) {
    const released = index < 22 ? '2000-01-01' : index === 22 ? '2999-01-01' : null;
    await db`insert into media(id,kind,title,release_date,runtime_minutes) values(${id},'episode',${'Episode '+(index+1)},${released},20)`;
    await db`insert into episodes(media_id,show_id,season_id,season_number,episode_number,is_special)
      values(${id},${show},${season},1,${index+1},${index===24})`;
  }
  for (const work of manualWorks)
    await db`insert into works(id,category,kind) values(${work.id},${work.category},${work.kind})`;
  await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Artist check-in','https://fixture.invalid')`;
  await db`insert into provider_connections(id,user_id,instance_id) values(${connection},${owner},${instance})`;
  await db`insert into works(id,category,kind) values(${artist},'music','artist')`;
  await db`insert into music_works(id,kind,title) values(${artist},'artist','Artist')`;
  await db`insert into music_artists(id,work_id,instance_id,external_id,name) values(${artist},${artist},${instance},${artist},'Artist')`;
  for(const [index,id] of tracks.entries()) {
    await db`insert into works(id,category,kind) values(${id},'music','track')`;
    await db`insert into music_works(id,kind,title) values(${id},'track',${'Track '+String(index+1).padStart(2,'0')})`;
    // Repeated credit roles must not duplicate a recording choice.
    await db`insert into music_credits(work_id,artist_id,role) values(${id},${artist},'artist'),(${id},${artist},'performer')`;
    const item=crypto.randomUUID();
    await db`insert into provider_items(id,instance_id,media_id,external_id,kind) values(${item},${instance},${id},${id},'track')`;
    await db`insert into availability(user_id,connection_id,provider_item_id,media_id,state) values(${owner},${connection},${item},${id},${index===22?'missing':'available'})`;
  }
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const db = getSql();
  await db`delete from users where id in (${owner}::uuid,${other}::uuid)`;
  await db`delete from provider_instances where id=${instance}`;
  await db`delete from works where id in ${db([show,season,collection,artist,...episodes,...tracks,...manualWorks.map(work=>work.id)])}`;
});

run('artist check-ins choose canonical tracks without requiring playback and retain explicit finish/cancel',async()=>{
  const db=getSql();
  expect((await checkinArtistTracks(owner,artist,1)).items.map(track=>track.id)).toEqual(tracks.slice(0,20));
  expect(await checkinArtistTracks(owner,artist,1)).toMatchObject({hasMore:true,activeCheckin:null});
  expect((await checkinArtistTracks(owner,artist,2)).items.map(track=>track.id)).toEqual(tracks.slice(20,23));
  expect(await checkinArtistTracks(owner,artist,2)).toMatchObject({hasMore:false});
  expect((await artistMusicQueue(owner,artist)).items.map(track=>track.id)).toEqual(tracks.slice(0,22));
  expect((await checkinArtistTracks(other,artist,1)).items).toHaveLength(20);
  const otherCheckin=await startCheckin(other,{workId:tracks[22],artistWorkId:artist});
  await cancelCheckin(other,otherCheckin.id);
  await expect(startCheckin(owner,{workId:tracks[0],artistWorkId:crypto.randomUUID()})).rejects.toMatchObject({status:409});
  const active=await startCheckin(owner,{workId:tracks[0],artistWorkId:artist});
  expect(active).toMatchObject({workId:tracks[0],mode:'manual'});
  expect((await (await import('../src/lib/collection/query.server')).workActionData(owner,artist)).activeCheckin).toMatchObject({id:active.id,workId:tracks[0]});
  expect((await checkinArtistTracks(owner,artist,1)).activeCheckin).toMatchObject({id:active.id,workId:tracks[0]});
  // The cancellation control remains discoverable if the selected stream disappears.
  await db`update availability set state='missing' where media_id=${tracks[0]}`;
  expect((await checkinArtistTracks(owner,artist,1)).activeCheckin).toMatchObject({id:active.id});
  await finishCheckin(owner,active.id);
  expect((await checkinArtistTracks(owner,artist,1)).activeCheckin).toBeNull();
  expect(await db`select id from social_activity where user_id=${owner} and work_id=${tracks[0]} and event_kind='checkin'`).toHaveLength(1);
  expect(await db`select id from music_listens where user_id=${owner} and track_id=${tracks[0]}`).toHaveLength(0);
  await db`update provider_connections set status='disconnected' where id=${connection}`;
  expect((await checkinArtistTracks(owner,artist,1)).items).toHaveLength(20);
  const offline=await startCheckin(owner,{workId:tracks[1],artistWorkId:artist});
  await cancelCheckin(owner,offline.id);
  await db`update provider_connections set status='connected' where id=${connection}`;
  await db`update users set settings=${{features:{presence:false}}}::jsonb where id=${owner}`;
  await expect(checkinArtistTracks(owner,artist,1)).rejects.toMatchObject({status:403});
  await db`update users set settings='{}'::jsonb where id=${owner}`;
});

run('manual check-ins work without playback providers and finish once without changing progress', async () => {
  const db = getSql();
  for (const id of [collection, ...manualWorks.map(work=>work.id)]) {
    const before = Date.now();
    const first = await startCheckin(owner, {workId: id});
    expect(first.mode).toBe('manual');
    expect(first.expiresAt.getTime()).toBeGreaterThanOrEqual(before+24*60*60*1000);
    expect((await startCheckin(owner, {workId: id})).id).toBe(first.id);
    expect((await workActionData(owner,id)).activeCheckin).toMatchObject({id:first.id,workId:id,mode:'manual'});
    expect((await workActionData(other,id)).activeCheckin).toBeNull();
    await expect(cancelCheckin(other,first.id)).rejects.toMatchObject({status:404});
    await expect(finishCheckin(other,first.id)).rejects.toMatchObject({status:404});
    expect(await Promise.all([finishCheckin(owner,first.id),finishCheckin(owner,first.id)])).toEqual([{state:'completed'},{state:'completed'}]);
    expect(await db`select id from social_activity where user_id=${owner} and work_id=${id} and event_kind='checkin'`).toHaveLength(1);
    expect(await db`select id from tracking_events where user_id=${owner} and media_id=${id}`).toHaveLength(0);
    expect(await db`select id from game_playthroughs where user_id=${owner} and game_id=${id}`).toHaveLength(0);
    expect(await db`select work_id from reading_progress where user_id=${owner} and work_id=${id}`).toHaveLength(0);
  }
});

run('manual cancellation, timeout and withdrawn permissions never infer consumption', async () => {
  const db = getSql(), id = manualWorks[0].id;
  const cancelled = await startCheckin(owner,{workId:id});
  await cancelCheckin(owner,cancelled.id);
  await finishCheckin(owner,cancelled.id);
  const expired = await startCheckin(owner,{workId:id});
  await db`update social_checkins set expires_at=now()-interval '1 second' where id=${expired.id}`;
  await completeCheckin(owner,expired.id);
  const withdrawn = await startCheckin(owner,{workId:id});
  await db`update users set settings=${{features:{presence:false}}}::jsonb where id=${owner}`;
  expect((await workActionData(owner,id)).activeCheckin).toBeNull();
  await expect(startCheckin(owner,{workId:id})).rejects.toMatchObject({status:403});
  expect(await finishCheckin(owner,withdrawn.id)).toEqual({state:'cancelled'});
  await db`update users set settings='{}'::jsonb where id=${owner}`;
  const rows = await db<{state:string}[]>`select state from social_checkins where id in (${cancelled.id}::uuid,${expired.id}::uuid,${withdrawn.id}::uuid)`;
  expect(rows.map(row=>row.state)).toEqual(['cancelled','cancelled','cancelled']);
  expect(await db`select id from social_activity where source_key in ${db([cancelled.id,expired.id,withdrawn.id].map(value=>'social_checkins:'+value))}`).toHaveLength(0);
});

run('show and season choices are paged, aired and bound to the exact selected episode', async () => {
  expect((await checkinEpisodes(owner,show,1)).items.map(item=>item.id)).toEqual(episodes.slice(0,20));
  expect(await checkinEpisodes(owner,show,1)).toMatchObject({hasMore:true});
  expect((await checkinEpisodes(owner,season,2)).items.map(item=>item.id)).toEqual(episodes.slice(20,22));
  expect(await checkinEpisodes(owner,season,2)).toMatchObject({hasMore:false});
  for (const episode of episodes.slice(22))
    await expect(startCheckin(owner,{workId:episode,parentWorkId:season})).rejects.toMatchObject({status:409});
  await expect(startCheckin(owner,{workId:show})).rejects.toMatchObject({status:400});
  await expect(startCheckin(owner,{workId:episodes[0],parentWorkId:collection})).rejects.toMatchObject({status:409});
  const active = await startCheckin(owner,{workId:episodes[0],parentWorkId:show});
  expect(active.mode).toBe('timed');
  await expect(startCheckin(owner,{workId:collection})).rejects.toMatchObject({status:409});
  await expect(finishCheckin(owner,active.id)).rejects.toMatchObject({status:409});
  const [showData,seasonData] = await Promise.all([mediaActionData(owner,show),mediaActionData(owner,season)]);
  expect(showData.activeCheckin).toMatchObject({id:active.id,workId:episodes[0],mode:'timed'});
  expect(seasonData.activeCheckin).toMatchObject({id:active.id,workId:episodes[0],mode:'timed'});
  expect(showData.activeCheckinId).toBeNull();
  expect((await mediaActionData(other,show)).activeCheckin).toBeNull();
  await cancelCheckin(owner,active.id);
});
