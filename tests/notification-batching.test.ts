import {expect,test} from 'bun:test';
import {PgDialect} from 'drizzle-orm/pg-core';
import type {SQL} from 'drizzle-orm';
import type {UserSettings} from '../src/lib/server/db/schema';

const boundary=Symbol.for('coast.test.notification-batching');
type Fixture={database:{unsafe:(query:string,params:unknown[])=>Promise<{id:string}[]>};config:(database:unknown)=>Promise<{allowNotificationSilencing:boolean;notificationLevel:string}>};
const globals=globalThis as typeof globalThis & {[boundary]?:Fixture};
const source=(await Bun.file(new URL('../src/lib/server/notifications/index.ts',import.meta.url)).text())
 .replace("import { diagnosticStore } from '../diagnostics';",'const diagnosticStore={};')
 .replace("import { getDb, getSql, type Database } from '../db';",`const getSql=()=>globalThis[Symbol.for('coast.test.notification-batching')].database;`)
 .replace("import { notifications, type UserSettings } from '../db/schema';",'')
 .replace("import { getConfig, type CoastConfig } from '../config';",`const getConfig=database=>globalThis[Symbol.for('coast.test.notification-batching')].config(database);`)
 .replace("import { requireAdmin, requireUser, type SessionUser } from '../auth';",'const requireAdmin=actor=>{if(actor?.role!=="admin")throw new Error("Administrator required");};')
 .replace("import { AppError } from '../security/errors';",'')
 .replace("from 'valibot'",`from ${JSON.stringify(import.meta.resolve('valibot'))}`)
 .replace("from 'drizzle-orm'",`from ${JSON.stringify(import.meta.resolve('drizzle-orm'))}`)
 .replace("from 'drizzle-orm/pg-core'",`from ${JSON.stringify(import.meta.resolve('drizzle-orm/pg-core'))}`);
const module:typeof import('../src/lib/server/notifications')=await import(`data:text/javascript;base64,${Buffer.from(new Bun.Transpiler({loader:'ts'}).transformSync(source)).toString('base64')}`);
const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString().padStart(12,'0');
function fixture(count:number){
 const users=new Map(Array.from({length:count},(_,i)=>[id(i+1),{settings:{} as UserSettings,disabled:false}]));
 const rows=new Map<string,{id:string;userId:string;kind:string;title:string;body:unknown;level:unknown;locked:unknown;data:unknown}>();
 const counts={policy:0,reads:0,writes:0,maxRead:0,maxWrite:0};
 let policy={allowNotificationSilencing:true,notificationLevel:'normal'},lastDatabase:unknown;
 const query=async(text:string,params:unknown[])=>{
  if(text.startsWith('SELECT id,')&&text.includes('FROM users')){
   counts.reads++;
   const selected=[...users].filter(([key,user])=>text.includes('disabled = FALSE')?!user.disabled&&(!text.includes('AND id >')||key>String(params[0])):params.includes(key));
   const page=selected.slice(0,text.includes('LIMIT')?Number(params.at(-1)):selected.length);
   counts.maxRead=Math.max(counts.maxRead,page.length);
   return page.map(([key,user])=>({id:key,settings:user.settings}));
  }
  if(text.includes('INSERT INTO notifications')){
   counts.writes++;counts.maxWrite=Math.max(counts.maxWrite,params.length/8);
   const result=[];
   for(let i=0;i<params.length;i+=8){
    const [userId,kind,title,body,level,locked,sourceKey,data]=params.slice(i,i+8),key=sourceKey?JSON.stringify([userId,sourceKey]):crypto.randomUUID();
    if (typeof data === 'string') throw new Error('Bun SQL JSONB must receive native data, not pre-encoded strings');
    const row={id:rows.get(key)?.id??crypto.randomUUID(),userId:String(userId),kind:String(kind),title:String(title),body,level,locked,data:structuredClone(data)};
    rows.set(key,row);result.push({id:row.id});
   }
   return result;
  }
  throw new Error('Unexpected notification query');
 };
 const database={unsafe:query};
 globals[boundary]={database:database as Fixture['database'],config:async db=>{counts.policy++;lastDatabase=db;return policy;}};
 return {users,rows,counts,database,query,get lastDatabase(){return lastDatabase;},setPolicy:(value:typeof policy)=>{policy=value;}};
}

test('broadcast pages settings and batch writes without per-recipient queries or omitted targets',async()=>{
 try{
  for(const count of [0,1,100,250]){
   const f=fixture(count);f.users.set(id(999),{settings:{},disabled:true});
   const result=await module.broadcast({role:'admin'} as Parameters<typeof module.broadcast>[0],{title:'Broadcast',body:'Fixture',level:'normal',locked:false});
   expect(result.delivered).toBe(count);expect(f.rows.size).toBe(count);
   expect([...f.rows.values()].map(row=>row.userId).sort()).toEqual([...f.users].filter(([,user])=>!user.disabled).map(([key])=>key));
   expect(f.counts.policy).toBe(1);expect(f.counts.maxRead).toBeLessThanOrEqual(100);expect(f.counts.maxWrite).toBeLessThanOrEqual(100);
   expect(f.counts.writes).toBe(Math.ceil(count/100));
   expect(f.counts.reads).toBe(Math.floor(count/100)+1);
  }
 }finally{delete globals[boundary];}
});

test('shared preparation preserves silence, locked levels, social preferences, missing users and sequential source upserts',async()=>{
 const f=fixture(4);
 try{
  f.users.get(id(1))!.settings={notificationsSilenced:true};
  f.users.get(id(2))!.settings={notificationLevel:'persistent'};
  f.users.get(id(3))!.settings={social:{notifications:{recommendation:false}}};
  const inputs=[
   {userId:id(1),kind:'administrator',title:'Silent',sourceKey:'one'},
   {userId:id(1),kind:'administrator',title:'Locked',level:'silent' as const,locked:true,sourceKey:'locked'},
   {userId:id(2),kind:'administrator',title:'Persistent',sourceKey:'two'},
   {userId:id(3),kind:'recommendation',title:'Suppressed',data:{actorId:id(2),subjectId:id(3),destination:'/for-you'},sourceKey:'social'},
   {userId:id(4),kind:'administrator',title:'Before',sourceKey:'repeat'},
   {userId:id(4),kind:'administrator',title:'After',sourceKey:'repeat'},
   {userId:id(999),kind:'administrator',title:'Missing'},
  ];
  const result=await module.notifyMany(inputs);
  expect(result).toHaveLength(5);expect(result[3]).toBe(result[4]);
  expect([...f.rows.values()].map(row=>[row.title,row.level,row.locked])).toEqual([['Silent','silent',false],['Locked','normal',true],['Persistent','persistent',false],['After','normal',false]]);
  expect(f.counts.policy).toBe(1);expect(f.counts.reads).toBe(1);
  f.setPolicy({allowNotificationSilencing:false,notificationLevel:'normal'});
  await module.notify({userId:id(1),kind:'administrator',title:'Policy',sourceKey:'policy'});
  expect([...f.rows.values()].at(-1)?.level).toBe('normal');
 }finally{delete globals[boundary];}
});

test('explicit Drizzle transactions own policy, preference reads and writes without acquiring the pool',async()=>{
 const f=fixture(1),dialect=new PgDialect();
 const transaction={execute:async(statement:SQL)=>{const query=dialect.sqlToQuery(statement);return f.query(query.sql,query.params);}};
 globals[boundary]!.database={unsafe:async()=>{throw new Error('Must not acquire pool');}};
 try{
  await module.notify({userId:id(1),kind:'request',title:'Transactional'},transaction as unknown as Parameters<typeof module.notify>[1]);
  expect(f.lastDatabase).toBe(transaction);expect(f.rows.size).toBe(1);expect(f.counts.reads).toBe(1);expect(f.counts.writes).toBe(1);
 }finally{delete globals[boundary];}
});
