import {error} from '@sveltejs/kit';
import * as v from 'valibot';
import {AppError} from '$lib/server/security/errors';
import {friendInsights} from '$lib/social/insights.server';
import {workCards} from '$lib/collection/query.server';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,url,params,depends})=>{
  depends('coast:social');

 const user=locals.user!;const page=Number(url.searchParams.get('page')??1);
 if(!Number.isInteger(page)||page<1||page>100000)error(400,'Choose a valid friends view and page.');
 const friendId=params.friendId;
 const medium=url.searchParams.get('medium')??'all',overlap=url.searchParams.get('overlap')??'shared';
 if(!['all','movies','tv','music','game'].includes(medium)||!['shared','onlyYou','onlyFriend'].includes(overlap))error(400,'Choose a valid overlap view.');
 if(friendId&&!v.safeParse(v.pipe(v.string(),v.uuid()),friendId).success)error(400,'Choose a valid friend.');
 let comparison=null;
 if(friendId){try{comparison=await friendInsights(user.id,friendId);}catch(failure){if(failure instanceof AppError)error(failure.status,failure.message);throw failure;}}
 const overlapIds=comparison?.media.filter(m=>medium==='all'||m.medium===medium).flatMap(m=>m.overlap[overlap as 'shared'|'onlyYou'|'onlyFriend'])??[];
 return {page,medium,overlap,overlapTotal:overlapIds.length,overlapPages:Math.max(1,Math.ceil(overlapIds.length/60)),overlapItems:await workCards(user.id,user.id,overlapIds.slice((page-1)*60,page*60)),
 comparison,
 username:(await (await import('$lib/server/db')).getSql()`select username from users where id=${friendId}::uuid`)[0]?.username??''};
};
