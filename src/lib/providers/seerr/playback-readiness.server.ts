import { sql } from 'drizzle-orm';
import { getJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import { getConfig } from '#lib/server/config.js';
import { getDb } from '#lib/server/db/index.js';
import { AppError } from '#lib/server/security/errors.js';
import { ProviderHttpError } from '#lib/server/security/provider-fetch.js';
import { planPlayback } from '#lib/playback/planning.js';
import { JobYield } from '#lib/server/queue/execution.js';
import type { BrowserCapabilities } from '../contracts';
import type { SeerrAccountScope } from './connection.server';

const browser: BrowserCapabilities = {
  containers: ['mp4', 'm4v', 'webm'], videoCodecs: ['h264', 'vp8', 'vp9', 'av1'],
  audioCodecs: ['aac', 'mp3', 'opus', 'vorbis'], nativeHls: true, hlsJs: true,
};

type Candidate = {
  requestId: number; id: string; itemId: string; sourceId: string;
  mediaId: string; verifiedAt: string; pending: boolean;
};

/** Existing owner-scoped catalogue mappings select a small number of likely playback targets. */
export async function requestPlaybackCandidates(scope: SeerrAccountScope, requests: readonly {
  requestId: number; mediaId: string; seasons: number[]; is4k: boolean; previousId: string | null;
}[]) {
  if (!requests.length) return new Map<number, Candidate[]>();
  const selections = requests.map(request => ({
    ...request, seasons: `{${request.seasons.filter(Number.isInteger).join(',')}}`,
  }));
  const rows = await getDb().execute<Candidate>(sql`
    select request."requestId", candidate.id, candidate.external_id as "itemId", candidate.source_id as "sourceId",
      candidate.media_id as "mediaId", candidate.verified_at::text as "verifiedAt", candidate.pending
    from jsonb_to_recordset(${JSON.stringify(selections)}::text::jsonb)
      request("requestId" integer, "mediaId" uuid, seasons text, "is4k" boolean, "previousId" uuid)
    cross join lateral (
      select a.id, mapped.external_id, a.source_id, a.media_id, a.verified_at,
        coalesce(a.source->>'coastPlaybackState' = 'pending', false) as pending
      from (
        select target.id, 0 as season_number, 0 as episode_number from media target
        where target.id = request."mediaId" and target.kind = 'movie'
        union all select e.media_id, e.season_number, e.episode_number from episodes e
        where e.show_id = request."mediaId" and (request.seasons = '{}' and not e.is_special or e.season_number = any(request.seasons::integer[]))
        union all select e.media_id, e.season_number, e.episode_number from episodes e
        where e.season_id = request."mediaId" and not e.is_special
      ) target
      join availability a on a.media_id = target.id and a.user_id = ${scope.userId}
        and a.connection_id = ${scope.linkedConnectionId} and a.state = 'available'
      join provider_items mapped on mapped.id = a.provider_item_id and mapped.instance_id = ${scope.linkedInstanceId}
      order by (a.id is not distinct from request."previousId" and a.source->>'coastPlaybackState' is distinct from 'pending') desc,
        (a.source->>'coastPlaybackState' = 'pending') asc nulls first,
        case when request."is4k" then a.width end desc nulls last,
        target.season_number, target.episode_number, a.id
      limit 3
    ) candidate`) as Candidate[];
  const byRequest = new Map<number, Candidate[]>();
  for (const row of rows) {
    const list = byRequest.get(row.requestId) ?? [];
    list.push(row);
    byRequest.set(row.requestId, list);
  }
  return byRequest;
}

/** Request-scoped PlaybackInfo and HEAD prove a usable endpoint without opening a Coast playback session. */
export function createRequestPlaybackCheck(scope: SeerrAccountScope) {
  let ready: ReturnType<typeof getJellyfin> | undefined;
  let config: ReturnType<typeof getConfig> | undefined;
  let identityVerified = false;
  return async (candidates: Candidate[], is4k: boolean, previous?: string | null) => {
    if (!candidates.length) return { sourceId: null, pendingIds: [] };
    if (previous && candidates.some(candidate => candidate.id === previous && !candidate.pending)) return { sourceId: previous, pendingIds: [] };
    const pendingIds: string[] = [];
    const signal = AbortSignal.timeout(3_000);
    try {
      const [jellyfin, policy] = await Promise.all([ready ??= getJellyfin(scope.userId, scope.linkedConnectionId), config ??= getConfig()]);
      if (jellyfin.connection.accountGeneration !== scope.linkedGeneration || !jellyfin.connection.externalUserId) return { sourceId: null, pendingIds };
      if (!identityVerified) {
        await jellyfin.adapter.identity(jellyfin.instance.serverIdentity || undefined, signal);
        identityVerified = true;
      }
      const byItem = Map.groupBy(candidates, candidate => candidate.itemId);
      for (const [itemId, rows] of byItem) {
        const previousPending = pendingIds.length;
        const maxBitrate = policy.maxBitrateMbps * 1_000_000;
        try {
          const info = await jellyfin.adapter.playbackInfo(itemId, jellyfin.connection.externalUserId, browser, maxBitrate,
            { signal, probe: true });
          for (const row of rows) {
            const sources = info.sources.filter(source => (row.sourceId === source.id || row.sourceId === 'default') &&
              source.streams.some(stream => stream.type === 'Video' && (!is4k || (stream.width ?? 0) >= 3800 || (stream.height ?? 0) >= 2100)));
            try {
              if (sources.length) {
                const plan = planPlayback(sources, browser, {delivery:'relay-only',maxBitrate,allowTranscoding:policy.allowTranscoding});
                const { probeJellyfinVideo } = await import('#lib/playback/service.server.js');
                const result = await probeJellyfinVideo(scope.userId, jellyfin, itemId, plan, signal);
                if (result === 'ready') return { sourceId: row.id, pendingIds };
                if (result === 'pending') pendingIds.push(row.id);
              }
              // A different edition is not evidence that this one has no stream.
              if (!info.sources.some(source => source.streams.some(stream => stream.type === 'Video'))) pendingIds.push(row.id);
            } catch (cause) {
              if (cause instanceof JobYield) throw cause;
              // Try another mapped source if this one cannot be played.
            }
          }
        } catch (cause) {
          if (cause instanceof JobYield) throw cause;
          pendingIds.length = previousPending;
          if ((cause instanceof AppError && cause.code === 'playback_source_unavailable') ||
              (cause instanceof ProviderHttpError && cause.status === 404)) pendingIds.push(...rows.map(row => row.id));
          if (signal.aborted) break;
        }
      }
    } catch (cause) {
      if (cause instanceof JobYield) throw cause;
      // Account or provider verification can be retried by the next request sync.
    }
    return { sourceId: null, pendingIds };
  };
}
