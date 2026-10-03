import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { trackingState } from '$lib/server/db/schema';
import type { AvailableItem } from '$lib/providers/contracts';
import { reconcileProviderValue } from './values';

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
