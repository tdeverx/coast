import {expect,test} from 'bun:test';
import {getDb,getSql} from '../src/lib/server/db';
import {enqueueTraktChangeInTransaction} from '../src/lib/sync/changes';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
run('unsupported media never enters Trakt export even with a stray screen-provider mapping',async()=>{
 const db=getSql(),user=crypto.randomUUID(),instance=crypto.randomUUID(),connection=crypto.randomUUID();
 await db`insert into users(id,username) values(${user},${'parity-'+user})`;
 await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'trakt','Fixture','https://fixture.invalid')`;
 await db`insert into provider_connections(id,user_id,instance_id,status,settings) values(${connection},${user},${instance},'connected',${{sync:{ratings:true}}})`;
 for(const category of ['music','game','book','comic']) {
  const work=crypto.randomUUID();await db`insert into works(id,category,kind) values(${work},${category},${category==='music'?'track':category})`;
  // Simulate an incompatible mapping left by an older/manual import.
  await db`insert into media(id,title,kind) values(${work},'Fixture','movie')`;
  await db`insert into external_ids(media_id,provider,external_id,media_kind) values(${work},'imdb',${'fixture-'+work},'movie')`;
  await getDb().transaction(tx=>enqueueTraktChangeInTransaction(tx,user,{mediaId:work,category:'ratings',value:8}));
 }
 expect(await db`select id from outbox_actions where user_id=${user}`).toHaveLength(0);
 expect(await db`select id from sync_values where connection_id=${connection}`).toHaveLength(0);
});
