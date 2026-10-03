import {test,expect,beforeAll,afterAll} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {connectionFor} from '../src/lib/providers/connections.server';
import {SteamAdapter} from '../src/lib/providers/steam/adapter.server';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {pollProviderLiveFromContext} from '../src/lib/social/provider-live.server';
import {publicSearch} from '../src/lib/social/public.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const user=crypto.randomUUID(),instance=crypto.randomUUID(),connection=crypto.randomUUID(),work=crypto.randomUUID();
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getSql();
 await db`insert into users(id,username) values(${user},${'live-'+user})`;
 await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Live fixture','https://fixture.invalid')`;
 await db`insert into provider_connections(id,user_id,instance_id,status,external_user_id,credentials) values(${connection},${user},${instance},'connected','own-user','fixture')`;
 await db`insert into media(id,kind,title) values(${work},'movie','Live fixture title')`;
 await db`insert into provider_items(instance_id,external_id,media_id,kind) values(${instance},'playing',${work},'movie')`;
});
afterAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;const db=getSql();await db`delete from provider_instances where id=${instance}`;await db`delete from users where id=${user}`;await db`delete from media where id=${work}`;});
run('Jellyfin only observes this account, skips paused sessions, and retains no fabricated watches',async()=>{
 const context=await connectionFor(user,connection,'jellyfin');
 const adapter=new JellyfinAdapter(async()=>[{UserId:'other-user',NowPlayingItem:{Id:'private'}},{UserId:'own-user',NowPlayingItem:{Id:'playing'},PlayState:{IsPaused:false}}],user);
 await pollProviderLiveFromContext(user,connection,'jellyfin',{...context,adapter});
 const [state]=await getSql()`select work_id,expires_at from social_live_state where connection_id=${connection}`;
 expect(state.work_id).toBe(work);expect(new Date(state.expires_at).getTime()).toBeGreaterThan(Date.now());
 const [history]=await getSql()`select count(*)::int as count from tracking_events where user_id=${user}`;expect(history.count).toBe(0);
 const paused=new JellyfinAdapter(async()=>[{UserId:'own-user',NowPlayingItem:{Id:'playing'},PlayState:{IsPaused:true}}],user);
 await pollProviderLiveFromContext(user,connection,'jellyfin',{...context,adapter:paused});
 const [cleared]=await getSql()`select work_id from social_live_state where connection_id=${connection}`;expect(cleared.work_id).toBeNull();
});
run('an account switch during a live read cannot publish old account presence',async()=>{
 const context=await connectionFor(user,connection,'jellyfin');
 const adapter=new JellyfinAdapter(async()=>{await getSql()`update provider_connections set account_generation=${crypto.randomUUID()} where id=${connection}`;return [{UserId:'own-user',NowPlayingItem:{Id:'playing'}}];},user);
 await expect(pollProviderLiveFromContext(user,connection,'jellyfin',{...context,adapter})).rejects.toThrow('account changed');
});
run('guest catalogue search ignores server-only metadata and escapes wildcards',async()=>{
 expect((await publicSearch('Live fixture')).some(item=>item.id===work)).toBe(false);
 await getSql()`insert into external_ids(media_id,provider,external_id,media_kind) values(${work},'tmdb','987654321','movie')`;
 const results=await publicSearch('Live fixture');expect(results.some(item=>item.id===work)).toBe(true);expect(results.find(item=>item.id===work)?.episodeNumber).toBeUndefined();
 expect((await publicSearch('%')).some(item=>item.id===work)).toBe(false);
});

test('Steam exposes a live game only when its profile response supplies one',async()=>{
 const id='76561198000000000';
 const playing=new SteamAdapter(async()=>({response:{players:[{steamid:id,personaname:'Fixture',gameid:'12345'}]}}),'fixture');
 expect((await playing.profile(id)).playingId).toBe('12345');
 const idle=new SteamAdapter(async()=>({response:{players:[{steamid:id,personaname:'Fixture'}]}}),'fixture');
 expect((await idle.profile(id)).playingId).toBeNull();
});
