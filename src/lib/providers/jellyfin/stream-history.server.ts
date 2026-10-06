import {getSql} from '$lib/server/db';
import {getJellyfin} from './connection.server';
import {PermanentActionError,tagDiagnosticStage,type OutboxAction} from '$lib/server/queue';
import {ProviderHttpError} from '$lib/server/security/provider-fetch';
import type {streamPresentation} from './streams';
export type ServerStream=NonNullable<ReturnType<typeof streamPresentation>>;
type Capture={connectionId:string;generation:string;checkedAt:Date;action?:Pick<OutboxAction,'id'|'attempts'>};
/** Publish only a current account/worker observation. An unsuccessful read never ends sessions. */
export async function recordServerStreams(source:Capture,streams:ServerStream[]|null,error:string|null=null){
 return getSql().begin(async sql=>{
  const [account]=await sql<{instance_id:string}[]>`select c.instance_id from provider_connections c join users u on u.id=c.user_id join provider_instances i on i.id=c.instance_id where c.id=${source.connectionId} and c.account_generation=${source.generation} and c.status='connected' and u.role='admin' and not u.disabled and i.enabled and i.provider='jellyfin' for share of c,u,i`;
  if(!account)return false;
  if(source.action){const [lease]=await sql`select id from outbox_actions where id=${source.action.id} and attempts=${source.action.attempts} and state='running' for share`;if(!lease)return false;}
  await sql`select pg_advisory_xact_lock(hashtextextended(${`server-streams:${account.instance_id}`},0))`;
  const [previous]=await sql`select checked_at from server_stream_scans where instance_id=${account.instance_id}`;
  if(previous&&new Date(previous.checked_at)>=source.checkedAt)return false;
  if(streams!==null){
   const current=await sql<{id:string;session_id:string;external_item_id:string}[]>`select id,session_id,external_item_id from server_stream_sessions where instance_id=${account.instance_id} and ended_at is null`;
   const byId=new Map(streams.map(stream=>[stream.id,stream]));
   for(const row of current)if(byId.get(row.session_id)?.externalId!==row.external_item_id)await sql`update server_stream_sessions set ended_at=${source.checkedAt} where id=${row.id}`;
   for(const stream of byId.values())await sql`insert into server_stream_sessions(instance_id,session_id,external_item_id,snapshot,first_seen_at,last_seen_at) values(${account.instance_id},${stream.id},${stream.externalId},${stream}::jsonb,${source.checkedAt},${source.checkedAt}) on conflict(instance_id,session_id) where ended_at is null do update set snapshot=excluded.snapshot,last_seen_at=excluded.last_seen_at`;
  }
  await sql`insert into server_stream_scans(instance_id,connection_id,account_generation,checked_at,last_error) values(${account.instance_id},${source.connectionId},${source.generation},${source.checkedAt},${error}) on conflict(instance_id) do update set connection_id=excluded.connection_id,account_generation=excluded.account_generation,checked_at=excluded.checked_at,last_error=excluded.last_error`;
  return true;
 });
}
export async function scanServerStreams(action:OutboxAction){
 if(!action.connectionId||!action.accountGeneration)throw new PermanentActionError('The server streams account is unavailable.');
 const source={connectionId:action.connectionId,generation:action.accountGeneration,checkedAt:new Date(),action};
 let stage='streams-account';
 try{
  const sql=getSql();
  const [admin]=await sql`select c.id from provider_connections c join users u on u.id=c.user_id where c.id=${action.connectionId} and c.user_id=${action.userId} and c.account_generation=${action.accountGeneration} and c.status='connected' and u.role='admin' and not u.disabled`;
  if(!admin)throw new PermanentActionError('Server streams requires a connected administrator account.');
  stage='streams-connection';
  const {adapter,connection}=await getJellyfin(action.userId,action.connectionId);
  stage='streams-permissions';
  if((await adapter.userForProvisioning(connection.externalUserId!)).Policy.IsAdministrator!==true)throw new PermanentActionError('The server streams source must be a Jellyfin administrator.');
  stage='streams-sessions';
  const streams=await adapter.activeStreams();
  stage='streams-recording';
  await recordServerStreams(source,streams);
  return {checked:streams.length};
 }catch(error){
  tagDiagnosticStage(error,stage);
  const message=error instanceof PermanentActionError?error.message:error instanceof ProviderHttpError&&[401,403].includes(error.status)?'Jellyfin denied access. Check the server streams account permissions.':'Server scan failed. Previous sessions are retained until a successful scan.';
  // Keep the original failure if recording itself is unavailable.
  if(stage!=='streams-recording')try{await recordServerStreams(source,null,message);}catch{/* The worker records the original failure and execution stage. */}
  throw error;
 }
}
