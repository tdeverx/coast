import {error} from '@sveltejs/kit';
import * as v from 'valibot';
import {AppError} from '$lib/server/security/errors';
import {friends,recommendations} from '$lib/social/service.server';
import {activityFeed} from '$lib/social/queries.server';
import {friendInsights,friendDiscovery} from '$lib/social/insights.server';
import {workCards} from '$lib/collection/query.server';
import {presence} from '$lib/social/presence.server';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,url})=>{
 const user=locals.user!;const view=url.searchParams.get('view')??'activity',page=Number(url.searchParams.get('page')??1);
 if(!['activity','friends','recommendations','insights'].includes(view)||!Number.isInteger(page)||page<1||page>100000)error(400,'Choose a valid friends view and page.');
 const roster=await friends(user.id,page),recs=view==='recommendations'?await recommendations(user.id,page,url.searchParams.get('available')==='true'):[];
 const popular=view==='insights'?await friendDiscovery(user.id):[];
 const friendId=url.searchParams.get('friendId');
 const medium=url.searchParams.get('medium')??'all',overlap=url.searchParams.get('overlap')??'shared';
 if(!['all','movies','tv','music','game'].includes(medium)||!['shared','onlyYou','onlyFriend'].includes(overlap))error(400,'Choose a valid overlap view.');
 if(friendId&&!v.safeParse(v.pipe(v.string(),v.uuid()),friendId).success)error(400,'Choose a valid friend.');
 let comparison=null;
 if(view==='insights'&&friendId){try{comparison=await friendInsights(user.id,friendId);}catch(failure){if(failure instanceof AppError)error(failure.status,failure.message);throw failure;}}
 const overlapIds=comparison?.media.filter(m=>medium==='all'||m.medium===medium).flatMap(m=>m.overlap[overlap as 'shared'|'onlyYou'|'onlyFriend'])??[];
 return {view,page,medium,overlap,overlapTotal:overlapIds.length,overlapPages:Math.max(1,Math.ceil(overlapIds.length/60)),overlapItems:await workCards(user.id,user.id,overlapIds.slice((page-1)*60,page*60)),roster:roster.slice(0,60),moreFriends:roster.length>60,recommendations:recs.slice(0,60),moreRecommendations:recs.length>60,
 feed:view==='activity'?await activityFeed(user.id,{category:url.searchParams.get('category')??'all'}):null,
 recommendationItems:await workCards(user.id,user.id,recs.map((r:{workId:string})=>r.workId)),
 popularItems:await workCards(user.id,user.id,popular.map((r:{workId:string})=>r.workId)),
 comparison,
 presence:await presence(user.id),
 ownCheckin:(await (await import('$lib/server/db')).getSql()`select id,work_id as "workId",expires_at as "expiresAt" from social_checkins where user_id=${user.id} and state='active'`)[0]??null};
};
