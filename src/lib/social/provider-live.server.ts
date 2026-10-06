import { eq } from 'drizzle-orm';
import { getDb,getSql } from '$lib/server/db';
import { providerConnections,socialLiveState } from '$lib/server/db/schema';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { getSteam } from '$lib/providers/steam/connection.server';
import {liveObservationExpiry} from './live-freshness.server';
import { PermanentActionError } from '$lib/server/queue';

/** Observe current sessions only. Completed plays remain the history importer's responsibility. */
export async function pollProviderLive(userId:string,connectionId:string,provider:'jellyfin'|'steam') {
 return pollProviderLiveFromContext(userId,connectionId,provider,provider==='jellyfin'?await getJellyfin(userId,connectionId):await getSteam(userId,connectionId));
}
export async function pollProviderLiveFromContext(userId:string,connectionId:string,provider:'jellyfin'|'steam',context:Awaited<ReturnType<typeof getJellyfin>>|Awaited<ReturnType<typeof getSteam>>){
 const {connection,instance}=context;
 if(connection.userId!==userId || connection.id!==connectionId)throw new PermanentActionError('The connected account changed.');
 if(connection.settings.liveRead===false)return;
 let workId:string|null=null,remoteId:string|null=null;
 if(provider==='jellyfin'){
   const {adapter}=context as Awaited<ReturnType<typeof getJellyfin>>;
   const sessions=await adapter.sessions(connection.externalUserId!);
   const current=sessions.find(s=>s.NowPlayingItem && !s.PlayState?.IsPaused);
   remoteId=current?.NowPlayingItem?.Id??null;
   if(remoteId){
     const [work]=await getSql()`select media_id as id from provider_items where instance_id=${instance.id} and external_id=${remoteId} union select work_id as id from work_editions where instance_id=${instance.id} and external_id=${remoteId} limit 1`;
     workId=work?.id??null;
   }
 }else{
   const {adapter}=context as Awaited<ReturnType<typeof getSteam>>;
   remoteId=(await adapter.profile(connection.externalUserId!)).playingId;
   if(remoteId){const [work]=await getSql()`select game_id as id from game_external_ids where provider='steam' and external_id=${remoteId} limit 1`;workId=work?.id??null;}
 }
 const now=new Date();
 const expiresAt=remoteId?await liveObservationExpiry(instance,now):null;
 await getDb().transaction(async tx=>{
   const [current]=await tx.select().from(providerConnections).where(eq(providerConnections.id,connectionId)).for('update');
   if(!current || current.accountGeneration!==connection.accountGeneration || current.status!=='connected')throw new PermanentActionError('The connected account changed.');
   const value={connectionId,accountGeneration:connection.accountGeneration,workId,remoteId,expiresAt,checkedAt:now};
   await tx.insert(socialLiveState).values(value).onConflictDoUpdate({target:socialLiveState.connectionId,set:value});
 });
 return {checked:1,refreshed:workId?1:0,deferred:remoteId&&!workId?1:0};
}
