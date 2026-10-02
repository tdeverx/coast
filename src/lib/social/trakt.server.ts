import {and,eq} from 'drizzle-orm';
import {getDb,getSql} from '$lib/server/db';
import {socialLiveState,socialLiveDeliveries,providerConnections,externalIds} from '$lib/server/db/schema';
import {getTrakt} from '$lib/providers/trakt/connection.server';
import {providerSchedule} from '$lib/providers/schedule';
import { resolveTrakt } from '$lib/catalogue/trakt-identity.server';
import {reconcileProviderValue} from '$lib/sync/values';
import {trackInTransaction} from '$lib/core/tracking/service';
import {PermanentActionError} from '$lib/server/queue';
type TraktContext=Awaited<ReturnType<typeof getTrakt>>;
export async function pollLive(userId:string,connectionId:string) {
 return pollLiveFromAdapter(userId,connectionId,await getTrakt(userId,connectionId));
}
export async function pollLiveFromAdapter(userId:string,connectionId:string,{adapter,connection,instance,sync}:TraktContext) {
 if(connection.settings.liveRead===false)return;
 const schedule=providerSchedule('trakt',instance.settings.schedule),db=getDb();
 const [previous]=await db.select().from(socialLiveState).where(eq(socialLiveState.connectionId,connectionId));
 const remote=await adapter.watching(),now=new Date();
 const work=remote?await resolveTrakt(remote):null;
 const expires=remote?new Date(Math.min(Date.parse(remote.expires_at),now.getTime()+2*schedule.liveActiveMinutes*60000)):null;
 const since=previous?.accountGeneration===connection.accountGeneration&&previous.historyCursor?new Date(Math.max(previous.historyCursor.getTime()-60000,Date.now()-30*86400000)).toISOString():new Date(Date.now()-10*60000).toISOString();
 if(sync.history)for(const record of await adapter.recentHistory(since)){
  if(!record.id||!record.watched_at)continue;
  const item=await resolveTrakt(record);if(!item)continue;
  // A confirmed Coast check-in supplies its own canonical completion, not a second imported play.
  const [own]=await getSql()`select d.checkin_id from social_live_deliveries d join social_checkins c on c.id=d.checkin_id where d.connection_id=${connectionId} and d.account_generation=${connection.accountGeneration} and d.remote_id=${String(record.id)} and c.work_id=${item.id}`;
  if(own)continue;
  const [playback]=await getSql()`select session_id from social_scrobble_deliveries where connection_id=${connectionId} and account_generation=${connection.accountGeneration} and work_id=${item.id} and remote_id=${String(record.id)}`;
  if(playback)continue;
  await reconcileProviderValue(userId,connectionId,item.id,'history',{value:true},{source:'trakt',accountGeneration:connection.accountGeneration,occurredAt:record.watched_at,apply:tx=>trackInTransaction(tx,userId,{mediaId:item.id,action:'watch',source:'trakt',sourceEventId:`${connectionId}:history:${record.id}:${record.watched_at}`,occurredAt:record.watched_at,rewatch:true})});
 }
 await db.transaction(async tx=>{
  const [current]=await tx.select().from(providerConnections).where(eq(providerConnections.id,connectionId)).for('update');
  if(!current||current.accountGeneration!==connection.accountGeneration||current.status!=='connected')throw new PermanentActionError('The connected account changed.');
  await tx.insert(socialLiveState).values({connectionId,accountGeneration:connection.accountGeneration,workId:work?.id??null,remoteId:null,expiresAt:expires,checkedAt:now,historyCursor:now}).onConflictDoUpdate({target:socialLiveState.connectionId,set:{accountGeneration:connection.accountGeneration,workId:work?.id??null,remoteId:null,expiresAt:expires,checkedAt:now,historyCursor:now}});
 });
}
export async function deliverCheckin(userId:string,connectionId:string,checkinId:string) {
 return deliverCheckinToAdapter(userId,connectionId,checkinId,await getTrakt(userId,connectionId));
}
export async function deliverCheckinToAdapter(userId:string,connectionId:string,checkinId:string,context:TraktContext) {
 const {adapter,connection,sync}=context;if(!sync.scrobble)return;
 const [checkin]=await getSql()`select c.*,m.kind from social_checkins c join media m on m.id=c.work_id where c.id=${checkinId} and c.user_id=${userId}`;
 if(!checkin)return;
 const [evidence]=await getDb().select().from(socialLiveDeliveries).where(and(eq(socialLiveDeliveries.connectionId,connectionId),eq(socialLiveDeliveries.checkinId,checkinId)));
 if(evidence&&evidence.accountGeneration!==connection.accountGeneration)return;
 const remote=await adapter.watching();
 if(checkin.state!=='active'||new Date(checkin.expires_at).getTime()<=Date.now()){
  if(evidence?.state==='uncertain'&&remote)throw new PermanentActionError('Check-in delivery is uncertain. Review Trakt before cancelling remote activity.');
  if(evidence?.state==='started'&&remote){
   const watchingWork=await resolveTrakt(remote);
   // Watching has no history ID. The exact returned check-in start and work are
   // ownership evidence; a matching title alone never authorizes cancellation.
   if(remote.action==='checkin'&&watchingWork?.id===checkin.work_id&&evidence.remoteStartedAt?.getTime()===Date.parse(remote.started_at))await adapter.cancelCheckin();
  }
  if(evidence)await getDb().update(socialLiveDeliveries).set({state:'ended',updatedAt:new Date()}).where(and(eq(socialLiveDeliveries.connectionId,connectionId),eq(socialLiveDeliveries.checkinId,checkinId)));
  return;
 }
 if(evidence?.state==='started')return;
 if(evidence?.state==='uncertain')throw new PermanentActionError('Check-in delivery is uncertain. Review the active Trakt check-in before retrying.');
 if(remote)throw new PermanentActionError('Trakt already has active watching activity. Cancel it before retrying this check-in.');
 const mappings=await getDb().select().from(externalIds).where(eq(externalIds.mediaId,checkin.work_id));
 const ids=Object.fromEntries(mappings.filter(m=>['trakt','tmdb','tvdb','imdb'].includes(m.provider)).map(m=>[m.provider,m.provider==='imdb'?m.externalId:Number(m.externalId)]));
 if(!Object.keys(ids).length)throw new PermanentActionError('This title needs a verified Trakt mapping.');
 await getDb().insert(socialLiveDeliveries).values({connectionId,checkinId,accountGeneration:connection.accountGeneration,state:'uncertain'}).onConflictDoUpdate({target:[socialLiveDeliveries.connectionId,socialLiveDeliveries.checkinId],set:{state:'uncertain',updatedAt:new Date()}});
 const result=await adapter.checkin(checkin.kind,ids);
 // The queue holds the connection lane during delivery. Save evidence only to that account generation.
 await getSql()`update social_live_deliveries d set remote_id=${String(result.id)},remote_started_at=${new Date(result.watched_at)},state='started',updated_at=now() where d.connection_id=${connectionId} and d.checkin_id=${checkinId} and d.account_generation=${connection.accountGeneration} and exists(select 1 from provider_connections c where c.id=d.connection_id and c.account_generation=d.account_generation)`;
 // Cancellation may have committed while the remote request was in flight.
 const [current]=await getSql()`select state from social_checkins where id=${checkinId}`;
 if(current?.state!=='active')await deliverCheckinToAdapter(userId,connectionId,checkinId,context);
}
