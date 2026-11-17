import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '#lib/server/db/index.js';
import { musicProgress, providerConnections, syncValues } from '#lib/server/db/schema.js';
import { importedListenBatch, recordImportedMusicListens } from './persistence.server';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Hidden occurrences remain tombstoned even when a provider clears its active summary. */
export async function musicRemovalState(tx: Transaction, userId: string, trackId: string) {
  const key = trackId.toLowerCase();
  const [state] = await tx.execute<{ hidden: number; ignored: number; active: number }>(sql`
    select (select count(*)::int from removed_tracking_sources r where r.user_id=${userId}::uuid
      and r.source='removed-music-listen'
      and r.source_event_id>=${key+':00000000-0000-0000-0000-000000000000'}
      and r.source_event_id<=${key+':ffffffff-ffff-ffff-ffff-ffffffffffff'}
      and r.source_event_id like ${key+':%'}) as hidden,
      counters.ignored,counters.active
    from(select coalesce(max((v.remote->>'ignoredRemovedPlayCount')::int),0) as ignored,
      coalesce(max((v.remote->>'activeImportedPlayCount')::int),0) as active
      from sync_values v join provider_connections c on c.id=v.connection_id where c.user_id=${userId}::uuid
        and v.media_id=${trackId}::uuid and v.category='history') counters`);
  return { hidden: state.hidden, ignored: Math.min(state.hidden, state.ignored), active: state.active };
}

/** Accounts can observe the same listens. Their accepted deltas consume one
 * shared active contribution, never the independent Coast counter remainder. */
async function setMusicContribution(tx: Transaction, userId: string, trackId: string, count: number) {
  await tx.update(syncValues).set({remote:sql`${syncValues.remote} || jsonb_build_object('activeImportedPlayCount',${count}::int)`})
    .where(and(eq(syncValues.mediaId,trackId),eq(syncValues.category,'history'),
      sql`${syncValues.connectionId} in(select id from provider_connections where user_id=${userId}::uuid)`,
      sql`${syncValues.remote}->>'activeImportedPlayCount' is distinct from ${String(count)}`));
}

async function setRemovalOffset(tx: Transaction, userId: string, trackId: string, ignored: number) {
  await tx.update(syncValues).set({ remote: sql`${syncValues.remote} || jsonb_build_object('ignoredRemovedPlayCount',${ignored}::int)` })
    .where(and(eq(syncValues.mediaId,trackId),eq(syncValues.category,'history'),
      sql`${syncValues.connectionId} in (select id from ${providerConnections} where ${providerConnections.userId}=${userId})`));
}

/** A second connection to the same provider account shares its covered ordinals. */
export async function setMusicImportCoverage(tx: Transaction, userId: string, trackId: string, accountId: string, count: number) {
  await tx.update(syncValues).set({remote:sql`${syncValues.remote} || jsonb_build_object('importedPlayCount',${count}::int)`})
    .where(and(eq(syncValues.mediaId,trackId),eq(syncValues.category,'history'),
      sql`${syncValues.connectionId} in(select id from provider_connections where user_id=${userId}::uuid and coalesce(sync_account_id,id)=${accountId}::uuid)`,
      sql`${syncValues.remote}->>'importedPlayCount' is distinct from ${String(count)}`));
}

/** Removing an old event cannot rebuild an active summary cleared by its provider. */
export async function removeMusicCountOccurrence(tx: Transaction, userId: string, trackId: string, batchId: string, source: string) {
  const [state]=await tx.select().from(musicProgress).where(and(eq(musicProgress.userId,userId),eq(musicProgress.trackId,trackId)));
  const removal=await musicRemovalState(tx,userId,trackId);
  const contribution=Math.min(state?.playCount??0,removal.active);
  let active=source==='jellyfin'?contribution>0:(state?.playCount??0)>contribution;
  if(active&&source==='jellyfin'){
    const accounts=await tx.execute<{id:string;count:number}>(sql`
      select coalesce(c.sync_account_id,c.id) as id,max(coalesce((v.remote->>'importedPlayCount')::int,(v.remote->>'playCount')::int,0))::int as count
      from sync_values v join provider_connections c on c.id=v.connection_id
      where c.user_id=${userId}::uuid and v.media_id=${trackId}::uuid and v.category='history'
      group by coalesce(c.sync_account_id,c.id)`);
    if(accounts.length)active=accounts.some(account=>{
      const count=Math.min(10000,Math.max(0,account.count));
      for(let index=0;index<count;index++)if(importedListenBatch(account.id,trackId,index)===batchId)return true;
      return false;
    });
  }
  await tx.update(musicProgress).set({playCount:Math.max(0,(state?.playCount??0)-(active?1:0))})
    .where(and(eq(musicProgress.userId,userId),eq(musicProgress.trackId,trackId)));
  if(active&&source==='jellyfin')await setMusicContribution(tx,userId,trackId,contribution-1);
  // The caller has already retained the new tombstone. Only a removed active
  // occurrence remains a logical provider-count offset.
  if(!active)await setRemovalOffset(tx,userId,trackId,Math.min(removal.hidden,removal.ignored+1));
}

/** Project only the accepted ordinal delta; lifetime history and dates are unchanged.
 * Both ends use the scan's existing 10,000-occurrence coverage bound. */
export async function applyImportedMusicCount(tx: Transaction, userId: string, trackId: string, accountId: string, observed: number, count: number) {
  const before = Math.min(10000, Math.max(0, observed));
  const after = Math.min(10000, Math.max(0, count));
  if (before === after) return { changed: false, importedPlayCount: after };
  const [state] = await tx.select().from(musicProgress).where(and(eq(musicProgress.userId,userId),eq(musicProgress.trackId,trackId)));
  const removal = await musicRemovalState(tx,userId,trackId);
  const start = Math.min(before,after), end = Math.max(before,after);
  const keys = Array.from({length:end-start},(_,index)=>`${trackId.toLowerCase()}:${importedListenBatch(accountId,trackId,start+index)}`);
  const [hidden] = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count from removed_tracking_sources r
    where r.user_id=${userId}::uuid and r.source='removed-music-listen'
      and r.source_event_id in (select jsonb_array_elements_text(${sql.param(keys)}::jsonb))`);
  const retained = keys.length - hidden.count;
  const added = after > before ? await recordImportedMusicListens(tx,userId,trackId,accountId,before,after) : 0;
  const contribution = Math.min(state?.playCount??0,removal.active);
  const delta = after > before ? retained : -Math.min(retained,contribution);
  const projected = (state?.playCount ?? 0) + delta;
  const activeImportedPlayCount=contribution+delta;
  const ignored = Math.min(removal.hidden,Math.max(0,removal.ignored + (after > before ? -hidden.count : hidden.count)));
  await tx.insert(musicProgress).values({userId,trackId,playCount:projected})
    .onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{playCount:projected,updatedAt:new Date()}});
  if (ignored !== removal.ignored) await setRemovalOffset(tx,userId,trackId,ignored);
  if(activeImportedPlayCount!==removal.active)await setMusicContribution(tx,userId,trackId,activeImportedPlayCount);
  await setMusicImportCoverage(tx,userId,trackId,accountId,after);
  return { changed: added > 0 || projected !== (state?.playCount ?? 0) || ignored !== removal.ignored, importedPlayCount: after, activeImportedPlayCount };
}

/** Explicit conflict-review clearing preserves event history and suppresses old offsets. */
export async function clearMusicCount(tx: Transaction, userId: string, trackId: string) {
  const removal = await musicRemovalState(tx,userId,trackId);
  await tx.insert(musicProgress).values({userId,trackId,playCount:0})
    .onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{playCount:0,updatedAt:new Date()}});
  if (removal.hidden !== removal.ignored) await setRemovalOffset(tx,userId,trackId,removal.hidden);
  if(removal.active)await setMusicContribution(tx,userId,trackId,0);
}
