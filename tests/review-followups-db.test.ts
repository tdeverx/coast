import {beforeAll,afterAll,test,expect} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {publicDetails} from '../src/lib/social/public.server';
import {listsData} from '../src/lib/server/queries/lists';
import {initializePlatform} from '../src/lib/server/startup';
import {stopQueueWorker} from '../src/lib/server/queue';
import {stopProviderMaintenance} from '../src/lib/providers/maintenance.server';
const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const user=crypto.randomUUID(),show=crypto.randomUUID(),season=crypto.randomUUID(),game=crypto.randomUUID();
beforeAll(async()=>{
 if(!enabled)return;
 const db=getSql();
 await db`insert into users(id,username) values(${user},${'review-'+user})`;
 await db`insert into system_settings(key,value) values('coast',${{experimentalFeatures:true}}::jsonb) on conflict(key) do update set value=excluded.value`;
 await db`insert into media(id,kind,title) values(${show},'show','Public show'),(${season},'season','First season')`;
 await db`insert into shows(media_id) values(${show})`;
 await db`insert into seasons(media_id,show_id,season_number) values(${season},${show},1)`;
 await db`insert into works(id,category,kind) values(${game},'game','game')`;
 await db`insert into games(id,title) values(${game},'Replay fixture')`;
 await db`insert into tracking_state(user_id,media_id,watchlist) values(${user},${game},true)`;
});
afterAll(async()=>{
 if(!enabled)return;stopQueueWorker();stopProviderMaintenance();
 const db=getSql();await db`delete from users where id=${user}`;
 await db`delete from works where id in ${db([season,show,game])}`;
});
run('guest show details expose season navigation without personal or provider state',async()=>{
 const result=await publicDetails(show);
 expect(result.seasons).toHaveLength(1);expect(result.seasons[0].mediaId).toBe(season);
 expect(result.seasons[0].item?.title).toBe('First season');
 expect(result.availability).toEqual([]);expect(result.history).toEqual([]);
 expect(result.seasons[0].item?.available).toBe(false);
});
run('game list filters use the current playthrough instead of historical completion',async()=>{
 const db=getSql();
 await db`insert into game_playthroughs(user_id,game_id,status,created_at,completed_at) values(${user},${game},'completed',now()-interval '1 day',now()-interval '1 day'),(${user},${game},'in-progress',now(),null)`;
 expect((await listsData(user,{category:'game',filter:'progress'})).items.map(item=>item.id)).toContain(game);
 expect((await listsData(user,{category:'game',filter:'complete'})).total).toBe(0);
 await db`insert into game_playthroughs(user_id,game_id,status,created_at) values(${user},${game},'dropped',now()+interval '1 second')`;
 expect((await listsData(user,{category:'game',filter:'progress'})).total).toBe(0);
 expect((await listsData(user,{category:'game',filter:'dropped'})).items.map(item=>item.id)).toContain(game);
});
run('runtime initialization is idempotent and reloads replace worker ownership',async()=>{
 let first=0,second=0;const registerFirst=()=>{first++;},registerSecond=()=>{second++;};
 const initial=initializePlatform(registerFirst);expect(initializePlatform(registerFirst)).toBe(initial);
 await initial;expect(first).toBe(1);
 await initializePlatform(registerSecond);await initializePlatform(registerSecond);
 expect(first).toBe(1);expect(second).toBe(1);
 stopQueueWorker();stopProviderMaintenance();
});
