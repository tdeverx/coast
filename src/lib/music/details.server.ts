import {eq,sql} from 'drizzle-orm';
import * as v from 'valibot';
import {getDb} from '$lib/server/db';
import {musicWorks} from '$lib/server/db/schema';
import {requireFeature} from '$lib/server/features';
import {AppError} from '$lib/server/security/errors';
import {PAGE_SIZE,pagination,pageNumberSchema} from '$lib/server/queries/pagination';
import {musicAlbumMembers,musicAlbumMembersSql} from './editions.server';
import {musicDetails,musicLibrary,personaliseMusicItems} from './service.server';
import {hydrateMusicItems} from './presentation.server';
import {musicCard} from './presentation';
import type {MusicItem} from './model';

export async function musicChildren(userId:string,id:string,url:URL,signal?:AbortSignal){
 signal?.throwIfAborted();
 await requireFeature(userId,'music');const requested=v.parse(pageNumberSchema,Number(url.searchParams.get('page')??1));
 if(id==='source'){
  const connection=v.parse(v.pipe(v.string(),v.uuid()),url.searchParams.get('connectionId'));
  const {item}=await musicDetails(userId,connection,url.searchParams.get('externalId')??'',signal);
  if(item.kind==='track')return {items:[],total:0,page:1,pages:1};
  const options={kind:item.kind==='artist'?'album' as const:'track' as const,
   ...(item.kind==='artist'?{artistId:item.id}:{albumId:item.id}),limit:PAGE_SIZE};
  let page=requested;
  // Recheck each response: the source may shrink again while correcting a stale page.
  for(let attempt=0;attempt<3;attempt++){
   signal?.throwIfAborted();
   const result=await musicLibrary(userId,connection,{...options,offset:(page-1)*PAGE_SIZE},signal);
   const bounds=pagination(result.total,page);
   if(!result.total)return {items:[],total:0,...bounds};
   if(bounds.page===page)return {items:result.items.map(child=>musicCard(child,connection)),total:result.total,...bounds};
   page=bounds.page;
  }
  throw new AppError(409,'The music library changed. Try loading this page again.');
 }
 v.parse(v.pipe(v.string(),v.uuid()),id);const db=getDb();
 const [album]=await db.select().from(musicWorks).where(eq(musicWorks.id,id));if(!album)throw new AppError(404,'Music not found.');
 const [count]=await db.execute<{total:number}>(sql`select count(*)::int as total from (${musicAlbumMembersSql(sql`${id}::uuid`)}) members`);
 const {page,pages}=pagination(count.total,requested),members=await musicAlbumMembers(id,db,PAGE_SIZE,(page-1)*PAGE_SIZE);
 const rows=members.length?await db.select().from(musicWorks).where(sql`${musicWorks.id} in (${sql.join(members.map(member=>sql`${member.id}::uuid`),sql`,`)})`):[];
 const byId=new Map(rows.map(row=>[row.id,row]));
 const items:MusicItem[]=members.map(member=>{const row=byId.get(member.id)!;return {
  id:row.id,workId:row.id,kind:row.kind,title:row.title,artistNames:row.artistNames,artists:[],albumArtists:[],genres:row.genres,externalIds:{},
  durationSeconds:row.durationSeconds??undefined,year:row.year??undefined,albumId:id,album:album.title,
  entryId:member.entryId,discNumber:member.discNumber??undefined,trackNumber:member.trackNumber??undefined,
 };});
 const hydrated=await personaliseMusicItems(userId,await hydrateMusicItems(userId,items));
 return {items:hydrated.map(item=>musicCard(item,'')),total:count.total,page,pages};
}
