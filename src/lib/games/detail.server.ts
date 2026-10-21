import {gameDetails,playthroughSummary} from '#lib/core/games/service.server.js';
import {listProviders} from '#lib/providers/instances.server.js';
import {DomainError} from '#lib/core/errors.js';
import {requireFeature} from '#lib/server/features.js';
import {igdbDetails} from '#lib/providers/igdb/service.server.js';
export async function gameProviderDetailData(userId:string,instanceId:string,id:string){
 await requireFeature(userId,'game');
 return {item:await igdbDetails(instanceId,id),instanceId};
}
/** Commands retain the selected playthrough; route and overlay share authorization and data. */
export async function gameDetailData(userId:string|null,id:string,selected:string|null=null){
 const item=await gameDetails(userId,id);
 const playthroughId=selected??item.playthroughs[0]?.id;
 const playthrough=playthroughId&&userId?await playthroughSummary(userId,playthroughId):null;
 if(playthrough&&playthrough.gameId!==item.id)throw new DomainError('Playthrough not found.',404,'not_found');
 const sources=(userId?await listProviders(userId):[]).filter(source=>source.provider==='igdb'&&source.configured);
 return {item,playthrough,sources};
}
