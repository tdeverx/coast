import {eq} from 'drizzle-orm';
import {getDb} from '$lib/server/db';
import {works} from '$lib/server/db/schema';
import {AppError} from '$lib/server/security/errors';
import {readingDetails} from '$lib/reading/query.server';
import {gameDetailData,gameProviderDetailData} from '$lib/games/detail.server';
import {musicDetailData,musicSourceDetailData} from '$lib/music/detail.server';
import {detailsData} from '$lib/server/queries/media';
import {loadMediaDetails} from '$lib/application/media-details.server';
import {mediaDetailTarget,screenDetailChildren} from '$lib/media/detail-target';
import {readingRemoteDetail} from '$lib/reading/query.server';
import {readingGroupDetail} from '$lib/reading/groups.server';
import {personDetailData} from '$lib/catalogue/details.server';
/** One canonical identity, with the same medium loader used by its full-page route. */
export async function workDetailData(userId:string,id:string,options:{page?:number;playthrough?:string|null;section?:string|null;enhance?:boolean}={},signal?:AbortSignal){
 const [work]=await getDb().select({category:works.category}).from(works).where(eq(works.id,id)).limit(1);
 if(!work)throw new AppError(404,'This title was not found.','not_found');
 if(work.category==='game')return {kind:'game' as const,data:await gameDetailData(userId,id,options.playthrough)};
 if(work.category==='music')return {kind:'music' as const,data:await musicDetailData(userId,id,options.page)};
 if(work.category==='book'||work.category==='comic'){
  const detail=await readingDetails(userId,id);
  return {kind:'reading' as const,data:{...detail,kind:detail.item.kind,remote:false}};
 }
 const includeChildren=screenDetailChildren(options.section);
 return {kind:'screen' as const,data:options.enhance
  ? await (await loadMediaDetails(userId,id,signal,includeChildren)).enhancement
  : await detailsData(userId,id,includeChildren)};
}
/** Explicit route dispatch only: never fetch a client-supplied URL. */
export async function mediaDetailData(userId:string,href:string,signal?:AbortSignal,enhance=false){
 const target=mediaDetailTarget(href,new URL('http://coast.invalid/'));
 if(!target)throw new AppError(400,'Choose a supported media detail link.','invalid_request');
 switch(target.kind){
  case 'work':return workDetailData(userId,target.id,{...target,enhance},signal);
  case 'reading-provider':return {kind:'reading' as const,data:await readingRemoteDetail(userId,target.provider==='openlibrary'?'book':'comic',target.id)};
  case 'reading-group':return {kind:'reading-group' as const,data:await readingGroupDetail(userId,target.id)};
  case 'game-provider':return {kind:'remote-game' as const,data:await gameProviderDetailData(userId,target.instanceId,target.id)};
  case 'music-source':return {kind:'music' as const,data:await musicSourceDetailData(userId,target.connectionId,target.id,target.page,signal)};
  case 'person':return {kind:'person' as const,data:await personDetailData(userId,Number(target.id))};
 }
}
