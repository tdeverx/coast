import * as v from 'valibot';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { providerConnections } from '$lib/server/db/schema';
import { getInstance, instanceTransport } from '../instances.server';
import { connectionFor } from '../connections.server';
import { decryptCredential, encryptCredential } from '$lib/server/security/credentials';
import { secureProviderFetch } from '$lib/server/security/provider-fetch';
import { AppError } from '$lib/server/security/errors';
import { enqueueAction } from '$lib/server/queue';
import { SteamAdapter, steamIdSchema } from './adapter.server';
const uuid=v.pipe(v.string(),v.uuid());
const OPENID='https://steamcommunity.com/openid/login';
const NS='http://specs.openid.net/auth/2.0';
const pendingSchema=v.object({state:uuid,returnTo:v.string(),expires:v.number()});
export async function steamAdapter(instanceId:string) {
  const instance=await getInstance(v.parse(uuid,instanceId),'steam');
  if(!instance.credentials)throw new AppError(409,'Configure the Steam Web API key first.');
  const credentials=v.parse(v.object({apiKey:v.pipe(v.string(),v.regex(/^[a-f0-9]{32}$/i))}),JSON.parse(await decryptCredential(instance.credentials)));
  return {instance,adapter:new SteamAdapter(instanceTransport(instance),credentials.apiKey)};
}
export async function getSteam(userId:string,connectionId:string) {
  const {connection}=await connectionFor(userId,connectionId,'steam');
  v.parse(steamIdSchema,connection.externalUserId);
  return {...await steamAdapter(connection.instanceId),connection};
}
export function steamLoginUrl(returnTo:string) {
  const origin=new URL(returnTo).origin;
  return OPENID+'?'+new URLSearchParams({'openid.ns':NS,'openid.mode':'checkid_setup','openid.return_to':returnTo,'openid.realm':origin+'/','openid.identity':NS+'/identifier_select','openid.claimed_id':NS+'/identifier_select'});
}
/** Validate signed assertions before contacting the fixed Steam verification endpoint. */
export function steamAssertion(parameters:URLSearchParams,returnTo:string,now=Date.now()) {
  const get=(key:string)=>parameters.get('openid.'+key);
  if(get('ns')!==NS||get('mode')!=='id_res'||get('op_endpoint')!==OPENID||get('return_to')!==returnTo||get('identity')!==get('claimed_id'))throw new AppError(400,'Steam account verification failed. Start linking again.');
  const required=['op_endpoint','claimed_id','identity','return_to','response_nonce','assoc_handle'];
  const signed=get('signed')?.split(',')??[];
  if(required.some(key=>!signed.includes(key))||!get('sig'))throw new AppError(400,'Steam returned an unsigned account identity.');
  const nonce=get('response_nonce')??'';
  const time=Date.parse(nonce.slice(0,20));
  if(!Number.isFinite(time)||time>now+60000||now-time>600000)throw new AppError(400,'Steam sign-in expired. Start linking again.');
  const id=get('claimed_id')?.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/)?.[1];
  if(!id || !v.safeParse(steamIdSchema,id).success)throw new AppError(400,'Steam returned an invalid account identity.');
  const verification=new URLSearchParams();
  for(const [key,value] of parameters)if(key.startsWith('openid.')){
    if(parameters.getAll(key).length!==1)throw new AppError(400,'Steam returned duplicate verification fields.');
    verification.set(key,value);
  }
  verification.set('openid.mode','check_authentication');
  return {id,verification};
}
export async function startSteam(userId:string,instanceId:string,origin:string) {
  await steamAdapter(instanceId);
  const state=crypto.randomUUID(),returnTo=origin+'/connections/steam/callback?'+new URLSearchParams({instance:instanceId,state});
  const credentials=await encryptCredential(JSON.stringify({state,returnTo,expires:Date.now()+600000}));
  await getDb().transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(73001602)`);
    const [current]=await tx.select().from(providerConnections).where(and(eq(providerConnections.userId,userId),eq(providerConnections.instanceId,instanceId))).for('update');
    if(current?.status==='connected')throw new AppError(409,'Disconnect your current Steam account before linking another.');
    await tx.insert(providerConnections).values({userId,instanceId,status:'disconnected',credentials})
      .onConflictDoUpdate({target:[providerConnections.userId,providerConnections.instanceId],set:{credentials,updatedAt:new Date()}});
  });
  return {url:steamLoginUrl(returnTo)};
}
export async function finishSteam(userId:string,url:URL) {
  const instanceId=v.parse(uuid,url.searchParams.get('instance')),state=v.parse(uuid,url.searchParams.get('state'));
  const {adapter}=await steamAdapter(instanceId);
  const [pending]=await getDb().select().from(providerConnections).where(and(eq(providerConnections.userId,userId),eq(providerConnections.instanceId,instanceId),eq(providerConnections.status,'disconnected')));
  if(!pending?.credentials)throw new AppError(409,'Start Steam account linking first.');
  const challenge=v.parse(pendingSchema,JSON.parse(await decryptCredential(pending.credentials)));
  if(challenge.state!==state||challenge.expires<Date.now()||new URL(challenge.returnTo).origin!==url.origin)throw new AppError(400,'Steam sign-in expired or belongs to another browser request.');
  const {id,verification}=steamAssertion(url.searchParams,challenge.returnTo);
  const response=await secureProviderFetch({baseUrl:'https://steamcommunity.com',provider:'steam',approved:true,allowedPorts:[443],maxResponseBytes:4096},'/openid/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:verification.toString()});
  if(!response.ok||!(await response.text()).split(/\r?\n/).includes('is_valid:true'))throw new AppError(400,'Steam could not verify this sign-in. Start linking again.');
  const profile=await adapter.profile(id);
  const connection=await getDb().transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(73001602)`);
    const [current]=await tx.select().from(providerConnections).where(eq(providerConnections.id,pending.id)).for('update');
    if(!current||current.status!=='disconnected'||current.credentials!==pending.credentials)throw new AppError(409,'This Steam linking request has already been used or replaced.');
    const settings=current.externalUserId===id?{...current.settings}:{importOwned:true,importPlaytime:true,importAchievements:true};
    const [saved]=await tx.update(providerConnections).set({externalUserId:id,username:profile.username,credentials:await encryptCredential('{}'),status:'connected',settings,updatedAt:new Date()}).where(eq(providerConnections.id,current.id)).returning();
    return saved;
  });
  await enqueueAction({userId,connectionId:connection.id,kind:'steam.sync',payload:{}});
  return {id:connection.id,username:profile.username};
}

export async function updateSteamImports(userId:string,connectionId:string,raw:unknown) {
  const settings=v.parse(v.strictObject({importOwned:v.boolean(),importPlaytime:v.boolean(),importAchievements:v.boolean()}),raw);
  const {connection}=await connectionFor(userId,connectionId,'steam');
  const updated=await getDb().update(providerConnections).set({settings:sql`${providerConnections.settings} || ${settings}::jsonb`,updatedAt:new Date()}).where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId),eq(providerConnections.accountGeneration,connection.accountGeneration!))).returning({id:providerConnections.id});
  if(!updated.length)throw new AppError(409,'The Steam account changed. Reload its settings.');
  return {ok:true};
}
