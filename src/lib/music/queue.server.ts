import { requireFeature } from '#lib/server/features.js';
import { and,eq,inArray,sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { musicWorks,musicProgress,lists } from '#lib/server/db/schema.js';
import { workAssessments } from '#lib/collection/query.server.js';
import { DomainError } from '#lib/core/errors.js';
import { musicAlbumMembers, musicAlbumMembersSql } from './editions.server';
const MUSIC_QUEUE_LIMIT=10000;
function requireQueueWithinLimit(entries:readonly unknown[]){
 if(entries.length>MUSIC_QUEUE_LIMIT)throw new DomainError('This queue exceeds 10,000 tracks. Choose fewer tracks.',409,'queue_too_large');
}
export async function musicQueue(userId:string,workId:string){
  await requireFeature(userId,'music');
  const db=getDb();const [work]=await db.select().from(musicWorks).where(eq(musicWorks.id,workId));if(!work)throw new DomainError('Music not found.',404);
  const entries=work.kind==='track'?[work]:await musicAlbumMembers(workId,db,MUSIC_QUEUE_LIMIT+1);
  requireQueueWithinLimit(entries);
  if (!entries.length) return { items: [], continueId: null };
  const assessments=await workAssessments(userId,userId,entries.map(e=>e.id));const states=new Map(assessments.map(a=>[a.id,a.availability]));
  const progress=await db.select().from(musicProgress).where(and(eq(musicProgress.userId,userId),inArray(musicProgress.trackId,entries.map(e=>e.id))));
  const current=progress.filter(p=>p.positionSeconds>0).sort((a,b)=>b.updatedAt.getTime()-a.updatedAt.getTime())[0];
  return {items:entries.map(e=>({id:e.id,title:e.title,availability:states.get(e.id)??'unknown'})),continueId:current?.trackId??entries[0]?.id??null};
}

/** Expand the existing ordered personal queue/list into music leaves, retaining
 * repeats and previously listened tracks. Screen playlist skipping is unchanged. */
export async function savedMusicQueue(userId:string,listId?:string){
 await requireFeature(userId,'music');
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
  union all select t.id,t.title,selected.position,t.position member_position,selected.entry from selected cross join lateral (${musicAlbumMembersSql(sql`selected.media_id`)}) t
 ) select id,title from tracks order by position,member_position,entry,id limit ${MUSIC_QUEUE_LIMIT+1}`);
 const entries=Array.from(rows) as {id:string;title:string}[];
 requireQueueWithinLimit(entries);
 const assessments=await workAssessments(userId,userId,[...new Set(entries.map(e=>e.id))]);
 const states=new Map(assessments.map(a=>[a.id,a.availability]));
 return {items:entries.map(e=>({...e,availability:states.get(e.id)??'unknown'})),continueId:entries[0]?.id??null};
}

/** Party picker: unique choices from the personal queue, never the full playback payload. */
export async function savedMusicQueuePage(userId: string, requestedPage = 1) {
 await requireFeature(userId,'music');
 const { pageNumberSchema, pagination, PAGE_SIZE } = await import('#lib/server/queries/pagination.js');
 const { parse } = await import('valibot');
 parse(pageNumberSchema, requestedPage);
 const db = getDb();
 const choices = sql`with selected as (
   select q.media_id,row_number() over(order by q.created_at,q.media_id) position from up_next q
   join works w on w.id=q.media_id where q.user_id=${userId} and w.category='music'
 ), tracks as (
   select t.id,t.title,selected.position,0 member_position from selected join music_works t on t.id=selected.media_id and t.kind='track'
   union all select t.id,t.title,selected.position,t.position member_position from selected cross join lateral (${musicAlbumMembersSql(sql`selected.media_id`)}) t
 ), choices as (select distinct on(id) id,title,position,member_position from tracks order by id,position,member_position)`;
 const [count] = await db.execute<{total:number}>(sql`${choices} select count(*)::int total from choices`);
 const { page, pages } = pagination(count.total, requestedPage);
 const rows = await db.execute<{id:string;title:string}>(sql`${choices} select id,title from choices order by position,member_position,id limit ${PAGE_SIZE} offset ${(page-1)*PAGE_SIZE}`);
 const entries = Array.from(rows) as {id:string;title:string}[];
 const states = new Map((await workAssessments(userId,userId,entries.map(e=>e.id))).map(a=>[a.id,a.availability]));
 return { items: entries.map(e=>({...e,availability:states.get(e.id)??'unknown'})), page, pages, total: count.total };
}
