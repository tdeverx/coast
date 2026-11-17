import { conflictPreference } from './preference.server';
import { lockFeaturePolicyInTransaction } from '#lib/server/features.js';
import { and, eq, sql, inArray } from 'drizzle-orm';
import { getDb, type Database } from '#lib/server/db/index.js';
import {
  providerConnections,
  syncValues,
  trackingState,
  ratings,
  trackingEvents,
  outboxActions,
  works, musicProgress,
  type JsonObject,
} from '#lib/server/db/schema.js';
import { trackInTransaction } from '#lib/core/tracking/service.server.js';
import { rateInTransaction } from '#lib/core/ratings/service.server.js';
import { enqueueSyncValueInTransaction } from './changes.server';
import { assertJobLease } from '#lib/server/queue/execution.js';
import { applyImportedMusicCount, clearMusicCount, musicRemovalState } from '#lib/music/sync-count.server.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ValueCategory =
  | 'history'
  | 'progress'
  | 'watchlist'
  | 'collection'
  | 'favourite'
  | 'ratings';
export const valueCategories: ValueCategory[] = [
  'history',
  'progress',
  'watchlist',
  'collection',
  'favourite',
  'ratings',
];
export function sameValue(a: JsonObject | null | undefined, b: JsonObject) {
  // Resume positions arrive as percentages, ticks or rounded seconds.
  // Runtime is metadata, not a competing personal edit.
  if (a && typeof a.positionSeconds === 'number' && typeof b.positionSeconds === 'number')
    return a.positionSeconds === b.positionSeconds ||
      (a.positionSeconds > 0 && b.positionSeconds > 0 && Math.abs(a.positionSeconds - b.positionSeconds) <= 1);
  return (
    !!a &&
    Object.keys({ ...a, ...b }).every((key) => key==='importedPlayCount'||key==='ignoredRemovedPlayCount'||key==='activeImportedPlayCount'||JSON.stringify(a[key]) === JSON.stringify(b[key]))
  );
}
export async function localSyncValue(
  tx: Transaction,
  userId: string,
  mediaId: string,
  category: ValueCategory
): Promise<JsonObject> {
  const [work]=await tx.select().from(works).where(eq(works.id,mediaId));
  if(work?.category==='music'&&(category==='history'||category==='progress')){
    const [state]=await tx.select().from(musicProgress).where(and(eq(musicProgress.userId,userId),eq(musicProgress.trackId,mediaId)));
    if(category==='history'){
      // A local-only removal hides an occurrence, rather than requesting a provider count change.
      // Keep these occurrences in sync comparisons; the visible progress counter stays separate.
      const removal=await musicRemovalState(tx,userId,mediaId);
      const playCount=(state?.playCount??0)+removal.hidden-removal.ignored;
      return {value:playCount>0,playCount};
    }
    return {positionSeconds:Math.round((state?.positionSeconds??0)*1000)/1000,durationSeconds:Math.round(state?.durationSeconds??0)};
  }
  if (category === 'ratings') {
    const [rating] = await tx
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.mediaId, mediaId)));
    return { value: rating?.value ?? null };
  }
  const [state] = await tx
    .select()
    .from(trackingState)
    .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, mediaId)));
  if (category === 'progress')
    return {
      // Providers clear resume markers after completion. Preserve concrete Coast
      // history/progress while comparing the shared resume state.
      positionSeconds: state?.watched && state.durationSeconds &&
        state.positionSeconds >= state.durationSeconds - Math.min(1,state.durationSeconds * 0.01)
        ? 0 : Math.round((state?.positionSeconds ?? 0) * 1000) / 1000,
      durationSeconds: Math.round(state?.durationSeconds ?? 0),
    };
  const field =
    category === 'history' ? 'watched' : category === 'collection' ? 'collected' : category;
  return { value: state?.[field] ?? false };
}
export async function applySyncValue(
  tx: Transaction,
  userId: string,
  mediaId: string,
  category: ValueCategory,
  value: JsonObject,
  source: string,
  occurredAt?: string
) {
  const [work]=await tx.select().from(works).where(eq(works.id,mediaId));
  if(work?.category==='music'&&(category==='history'||category==='progress')){
    // Aggregate-only observations cannot rematerialize lifetime history into the
    // active counter. The domain importer owns accepted occurrence deltas.
    if(category==='history'){
      if(!value.value)await clearMusicCount(tx,userId,mediaId);
      return;
    }
    const fields={positionSeconds:Number(value.positionSeconds),durationSeconds:Number(value.durationSeconds)};
    await tx.insert(musicProgress).values({userId,trackId:mediaId,...fields}).onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{...fields,updatedAt:new Date()}});return;
  }
  if (category === 'ratings') {
    await rateInTransaction(tx, userId, { mediaId, value: value.value as number | null });
    await tx
      .update(ratings)
      .set({ source })
      .where(and(eq(ratings.userId, userId), eq(ratings.mediaId, mediaId)));
  } else
    await trackInTransaction(tx, userId, {
      mediaId,
      source,
      acknowledged: true,
      occurredAt,
      action:
        category === 'history'
          ? value.value
            ? 'watch'
            : 'unwatch'
          : category === 'collection'
            ? 'collect'
            : category,
      ...(category === 'progress'
        ? {
            positionSeconds: Number(value.positionSeconds),
            durationSeconds: Number(value.durationSeconds),
          }
        : { value: Boolean(value.value) }),
    });
}
/** Compare personal edits. Convergence needs no winner or remote write. */
export function decideSync(
  local: JsonObject,
  remote: JsonObject,
  previous?: { remote: JsonObject; agreed: JsonObject | null; conflict: boolean }
): 'agree'|'local'|'remote'|'conflict' {
  if (sameValue(local, remote)) return 'agree';
  // An uninitialized destination has no competing user value. This also
  // reclassifies initial-empty conflicts produced by earlier comparisons.
  if (previous?.agreed === null && emptySyncValue(remote) && !emptySyncValue(local))
    return 'local';
  if (previous?.conflict) return 'conflict';
  if (previous) {
    if (sameValue(previous.remote, remote)) return 'local';
    return sameValue(previous.agreed, local) ? 'remote' : 'conflict';
  }
  // An initial import can fill empty state; existing divergent user choices require review.
  return emptySyncValue(local) ? 'remote' : emptySyncValue(remote) ? 'local' : 'conflict';
}
function emptySyncValue(value: JsonObject) {
  return Object.entries(value).every(([key, value]) => key === 'durationSeconds' || key === 'importedPlayCount' || key === 'ignoredRemovedPlayCount' || !value);
}
export async function reconcileProviderValue(
  userId: string,
  connectionId: string,
  mediaId: string,
  category: ValueCategory,
  remote: JsonObject,
  options: {
    source?: string;
    accountGeneration?: string;
    importRemote?: boolean;
    occurredAt?: string;
    apply?: (tx: Transaction) => Promise<unknown>;
    onReconciled?: (tx: Transaction, decision: 'agree' | 'local' | 'remote' | 'conflict') => Promise<void>;
  } = {}
) {
  return getDb().transaction(async (tx) => {
    await lockFeaturePolicyInTransaction(tx,userId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const [connection] = await tx
      .select()
      .from(providerConnections)
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))).for('update');
    if (!connection) throw new Error('Connection does not belong to this account.');
    await assertJobLease(tx,true);
    if(options.accountGeneration && (connection.accountGeneration!==options.accountGeneration || connection.status!=='connected'))
      throw new Error('The connected account changed before reconciliation.');
    const [previous] = await tx
      .select()
      .from(syncValues)
      .where(
        and(
          eq(syncValues.connectionId, connectionId),
          eq(syncValues.mediaId, mediaId),
          eq(syncValues.category, category)
        )
      );
    const local = await localSyncValue(tx, userId, mediaId, category);
    const musicHistory=category==='history'&&'playCount' in local;
    let importedPlayCount=Number(previous?.remote.importedPlayCount??previous?.remote.playCount??local.playCount??0);
    let activeImportedPlayCount:number|undefined;
    function retainImportWatermark(result:unknown){
      if(musicHistory&&result&&typeof result==='object'&&'importedPlayCount' in result
        &&typeof result.importedPlayCount==='number'&&Number.isFinite(result.importedPlayCount))importedPlayCount=result.importedPlayCount;
      if(musicHistory&&result&&typeof result==='object'&&'activeImportedPlayCount' in result
        &&typeof result.activeImportedPlayCount==='number'&&Number.isFinite(result.activeImportedPlayCount))activeImportedPlayCount=result.activeImportedPlayCount;
    }
    async function applyRemote(){
      if(options.apply)return options.apply(tx);
      const count=Number(remote.playCount??0);
      if(musicHistory&&count<importedPlayCount)return applyImportedMusicCount(tx,userId,mediaId,connection.syncAccountId??connection.id,importedPlayCount,count);
      await applySyncValue(tx,userId,mediaId,category,remote,options.source??'provider-sync',options.occurredAt);
    }
    let decision = decideSync(local, remote, previous);
    // An accepted aggregate observation can precede its concrete occurrence import.
    // Revisit that gap when the domain importer runs, without inventing a local edit.
    if(musicHistory&&options.apply&&previous&&!previous.conflict&&sameValue(previous.agreed,local)
      &&Number(remote.playCount??0)>importedPlayCount)decision='remote';
    // An outbound read can expose divergence, but an import opt-out must still
    // prevent it from silently applying that remote state to Coast.
    if(options.importRemote===false && decision==='remote')decision='conflict';
    if (!previous && decision === 'remote') {
      const actions =
        category === 'history'
          ? ['watch', 'unwatch']
          : category === 'collection'
            ? ['collect']
            : [category];
      const [edited] = await tx
        .select({ id: trackingEvents.id })
        .from(trackingEvents)
        .where(
          and(
            eq(trackingEvents.userId, userId),
            eq(trackingEvents.mediaId, mediaId),
            sql`${trackingEvents.action} in (${sql.join(
              actions.map((action) => sql`${action}`),
              sql`,`
            )})`,
            eq(trackingEvents.applied, true),
            sql`${trackingEvents.source} in ('coast','playback','coast-review')`
          )
        )
        .limit(1);
      const [queued] = await tx
        .select({ id: outboxActions.id })
        .from(outboxActions)
        .where(
          and(
            eq(outboxActions.userId, userId),
            sql`${outboxActions.payload}->>'mediaId' = ${mediaId}`,
            sql`${outboxActions.payload}->>'category' = ${category}`,
            sql`${outboxActions.state} in ('pending', 'running')`
          )
        )
        .limit(1);
      if (edited || queued) decision = 'conflict';
    }
    const selectedPreference = await conflictPreference(tx, userId, connectionId);
    const preference=options.importRemote===false&&selectedPreference==='remote'?'manual':selectedPreference;
    const ownedConnections = tx
      .select({ id: providerConnections.id })
      .from(providerConnections)
      .where(eq(providerConnections.userId, userId));
    const [pending] = await tx
      .select({ id: syncValues.id })
      .from(syncValues)
      .where(
        and(
          inArray(syncValues.connectionId, ownedConnections),
          eq(syncValues.mediaId, mediaId),
          eq(syncValues.category, category),
          eq(syncValues.conflict, true)
        )
      )
      .limit(1);
    // A preferred account can also settle conflicts first observed on another destination.
    const automatic = (decision === 'conflict' || !!pending) && preference !== 'manual';
    if (automatic) {
      decision = preference;
      let winning = preference === 'remote' ? remote : local;
      if (preference === 'remote'){
        if(musicHistory)retainImportWatermark(await applyRemote());
        else await applySyncValue(
          tx,
          userId,
          mediaId,
          category,
          winning,
          options.source ?? 'provider-sync',
          options.occurredAt
        );
        if(musicHistory)winning=await localSyncValue(tx,userId,mediaId,category);
      }
      await tx
        .update(syncValues)
        .set({ conflict: false, agreed: winning, updatedAt: new Date() })
        .where(
          and(
            inArray(syncValues.connectionId, ownedConnections),
            eq(syncValues.mediaId, mediaId),
            eq(syncValues.category, category)
          )
        );
    }
    if (!automatic && (decision === 'remote' || (decision === 'agree' && options.apply))) {
      let changed = true;
      if (options.apply) {
        const result = (await options.apply(tx)) as
          | { changed?: boolean; duplicate?: boolean; reviewRequired?: boolean; importedPlayCount?:number }
          | undefined;
        retainImportWatermark(result);
        changed = !!result?.changed && !result.duplicate && !result.reviewRequired;
        if (result?.reviewRequired) decision = 'conflict';
        else if (changed) decision = 'remote';
      } else if(musicHistory){
        const result=await applyRemote();
        retainImportWatermark(result);
        changed=!!(result&&typeof result==='object'&&'changed' in result&&result.changed);
      } else
        await applySyncValue(
          tx,
          userId,
          mediaId,
          category,
          remote,
          options.source ?? 'provider-sync',
          options.occurredAt
        );
      if (changed)
        await enqueueSyncValueInTransaction(tx, userId, mediaId, category,musicHistory?await localSyncValue(tx,userId,mediaId,category):remote, connectionId);
    }
    const agreed =
      automatic || decision === 'remote' || decision === 'agree'
        ? await localSyncValue(tx, userId, mediaId, category)
        : (previous?.agreed ?? null);
    const removal=musicHistory?await musicRemovalState(tx,userId,mediaId):undefined;
    const observedRemote=removal?{...remote,importedPlayCount,ignoredRemovedPlayCount:removal.ignored,activeImportedPlayCount:activeImportedPlayCount??removal.active}:remote;
    await tx
      .insert(syncValues)
      .values({
        connectionId,
        mediaId,
        category,
        remote:observedRemote,
        agreed,
        conflict: decision === 'conflict',
      })
      .onConflictDoUpdate({
        target: [syncValues.connectionId, syncValues.mediaId, syncValues.category],
        set: { remote:observedRemote, agreed, conflict: decision === 'conflict', updatedAt: new Date() },
      });
    if (automatic)
      await enqueueSyncValueInTransaction(
        tx,
        userId,
        mediaId,
        category,
        musicHistory?await localSyncValue(tx,userId,mediaId,category):preference === 'remote' ? remote : local,
        preference === 'remote' ? connectionId : undefined
      );
    await options.onReconciled?.(tx, decision);
    return decision;
  });
}

export async function acknowledgeProviderValue(
  userId: string,
  connectionId: string,
  mediaId: string,
  category: ValueCategory,
  remote: JsonObject
) {
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const agreed = remote;
    const local = await localSyncValue(tx, userId, mediaId, category);
    const removal=category==='history'&&'playCount' in local?await musicRemovalState(tx,userId,mediaId):undefined;
    const observedRemote=removal?{...remote,importedPlayCount:Number(remote.playCount??0),ignoredRemovedPlayCount:removal.ignored,activeImportedPlayCount:removal.active}:remote;
    await tx
      .insert(syncValues)
      .values({ connectionId, mediaId, category, remote:observedRemote, agreed })
      .onConflictDoUpdate({
        target: [syncValues.connectionId, syncValues.mediaId, syncValues.category],
        set: { remote:observedRemote, agreed, ...(sameValue(local, remote) ? {conflict:false} : {}), updatedAt: new Date() },
      });
  });
}
