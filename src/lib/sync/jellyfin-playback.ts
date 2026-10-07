import { and, eq, sql, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { providerConnections, providerInstances, syncValues, trackingState, users } from '$lib/server/db/schema';
import type { AvailableItem } from '$lib/providers/contracts';
import { reconcileProviderValue, sameValue } from './values';
import { assertJobLease } from '$lib/server/queue/execution';

export type JellyfinPlaybackObservation = {
  id: string; kind: AvailableItem['kind']; played: boolean; favourite: boolean | null;
  position: number; playCount: number; lastPlayedAt: string | null; duration: number | null;
};

/** Compare one bounded page under the same user lock as tracking edits. Only
 * clean baselines and unchanged local/remote values may bypass reconciliation. */
export async function unchangedJellyfinPlayback(userId: string, connectionId: string, accountGeneration: string,
  observations: JellyfinPlaybackObservation[]) {
  if (!observations.length) return new Set<string>();
  return getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [connection] = await tx.select().from(providerConnections)
      .where(and(eq(providerConnections.id, connectionId),eq(providerConnections.userId,userId))).for('update');
    if (!connection || connection.accountGeneration !== accountGeneration || connection.status !== 'connected')
      throw new Error('The connected account changed before reconciliation.');
    const [active] = await tx.select({id:users.id}).from(users).innerJoin(providerInstances,eq(providerInstances.id,connection.instanceId))
      .where(and(eq(users.id,userId),eq(users.disabled,false),eq(providerInstances.enabled,true)));
    if(!active)throw new Error('The connected account changed before reconciliation.');
    await assertJobLease(tx,true);
    if (connection.settings.importPlayback === false) return new Set<string>();
    const ids=observations.map(row=>row.id);
    const baselines=await tx.select().from(syncValues).where(and(eq(syncValues.connectionId,connectionId),inArray(syncValues.mediaId,ids)));
    const states=await tx.select().from(trackingState).where(and(eq(trackingState.userId,userId),inArray(trackingState.mediaId,ids)));
    const dirty=await tx.execute<{id:string}>(sql`select distinct work.id from works work where work.id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})
      and (exists(select 1 from outbox_actions a where a.user_id=${userId} and a.state in ('pending','running','failed') and a.payload->>'mediaId'=work.id::text)
        or exists(select 1 from reconciliation_intents r join provider_connections c on c.id=r.connection_id where c.user_id=${userId} and r.work_id=work.id)
        or exists(select 1 from sync_values v join provider_connections c on c.id=v.connection_id where c.user_id=${userId} and v.media_id=work.id and v.conflict))`);
    const dirtyIds=new Set(dirty.map(row=>row.id));
    const byTitle=new Map<string,typeof baselines>();
    for(const baseline of baselines)byTitle.set(baseline.mediaId,[...(byTitle.get(baseline.mediaId)??[]),baseline]);
    const stateById=new Map(states.map(row=>[row.mediaId,row]));
    const unchanged=new Set<string>();
    for(const row of observations){
      if(dirtyIds.has(row.id))continue;
      const state=stateById.get(row.id), previous=byTitle.get(row.id)??[];
      const duration=Math.round(row.duration??0), position=duration?Math.min(row.position,duration):row.position;
      if(!Number.isFinite(position)||position>2592000||duration>2592000)continue;
      const checks: {category:string;remote:Record<string,unknown>;local:Record<string,unknown>}[]=[];
      if(row.favourite!==null)checks.push({category:'favourite',remote:{value:row.favourite},local:{value:state?.favourite??false}});
      if(row.kind==='movie'||row.kind==='episode'){
        if(row.played && (state?.playCount??0)<Math.min(row.playCount,2147483647))continue;
        const localPosition=state?.watched && state.durationSeconds && state.positionSeconds>=state.durationSeconds-Math.min(1,state.durationSeconds*0.01)?0:state?.positionSeconds??0;
        checks.push({category:'history',remote:{value:row.played},local:{value:state?.watched??false}},
          {category:'progress',remote:{positionSeconds:Math.round(position*1000)/1000,durationSeconds:duration},local:{positionSeconds:Math.round(localPosition*1000)/1000,durationSeconds:Math.round(state?.durationSeconds??0)}});
      }
      if(checks.length && checks.every(check=>{
        const baseline=previous.find(value=>value.category===check.category);
        return baseline && !baseline.conflict && sameValue(baseline.remote,check.remote) && sameValue(baseline.agreed,check.local)
          && (check.category!=='progress'||baseline.remote.durationSeconds===duration);
      }))unchanged.add(row.id);
    }
    return unchanged;
  });
}

/** Seed untouched titles in one bounded batch. Anything with personal state or
 * another provider baseline still goes through the ordinary conflict resolver. */
export async function seedEmptyJellyfinPlayback(
  userId: string,
  connectionId: string,
  accountGeneration: string,
  observations: JellyfinPlaybackObservation[]
) {
  const candidates = observations.filter(row => !row.played && !row.favourite &&
    row.position === 0 && !row.playCount && !row.lastPlayedAt &&
    Number.isFinite(row.duration ?? 0) && (row.duration ?? 0) >= 0 && (row.duration ?? 0) <= 2592000);
  if (!candidates.length) return new Set<string>();
  return getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const [connection] = await tx.select().from(providerConnections)
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))).for('update');
    if (!connection || connection.accountGeneration !== accountGeneration || connection.status !== 'connected')
      throw new Error('The connected account changed before reconciliation.');
    const [active] = await tx.select({id: users.id}).from(users)
      .innerJoin(providerInstances, eq(providerInstances.id, connection.instanceId))
      .where(and(eq(users.id, userId), eq(users.disabled, false), eq(providerInstances.enabled, true)));
    if (!active) throw new Error('The connected account changed before reconciliation.');
    await assertJobLease(tx,true);
    if (connection.settings.importPlayback === false) return new Set<string>();
    const eligible = await tx.execute<{id: string}>(sql`
      select m.id from media m where m.id in (${sql.join(candidates.map(row => sql`${row.id}::uuid`), sql`,`)})
      and not exists(select 1 from tracking_state t where t.user_id=${userId} and t.media_id=m.id)
      and not exists(select 1 from tracking_events t where t.user_id=${userId} and t.media_id=m.id)
      and not exists(select 1 from sync_values v join provider_connections c on c.id=v.connection_id
        where c.user_id=${userId} and v.media_id=m.id)
      and not exists(select 1 from outbox_actions a where a.user_id=${userId} and a.state in ('pending','running')
        and a.payload->>'mediaId'=m.id::text)`);
    const ids = new Set(eligible.map(row => row.id));
    const baselines: (typeof syncValues.$inferInsert)[] = [];
    for (const row of candidates) {
      if (!ids.has(row.id)) continue;
      if (row.favourite !== null) baselines.push({connectionId, mediaId: row.id, category: 'favourite', remote: {value: false}, agreed: {value: false}});
      if (row.kind === 'movie' || row.kind === 'episode') baselines.push(
        {connectionId, mediaId: row.id, category: 'history', remote: {value: false}, agreed: {value: false}},
        {connectionId, mediaId: row.id, category: 'progress', remote: {positionSeconds: 0, durationSeconds: Math.round(row.duration ?? 0)}, agreed: {positionSeconds: 0, durationSeconds: 0}}
      );
    }
    if (baselines.length) await tx.insert(syncValues).values(baselines);
    return ids;
  });
}

/** Import current user state, retaining a baseline so remote removals and conflicts are detectable. */
export async function importJellyfinPlayback(
  userId: string,
  connectionId: string,
  mediaId: string,
  item: Pick<AvailableItem,'kind'|'userData'> & {sources:{durationSeconds?:number}[];metadata:{runtimeMinutes?:number|null}},
  accountGeneration?:string
) {
  const remote = item.userData;
  if (!remote) return;
  const options = {
    source: 'jellyfin',
    accountGeneration,
    occurredAt:
      remote.lastPlayedAt && Number.isFinite(Date.parse(remote.lastPlayedAt))
        ? new Date(remote.lastPlayedAt).toISOString()
        : undefined,
  };
  if (remote.favourite !== undefined)
    await reconcileProviderValue(
      userId,
      connectionId,
      mediaId,
      'favourite',
      { value: remote.favourite },
      { source: 'jellyfin',accountGeneration }
    );
  if (!['movie', 'episode'].includes(item.kind)) return;
  const duration =
    item.sources.find((source) => source.durationSeconds)?.durationSeconds ??
    (item.metadata.runtimeMinutes ? item.metadata.runtimeMinutes * 60 : 0);
  const position = duration ? Math.min(remote.positionSeconds, duration) : remote.positionSeconds;
  if (!Number.isFinite(position) || position > 2592000 || duration > 2592000) return;
  const history = await reconcileProviderValue(
    userId,
    connectionId,
    mediaId,
    'history',
    { value: remote.played },
    options
  );
  if (history === 'conflict') return;
  await reconcileProviderValue(
    userId,
    connectionId,
    mediaId,
    'progress',
    { positionSeconds: Math.round(position * 1000) / 1000, durationSeconds: Math.round(duration) },
    options
  );
  if (remote.played && history !== 'local')
    await getDb()
      .update(trackingState)
      .set({
        playCount: sql`greatest(${trackingState.playCount}, ${Math.min(remote.playCount, 2147483647)})`,
      })
      .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, mediaId)));
}
