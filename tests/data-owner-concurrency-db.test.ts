import {afterAll,expect,test} from 'bun:test';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {closeDb,getDb,getSql} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {authenticateSession,hashToken,newSession,logout} from '../src/lib/server/auth';
import {getConfig} from '../src/lib/server/config';
import {publicMutation} from '../src/lib/server/public-api/mutations.server';
import {bulkTrackInTransaction,trackInTransaction} from '../src/lib/core/tracking/service.server';
import {sequenceEntries} from '../src/lib/core/lists/sequence.server';
import {setRewatch} from '../src/lib/core/tracking/rewatch.server';
import type {SequenceContext} from '../src/lib/media/sequence';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
afterAll(closeDb);
function latch(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function bounded<T>(promise:Promise<T>,ms=2000){let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Owner operation remained blocked.')),ms);})]);}finally{clearTimeout(timer!);}}
async function owner(){const [user]=await getDb().insert(s.users).values({username:`data-owner-${crypto.randomUUID()}`,passwordHash:'fixture'}).returning();return user;}

run('ordinary authentication reads a fresh snapshot without waiting for session row maintenance',async()=>{
 const user=await owner(),created=await newSession(user),held=latch(),release=latch();
 const lock=getSql().begin(async tx=>{await tx`select id from sessions where token_hash=${await hashToken(created.token)} for update`;held.release();await release.promise;});
 try{
  await bounded(held.promise);
  const result=await bounded(authenticateSession(created.token));
  expect(result?.user.id).toBe(user.id);expect(result?.token).toBeUndefined();
 }finally{release.release();await lock;await getDb().delete(s.users).where(eq(s.users.id,user.id));}
});

run('session rotation has one winner, preserves grace and observes committed revocation and disable',async()=>{
 const user=await owner(),created=await newSession(user),db=getSql();
 try{
  await db`update sessions set last_seen_at=now()-interval '2 hours' where user_id=${user.id}`;
  const results=await Promise.all(Array.from({length:6},()=>authenticateSession(created.token)));
  expect(results.every(result=>result?.user.id===user.id)).toBe(true);
  const rotated=results.flatMap(result=>result?.token?[result.token]:[]);expect(rotated).toHaveLength(1);
  expect((await authenticateSession(created.token))?.user.id).toBe(user.id);
  await db`update sessions set previous_valid_until=now()-interval '1 second' where user_id=${user.id}`;
  expect(await authenticateSession(created.token)).toBeNull();
  await db`update users set disabled=true where id=${user.id}`;
  expect(await authenticateSession(rotated[0])).toBeNull();
  await db`update users set disabled=false where id=${user.id}`;
  expect((await authenticateSession(rotated[0]))?.user.id).toBe(user.id);
  await logout(rotated[0]);expect(await authenticateSession(rotated[0])).toBeNull();
 }finally{await getDb().delete(s.users).where(eq(s.users.id,user.id));}
});

run('due rotation rereads after a concurrent logout instead of resurrecting the session',async()=>{
 const user=await owner(),created=await newSession(user),held=latch(),release=latch(),db=getSql();
 await db`update sessions set last_seen_at=now()-interval '2 hours' where user_id=${user.id}`;
 const removal=db.begin(async tx=>{await tx`delete from sessions where user_id=${user.id}`;held.release();await release.promise;});
 let authentication:Promise<unknown>|undefined;
 try{
  await held.promise;authentication=authenticateSession(created.token);
  // The read sees the old committed tuple; the rotation lock must wait for DELETE.
  expect(await Promise.race([authentication.then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),50))])).toBe(false);
  release.release();await removal;expect(await bounded(authentication)).toBeNull();
  expect(await db`select id from sessions where user_id=${user.id}`).toHaveLength(0);
 }finally{release.release();await Promise.allSettled([removal,...(authentication?[authentication]:[])]);await getDb().delete(s.users).where(eq(s.users.id,user.id));}
});

run('public mutations share policy admission without upgrading another writer shared user lock',async()=>{
 const user=await owner(),db=getDb(),held=latch(),release=latch();
 const [movie]=await db.insert(s.media).values({kind:'movie',title:'Shared lock correctness fixture'}).returning();
 const [credential]=await db.insert(s.apiTokens).values({userId:user.id,name:'Fixture writer',tokenHash:await hashToken(crypto.randomUUID()),scopes:['tracking:write'],expiresAt:new Date(Date.now()+86400000)}).returning();
 const actor={id:user.id,username:user.username,tokenId:credential.id,scopes:['tracking:write']};
 const write=(key:string)=>{const request=new Request('http://coast.test/api/public/v1/tracking',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({mediaId:movie.id,action:'watch'})});return publicMutation(actor,request,new URL(request.url),['tracking']);};
 const policy=db.transaction(async tx=>{await tx.execute(sql`select coast_lock_feature_policy(${user.id}::uuid)`);held.release();await release.promise;});
 let mutation:Promise<unknown>|undefined;
 try{
  await held.promise;mutation=write('first');
  expect(await bounded(mutation)).toMatchObject({response:{changed:true},replayed:false});
  release.release();await policy;
  expect(await write('first')).toMatchObject({response:{changed:true},replayed:true});
  await db.update(s.apiTokens).set({revokedAt:new Date()}).where(eq(s.apiTokens.id,credential.id));
  await expect(write('revoked')).rejects.toMatchObject({status:401});
  await db.update(s.apiTokens).set({revokedAt:null}).where(eq(s.apiTokens.id,credential.id));
  await db.update(s.users).set({disabled:true}).where(eq(s.users.id,user.id));
  await expect(write('disabled')).rejects.toMatchObject({status:401});
  const events=await db.select().from(s.trackingEvents).where(and(eq(s.trackingEvents.userId,user.id),eq(s.trackingEvents.mediaId,movie.id)));
  expect(events).toHaveLength(1);
 }finally{release.release();await Promise.allSettled([policy,...(mutation?[mutation]:[])]);await db.delete(s.users).where(eq(s.users.id,user.id));await db.delete(s.media).where(eq(s.media.id,movie.id));}
});

run('public replay rechecks API feature policy after transaction admission',async()=>{
 const user=await owner(),db=getDb(),previous=await getConfig();
 const [token]=await db.insert(s.apiTokens).values({userId:user.id,name:'Policy fixture',tokenHash:await hashToken(crypto.randomUUID()),scopes:['webhooks:manage'],expiresAt:new Date(Date.now()+86400000)}).returning();
 const request=new Request('http://coast.test/api/public/v1/webhooks',{method:'DELETE',headers:{'idempotency-key':'withdrawn'}});
 try{
  await db.insert(s.systemSettings).values({key:'coast',value:{...previous,features:{...previous.features,api:false}}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...previous,features:{...previous.features,api:false}}}});
  await expect(publicMutation({id:user.id,username:user.username,tokenId:token.id,scopes:['webhooks:manage']},request,new URL(request.url),['webhooks',crypto.randomUUID()])).rejects.toMatchObject({code:'feature_disabled'});
 }finally{await db.update(s.systemSettings).set({value:previous}).where(eq(s.systemSettings.key,'coast'));await db.delete(s.users).where(eq(s.users.id,user.id));}
});

for(const mode of ['collection','collection-rewatch','collection-backdated','playlist'] as const)run(`bulk ${mode} reuses one validated census and preserves repeated occurrences`,async()=>{
 const user=await owner(),db=getDb(),ids=Array.from({length:4},()=>crypto.randomUUID()),[parent,nested,movie,other]=ids;
 let playlistId:string|undefined;
 try{
  await db.insert(s.media).values(ids.map((id,index)=>({id,kind:index<2?'collection' as const:'movie' as const,title:'Sequence census correctness fixture'})));
  await db.insert(s.mediaRelationships).values([{parentId:parent,childId:movie,position:0,kind:'collection'},{parentId:parent,childId:nested,position:1,kind:'collection'},{parentId:nested,childId:movie,position:0,kind:'collection'},{parentId:nested,childId:other,position:1,kind:'collection'}]);
  if(mode.includes('rewatch')||mode.includes('backdated')){
   await db.transaction(tx=>trackInTransaction(tx,user.id,{mediaId:movie,action:'watch',occurredAt:'2010-01-01T00:00:00.000Z'}));
   await setRewatch(user.id,{mediaId:parent,startedAt:'2020-01-01T00:00:00.000Z'});
  }
  let sequence:SequenceContext={kind:'collection',id:parent,entryId:parent};
  if(mode==='playlist'){
   const [list]=await db.insert(s.lists).values({userId:user.id,name:'Repeated occurrence fixture',playlist:true}).returning();playlistId=list.id;
   const [item]=await db.insert(s.listItems).values({listId:list.id,mediaId:parent,position:0}).returning();sequence={kind:'playlist',id:list.id,entryId:item.id};
  }
  const session=(db as unknown as {session:{logger:unknown;options:{logger:unknown}}}).session,old=session.logger,oldOptions=session.options.logger,queries:string[]=[];
  const logger={logQuery:(query:string)=>queries.push(query)};session.logger=logger;session.options.logger=logger;
  let result:Awaited<ReturnType<typeof bulkTrackInTransaction>>;
  try{result=await db.transaction(tx=>bulkTrackInTransaction(tx,user.id,{mediaId:parent,action:'watch',sequence,acknowledged:true,occurredAt:mode==='collection-backdated'?'2015-01-01T00:00:00.000Z':'2021-01-01T00:00:00.000Z'}));}
  finally{session.logger=old;session.options.logger=oldOptions;}
  expect(result!.total).toBe(3);
  expect(queries.filter(query=>query.includes('from entries order by sort_path'))).toHaveLength(1);
  const [state]=await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId,user.id),eq(s.trackingState.mediaId,movie)));
  expect(state.playCount).toBe(mode==='collection'?1:mode==='collection-backdated'?3:2);
  const entries=await sequenceEntries(user.id,sequence);
  expect(entries).toHaveLength(3);
  expect(entries.every(entry=>entry.watched)).toBe(mode!=='collection-backdated');
  const events=await db.select().from(s.trackingEvents).where(and(eq(s.trackingEvents.userId,user.id),sql`${s.trackingEvents.sequence} is not null`));
  expect(new Set(events.map(event=>event.sequence?.entryId)).size).toBe(3);
 }finally{if(playlistId)await db.delete(s.lists).where(eq(s.lists.id,playlistId));await db.delete(s.users).where(eq(s.users.id,user.id));await db.delete(s.media).where(inArray(s.media.id,ids));}
});
