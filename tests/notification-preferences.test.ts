import {expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';

const source=await Bun.file(new URL('../src/lib/server/notifications/index.ts',import.meta.url)).text();
const start=source.indexOf('const notificationBatchSize ='),end=source.indexOf('export async function resolveNotification(');
const compile=(getConfig:(database:unknown)=>unknown)=>new Function('sql','PgDialect','getConfig','getSql',new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(start,end)).replaceAll('export ','')+';return {notify,notifyMany};')(sql,PgDialect,getConfig,()=>{throw Error('Unexpected pool access');});
const dialect=new PgDialect(),id='00000000-0000-4000-8000-000000000001';

test('notification preference reads retain policy, duplicate-key flush and same-connection delivery',async()=>{
 const events:string[]=[],writes:unknown[][]=[];
 const database={execute:async(query:Parameters<typeof dialect.sqlToQuery>[0])=>{
  const compiled=dialect.sqlToQuery(query);
  if(compiled.sql.startsWith('SELECT')){events.push('preferences');expect(compiled.sql).toContain('jsonb_build_object');return [{id,settings:{notificationsSilenced:true,social:{notifications:{reaction:false}}}}];}
  events.push('write');writes.push(compiled.params);return [{id}];
 }};
 const {notifyMany}=compile(async(db:unknown)=>{expect(db).toBe(database);events.push('config');return {allowNotificationSilencing:true,notificationLevel:'normal'};});
 expect(await notifyMany([
  {userId:id,kind:'reaction',title:'Suppressed',data:{actorId:id}},
  {userId:id,kind:'sync',title:'First',sourceKey:'same'},
  {userId:id,kind:'sync',title:'Second',sourceKey:'same',locked:true},
 ],database)).toEqual([id,id]);
 expect(events).toEqual(['config','preferences','write','write']);
 expect(writes[0]).toContain('silent');expect(writes[1]).toContain('normal');
 expect(writes.flat()).not.toContain('Suppressed');
});

test('sequential source recipients keep fresh policy reads and stop at the failing recipient',async()=>{
 const events:string[]=[],failure=new Error('preference read rejected');let reads=0;
 const database={execute:async(query:Parameters<typeof dialect.sqlToQuery>[0])=>{
  const compiled=dialect.sqlToQuery(query);
  if(compiled.sql.startsWith('SELECT')){events.push('preferences');if(++reads===2)throw failure;return [{id,settings:{}}];}
  events.push('write');return [{id}];
 }};
 const {notify}=compile(async()=>{events.push('config');return {allowNotificationSilencing:true,notificationLevel:'normal'};});
 await expect((async()=>{for(const title of ['First','Second','Third'])await notify({userId:id,kind:'sync',title},database);})()).rejects.toBe(failure);
 expect(events).toEqual(['config','preferences','write','config','preferences']);
});
