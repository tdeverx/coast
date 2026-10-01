import {error} from '@sveltejs/kit';
import {eq,and,asc,sql} from 'drizzle-orm';
import * as v from 'valibot';
import {getDb} from '$lib/server/db';
import {musicWorks,mediaRelationships,providerItems,providerConnections,providerInstances,musicProgress,trackingState} from '$lib/server/db/schema';
import {PAGE_SIZE,pagination,pageNumberSchema} from '$lib/server/queries/pagination';
import type {MusicItem} from '$lib/music/model';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,params,url})=>{
 const id=v.parse(v.pipe(v.string(),v.uuid()),params.id),requested=v.parse(pageNumberSchema,Number(url.searchParams.get('page')??1)),db=getDb();
 const [work]=await db.select().from(musicWorks).where(eq(musicWorks.id,id));if(!work)error(404,'Music not found.');
 const [parent]=await db.select({id:musicWorks.id,title:musicWorks.title}).from(mediaRelationships).innerJoin(musicWorks,eq(musicWorks.id,mediaRelationships.parentId)).where(and(eq(mediaRelationships.childId,id),eq(mediaRelationships.kind,'contains'),eq(musicWorks.kind,'album'))).limit(1);
 const toItem=(m:typeof work):MusicItem=>({id:m.id,workId:m.id,kind:m.kind,title:m.title,artistNames:m.artistNames,artists:[],albumArtists:[],genres:m.genres,externalIds:{},durationSeconds:m.durationSeconds??undefined,year:m.year??undefined,releaseDate:m.releaseDate??undefined,overview:m.overview??undefined});
 const [progress]=locals.user?await db.select().from(musicProgress).where(and(eq(musicProgress.userId,locals.user.id),eq(musicProgress.trackId,id))):[];
 const [state]=locals.user?await db.select().from(trackingState).where(and(eq(trackingState.userId,locals.user.id),eq(trackingState.mediaId,id))):[];
 const item={...toItem(work),playCount:progress?.playCount??0,positionSeconds:progress?.positionSeconds??0,favourite:state?.favourite??false};if(parent){item.albumId=parent.id;item.album=parent.title;}
 const [image]=locals.user?await db.select({item:providerItems,connectionId:providerConnections.id}).from(providerItems).innerJoin(providerConnections,eq(providerConnections.instanceId,providerItems.instanceId)).innerJoin(providerInstances,eq(providerInstances.id,providerItems.instanceId)).where(and(eq(providerItems.mediaId,id),eq(providerConnections.userId,locals.user.id),eq(providerConnections.status,'connected'),eq(providerInstances.enabled,true))).limit(1):[];
 if(image?.item.snapshot.primaryImageTag)item.artworkUrl=`/api/v1/providers/${image.connectionId}/music/${image.item.externalId}/artwork`;
 const [count]=await db.select({total:sql<number>`count(*)::int`}).from(mediaRelationships).where(and(eq(mediaRelationships.parentId,id),eq(mediaRelationships.kind,'contains')));
 const {page,pages}=pagination(count.total,requested);
 const children=await db.select({work:musicWorks,position:mediaRelationships.position}).from(mediaRelationships).innerJoin(musicWorks,eq(musicWorks.id,mediaRelationships.childId)).where(and(eq(mediaRelationships.parentId,id),eq(mediaRelationships.kind,'contains'))).orderBy(asc(mediaRelationships.position),asc(musicWorks.id)).limit(PAGE_SIZE).offset((page-1)*PAGE_SIZE);
 return {item,connectionId:'',children:{items:children.map(({work,position})=>({...toItem(work),discNumber:Math.floor(position/10000),trackNumber:position%10000})),total:count.total,nextOffset:page<pages?page*PAGE_SIZE:null},failure:'',page,pages};
};
