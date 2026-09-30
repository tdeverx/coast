import { and,asc,eq,inArray,sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { musicWorks,mediaRelationships,musicProgress,lists } from '$lib/server/db/schema';
import { workAssessments } from '$lib/collection/query.server';
import { DomainError } from '$lib/core/errors';
export async function musicQueue(userId:string,workId:string){
  const db=getDb();const [work]=await db.select().from(musicWorks).where(eq(musicWorks.id,workId));if(!work)throw new DomainError('Music not found.',404);
  const entries=work.kind==='track'?[work]:await db.select({id:musicWorks.id,title:musicWorks.title}).from(mediaRelationships).innerJoin(musicWorks,eq(musicWorks.id,mediaRelationships.childId)).where(and(eq(mediaRelationships.parentId,workId),eq(mediaRelationships.kind,'contains'),eq(musicWorks.kind,'track'))).orderBy(asc(mediaRelationships.position),asc(musicWorks.id)).limit(10000);
  if (!entries.length) return { items: [], continueId: null };
  const assessments=await workAssessments(userId,userId,entries.map(e=>e.id));const states=new Map(assessments.map(a=>[a.id,a.availability]));
  const progress=await db.select().from(musicProgress).where(and(eq(musicProgress.userId,userId),inArray(musicProgress.trackId,entries.map(e=>e.id))));
  const current=progress.filter(p=>p.positionSeconds>0).sort((a,b)=>b.updatedAt.getTime()-a.updatedAt.getTime())[0];
  return {items:entries.map(e=>({id:e.id,title:e.title,availability:states.get(e.id)??'unknown'})),continueId:current?.trackId??entries[0]?.id??null};
}

/** Expand the existing ordered personal queue/list into music leaves, retaining
 * repeats and previously listened tracks. Screen playlist skipping is unchanged. */
export async function savedMusicQueue(userId:string,listId?:string){
 const db=getDb();
 if(listId){
  const [list]=await db.select().from(lists).where(and(eq(lists.id,listId),eq(lists.userId,userId)));
  if(!list?.playlist)throw new DomainError('This playlist was not found.',404);
  const [screen]=await db.execute(sql`select 1 from list_items li join works w on w.id=li.media_id where li.list_id=${listId} and w.category<>'music' limit 1`);
  if(screen)return null;
 }
 const seed=listId?sql`select li.media_id,li.position::bigint position,li.id::text entry from list_items li where li.list_id=${listId}`:
  sql`select q.media_id,row_number() over(order by q.created_at,q.media_id) position,q.media_id::text entry from up_next q join works w on w.id=q.media_id where q.user_id=${userId} and w.category='music'`;
 const rows=await db.execute<{id:string;title:string}>(sql`with selected as (${seed}), tracks as (
  select t.id,t.title,selected.position,0 member_position,selected.entry from selected join music_works t on t.id=selected.media_id and t.kind='track'
  union all select t.id,t.title,selected.position,r.position member_position,selected.entry from selected join music_works a on a.id=selected.media_id and a.kind='album' join media_relationships r on r.parent_id=a.id and r.kind='contains' join music_works t on t.id=r.child_id and t.kind='track'
 ) select id,title from tracks order by position,member_position,entry,id limit 10000`);
 const entries=Array.from(rows) as {id:string;title:string}[],assessments=await workAssessments(userId,userId,[...new Set(entries.map(e=>e.id))]);
 const states=new Map(assessments.map(a=>[a.id,a.availability]));
 return {items:entries.map(e=>({...e,availability:states.get(e.id)??'unknown'})),continueId:entries[0]?.id??null};
}
