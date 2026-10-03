import { categoryEnabled } from '$lib/experimental';
import { readJsonBody } from '$lib/server/security/request-body';
import { encryptCredential,decryptCredential } from '$lib/server/security/credentials';
import * as v from 'valibot';
import { createHash } from 'node:crypto';
import { and,eq,sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { apiIdempotency,apiTokens,users,works } from '$lib/server/db/schema';
import { AppError } from '$lib/server/security/errors';
import { trackingInputSchema,bulkTrackingInputSchema } from '$lib/core/tracking/service';
import { trackWithExports,bulkTrackWithExports,rateWithExports } from '$lib/sync/changes';
import { ratingInputSchema } from '$lib/core/ratings/service';
import { logMusic } from '$lib/music/persistence.server';
import { createPlaythrough,updatePlaythrough,logGameSession } from '$lib/core/games/service';
import { createWebhook,removeWebhook } from './webhooks.server';
import type { authenticateApiToken } from './tokens.server';
import { getConfig } from '$lib/server/config';

const uuid=v.pipe(v.string(),v.uuid());
export function canonicalJson(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;return JSON.stringify(value);}
export async function publicMutation(user:Awaited<ReturnType<typeof authenticateApiToken>>,request:Request,url:URL,path:string[]){
 const route=path.join('/'),method=request.method;
 let scope:string;
 if(method==='POST'&&['tracking','tracking/bulk'].includes(route))scope='tracking:write';
 else if(method==='PUT'&&path.length===2&&path[0]==='relationships')scope='relationships:write';
 else if(method==='PUT'&&path.length===2&&path[0]==='ratings')scope='ratings:write';
 else if(method==='POST'&&path.length===3&&path[0]==='music'&&path[2]==='listens')scope='music:write';
 else if((method==='POST'&&path.length===3&&path[0]==='games'&&path[2]==='playthroughs')||(method==='PATCH'&&path.length===2&&path[0]==='playthroughs')||(method==='POST'&&path.length===3&&path[0]==='playthroughs'&&path[2]==='sessions'))scope='games:write';
 else if((method==='POST'&&route==='webhooks')||(method==='DELETE'&&path.length===2&&path[0]==='webhooks'))scope='webhooks:manage';
 else throw new AppError(405,'This method is not supported on this endpoint.','method_not_allowed');
 if(!user.scopes.includes(scope))throw new AppError(403,`This endpoint requires ${scope}.`,'insufficient_scope');
 if(url.searchParams.size)throw new AppError(400,'Writes do not accept query parameters.','invalid_input');
 const key=request.headers.get('idempotency-key')??'';
 if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(key))throw new AppError(400,'Supply an Idempotency-Key (1–128 letters, numbers, dots, underscores, colons or hyphens).','idempotency_required');
 const data=method==='DELETE'?{}:await readJsonBody(request,65536,false);
 if(['source','sourceEventId','userId'].some(key=>key in data))throw new AppError(400,'Source and owner are assigned by Coast.','invalid_input');
 const hash=createHash('sha256').update(`${method}:${route}:${canonicalJson(data)}`).digest('hex');
 const config=await getConfig();
 return getDb().transaction(async tx=>{
  // Lock the account before replay state: the same order as concrete tracking writes.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${user.id},0))`);
  const [token]=await tx.select({id:apiTokens.id}).from(apiTokens).innerJoin(users,eq(users.id,apiTokens.userId)).where(and(eq(apiTokens.id,user.tokenId),eq(apiTokens.userId,user.id),sql`${apiTokens.revokedAt} is null and ${apiTokens.expiresAt}>now()`,eq(users.disabled,false))).for('update');
  if(!token)throw new AppError(401,'This token is invalid or expired.','invalid_token');
  const [replay]=await tx.select().from(apiIdempotency).where(and(eq(apiIdempotency.tokenId,user.tokenId),eq(apiIdempotency.key,key)));
  if(replay){if(replay.requestHash!==hash)throw new AppError(409,'This idempotency key belongs to a different request.','idempotency_conflict');return {response:JSON.parse(await decryptCredential(replay.response)),status:replay.status,replayed:true};}
  let result:unknown;
  if(scope==='tracking:write'){
   if(route==='tracking/bulk')result=await bulkTrackWithExports(user.id,v.parse(v.strictObject(bulkTrackingInputSchema.entries),data),tx);
   else {const input=v.parse(v.strictObject(trackingInputSchema.entries),{...data,source:'coast'});if(['watchlist','collect','favourite'].includes(input.action))throw new AppError(400,'Use the relationships endpoint.','invalid_input');result=await trackWithExports(user.id,input,tx);}
   // Only public state fields are returned; internal projections and event notes stay private.
   const changed=(result as {changed:boolean}).changed;
   result={changed};
  }else if(scope==='relationships:write'||scope==='ratings:write'||scope==='music:write'){
   const id=v.parse(uuid,path[1]);const [work]=await tx.select().from(works).where(eq(works.id,id));
   if(!work||!categoryEnabled(config,work.category))throw new AppError(404,'Work not found.','not_found');
   if(scope==='relationships:write'){const input=v.parse(v.strictObject({relationship:v.picklist(['collected','saved','favourite']),value:v.boolean()}),data);const action=({collected:'collect',saved:'watchlist',favourite:'favourite'} as const)[input.relationship];const changed=await trackWithExports(user.id,{mediaId:id,action,value:input.value},tx);result={changed:changed.changed};}
   else if(scope==='ratings:write'){const input=v.parse(v.strictObject({value:ratingInputSchema.entries.value}),data);await rateWithExports(user.id,{mediaId:id,value:input.value},tx);result={workId:id,value:input.value};}
   else result=await logMusic(user.id,id,data,tx);
  }else if(scope==='games:write'){
   if(!config.experimentalGaming)throw new AppError(404,'Games are disabled.','not_found');
   const id=v.parse(uuid,path[1]);const row=path[0]==='games'?await createPlaythrough(user.id,id,data,tx):method==='PATCH'?await updatePlaythrough(user.id,id,data,tx):await logGameSession(user.id,id,data,tx);
   result={id:row.id};
  }else result=method==='POST'?await createWebhook(tx,user.id,user.tokenId,data):await removeWebhook(tx,user.id,v.parse(uuid,path[1]));
  const response=JSON.parse(JSON.stringify(result??{ok:true})),status=method==='POST'&&['music:write','games:write','webhooks:manage'].includes(scope)?201:200;
  await tx.insert(apiIdempotency).values({tokenId:user.tokenId,key,requestHash:hash,response:await encryptCredential(JSON.stringify(response)),status});
  return {response,status,replayed:false};
 });
}
