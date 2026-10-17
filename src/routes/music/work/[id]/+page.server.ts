import {personaliseMusicItems} from '$lib/music/service.server';
import {error} from '@sveltejs/kit';
import {eq,and} from 'drizzle-orm';
import * as v from 'valibot';
import {getDb} from '$lib/server/db';
import {musicWorks,mediaRelationships} from '$lib/server/db/schema';
import {pageNumberSchema} from '$lib/server/queries/pagination';
import type {MusicItem} from '$lib/music/model';

import {hydrateMusicItems} from '$lib/music/presentation.server';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,params,url, depends})=>{
  depends('coast:tracking');

 const id=v.parse(v.pipe(v.string(),v.uuid()),params.id),requested=v.parse(pageNumberSchema,Number(url.searchParams.get('page')??1)),db=getDb();
 const [work]=await db.select().from(musicWorks).where(eq(musicWorks.id,id));if(!work)error(404,'Music not found.');
 const [parent]=await db.select({id:musicWorks.id,title:musicWorks.title}).from(mediaRelationships).innerJoin(musicWorks,eq(musicWorks.id,mediaRelationships.parentId)).where(and(eq(mediaRelationships.childId,id),eq(mediaRelationships.kind,'contains'),eq(musicWorks.kind,'album'))).limit(1);
 const toItem=(m:typeof work):MusicItem=>({id:m.id,workId:m.id,kind:m.kind,title:m.title,artistNames:m.artistNames,artists:[],albumArtists:[],genres:m.genres,externalIds:{},durationSeconds:m.durationSeconds??undefined,year:m.year??undefined,releaseDate:m.releaseDate??undefined,overview:m.overview??undefined});
 const item=toItem(work);if(parent){item.albumId=parent.id;item.album=parent.title;}
 const [presented]=await personaliseMusicItems(locals.user?.id??null,await hydrateMusicItems(locals.user?.id??null,[item]));
 return {item:presented,connectionId:'',page:requested,pages:1,failure:'',children:{items:[],total:0,nextOffset:null}};
};
