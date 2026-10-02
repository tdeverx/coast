import { acceptedPlayedTime, listenReached } from './listening';
import { recordMusicListen } from '$lib/music/persistence.server';
import { correlationId } from '$lib/diagnostics';
import { sequenceContextSchema } from '$lib/media/sequence';
import { sequenceEntries } from '$lib/core/lists/sequence';
import { rewatchBoundary, rewatchFields } from '$lib/core/tracking/rewatch';
import { mediaViews } from '$lib/server/queries/media';
import * as v from 'valibot';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  availability,
  episodes,
  providerItems,
  media,
  musicWorks, musicProgress,
  playbackSessions,
  trackingState,
  editionProgress,
  users,
  providerConnections,
  providerInstances,
} from '$lib/server/db/schema';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { instanceFetchConfig } from '$lib/providers/instances.server';
import { jellyfinAuthorization } from '$lib/providers/jellyfin/adapter.server';
import { getConfig } from '$lib/server/config';
import { encryptCredential, decryptCredential } from '$lib/server/security/credentials';
import { secureProviderFetch } from '$lib/server/security/provider-fetch';
import { logDiagnostic, classifyFailure, context } from '$lib/server/diagnostics';
import { trackInTransaction } from '$lib/core/tracking/service';
import {
  enqueueTraktChangeInTransaction,
  enqueuePlaybackActionsInTransaction,
} from '$lib/sync/changes';
import { comparePlaybackPlans, planPlayback, type PlaybackPlan } from './planning';
import type { PlaybackView } from '$lib/ui/types';

const uuid = v.pipe(v.string(), v.uuid());
const seconds = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(2592000));
const browserSchema = v.object({
  containers: v.array(v.picklist(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ts', 'mp3', 'flac', 'ogg', 'opus', 'aac', 'm4a', 'wav'])),
  videoCodecs: v.array(v.picklist(['h264', 'hevc', 'vp8', 'vp9', 'av1'])),
  audioCodecs: v.array(v.picklist(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3'])),
  nativeHls: v.boolean(),
  hlsJs: v.boolean(),
  maxBitrate: v.optional(v.pipe(v.number(), v.minValue(100000), v.maxValue(1000000000))),
  maxWidth: v.optional(v.pipe(v.number(), v.minValue(320), v.maxValue(16384))),
});
const playbackInput = v.object({
  mediaId: uuid,
  sequence: v.optional(sequenceContextSchema),
  sourceId: v.optional(v.string()),
  edition: v.optional(v.string()),
  expectedDuration: v.optional(v.pipe(v.number(),v.minValue(0.01),v.maxValue(604800))),
  fromStart: v.optional(v.boolean(), false),
  subtitleIndex: v.optional(v.number()),
  browser: browserSchema,
});
async function getPlaybackSourceOptions(userId: string, mediaId: string) {
  const rows = await getDb()
    .select({ source: availability, provider: providerInstances.name })
    .from(availability)
    .innerJoin(providerConnections, eq(providerConnections.id, availability.connectionId))
    .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
    .where(
      and(
        eq(availability.userId, userId),
        eq(availability.mediaId, mediaId),
        eq(availability.state, 'available'),
        eq(providerConnections.status, 'connected'),
        eq(providerInstances.enabled, true)
      )
    );
  return rows.map(({ source: row, provider }) => ({
    id: row.id,
    label: [
      provider,
      row.height ? `${row.height}p` : row.container || 'Original',
      row.videoCodec?.toUpperCase(),
      row.bitrate ? `${Math.round(row.bitrate / 1000000)} Mbps` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    edition: row.edition || undefined,
  }));
}
/** Resolve upstream URLs only inside this item's Jellyfin video namespace. */
export function playbackResourcePath(
  baseUrl: string,
  itemId: string,
  reference: string,
  parentPath?: string,
  mediaType: 'audio' | 'video' = 'video'
) {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/$/, '');
  const parent = new URL(`${base.origin}${prefix}/${(parentPath || '').replace(/^\//, '')}`);
  const url = new URL(reference, parent);
  if (url.origin !== base.origin || url.username || url.password || url.hash)
    throw new Error('Jellyfin returned an unsafe playback resource.');
  let path = url.pathname;
  if (prefix) {
    if (!path.startsWith(`${prefix}/`))
      throw new Error('The playback resource escaped its server path.');
    path = path.slice(prefix.length);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error('Invalid playback path.');
  }
  // Jellyfin serializes item IDs without hyphens in its catalogue and with hyphens
  // in transcoding URLs. Only normalize complete GUIDs, never arbitrary path IDs.
  const normalizeId = (value: string) =>
    /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(value)
      ? value.replaceAll('-', '').toLowerCase()
      : value.toLowerCase();
  const resourceItemId = (mediaType==='audio'?/^\/audio\/([^/]+)\//i:/^\/videos\/([^/]+)\//i).exec(decoded)?.[1];
  if (
    !resourceItemId ||
    normalizeId(resourceItemId) !== normalizeId(itemId) ||
    decoded.includes('..') ||
    decoded.includes('\\') ||
    /[\r\n\0]/.test(decoded)
  )
    throw new Error('This resource does not belong to the playback item.');
  url.searchParams.delete('api_key');
  url.searchParams.delete('ApiKey');
  url.searchParams.delete('apiKey');
  return `${path}${url.search}`;
}
async function resourceUrl(sessionId: string, path: string, expiresAt: Date) {
  const token = await encryptCredential(
    JSON.stringify({ sessionId, path, expiresAt: expiresAt.getTime() })
  );
  return `/api/v1/playback/${sessionId}/stream?resource=${encodeURIComponent(token)}`;
}
export async function startPlayback(
  userId: string,
  input: unknown
): Promise<PlaybackView & { defaultSubtitleIndex: number | null; subtitlePrompt: boolean }> {
  const started = performance.now();
  void logDiagnostic('debug', 'playback.start');
  const data = v.parse(playbackInput, input),
    config = await getConfig();
  const [screen] = await getDb().select().from(media).where(eq(media.id,data.mediaId));
  const [music] = screen ? [] : await getDb().select().from(musicWorks).where(eq(musicWorks.id,data.mediaId));
  const item=screen??(music?{...music,runtimeMinutes:(music.durationSeconds??0)/60}:undefined);
  const mediaType=music?'audio':'video';
  if(!item || !['movie','episode','track'].includes(item.kind))throw new Error('Choose a movie, episode or track to play.');
  if(music && !config.experimentalFeatures)throw new Error('Music is disabled by the administrator.');
  const sequenceEntry = data.sequence
    ? (await sequenceEntries(userId, data.sequence)).find(
        (entry) => entry.entryId === data.sequence!.entryId && entry.mediaId === item.id
      )
    : undefined;
  if (data.sequence && !sequenceEntry) throw new Error('This sequence entry no longer exists.');
  const available = await getDb()
    .select({ availability, providerItem: providerItems })
    .from(availability)
    .innerJoin(providerItems, eq(providerItems.id, availability.providerItemId))
    .where(
      and(
        eq(availability.userId, userId),
        eq(availability.mediaId, data.mediaId),
        eq(availability.state, 'available')
      )
    );
  const rows = available.filter(
    (row) =>
      (!data.sourceId ||
        row.availability.id === data.sourceId ||
        row.availability.sourceId === data.sourceId) &&
      (data.edition === undefined || (row.availability.edition ?? '') === data.edition)
  );
  if (!rows.length)
    throw new Error('This title is no longer available from your connected sources.');
  const candidates: {
    row: (typeof rows)[number];
    plan: PlaybackPlan;
    playSessionId?: string;
    instance: Awaited<ReturnType<typeof getJellyfin>>['instance'];
  }[] = [];
  const queried = new Set<string>();
  const maximum = Math.min(config.maxBitrateMbps * 1000000, data.browser.maxBitrate || Infinity);
  for (const row of rows) {
    const key = `${row.availability.connectionId}:${row.providerItem.id}`;
    if (queried.has(key)) continue;
    queried.add(key);
    try {
      const { adapter, connection, instance } = await getJellyfin(
        userId,
        row.availability.connectionId
      );
      await adapter.identity(instance.serverIdentity || undefined);
      const info = await adapter.playbackInfo(
        row.providerItem.externalId,
        connection.externalUserId!,
        data.browser,
        maximum
      );
      for (const source of info.sources) {
        const sourceRow = rows.find(
          (r) =>
            r.availability.connectionId === row.availability.connectionId &&
            r.providerItem.id === row.providerItem.id &&
            (r.availability.sourceId === source.id || r.availability.sourceId === 'default')
        );
        if (!sourceRow) continue;
        if(data.expectedDuration!==undefined){
          const duration=source.durationSeconds||sourceRow.availability.durationSeconds||item.runtimeMinutes! * 60;
          if(!duration||Math.abs(duration-data.expectedDuration)>2)continue;
        }
        try {
          const plan = planPlayback([source], data.browser, {
            delivery: config.playbackDelivery === 'relay-only' ? 'relay-only' : 'allow-direct',
            maxBitrate: maximum,
            allowTranscoding: config.allowTranscoding,
          },undefined,mediaType);
          candidates.push({ row: sourceRow, plan, playSessionId: info.playSessionId, instance });
        } catch {
          /* Try all sources before reporting incompatibility. */
        }
      }
    } catch (error) {
      void logDiagnostic('error', 'playback.failed', { failure: classifyFailure(error) });
    }
  }
  candidates.sort((a, b) => comparePlaybackPlans(a.plan, b.plan));
  const best = candidates[0];
  if (!best)
    throw new Error(
      data.expectedDuration!==undefined ? 'No accessible source matches the synced session edition and duration.' : 'No available version can play on this device under the current playback policy.'
    );
  const { source } = best.plan;
  const query = new URLSearchParams({
    static: 'true',
    mediaSourceId: source.id,
    deviceId: userId,
    ...(best.playSessionId ? { playSessionId: best.playSessionId } : {}),
  });
  const upstream =
    best.plan.mode === 'transcode'
      ? source.transcodingUrl!
      : `/${mediaType==='audio'?'Audio':'Videos'}/${best.row.providerItem.externalId}/stream?${query}`;
  // PlaybackInfo paths can be absolute from the server's own origin or rooted below its reverse-proxy prefix.
  const serverPath = new URL(best.instance.baseUrl).pathname;
  const reference =
    upstream.startsWith('/') && serverPath !== '/' && !upstream.startsWith(serverPath)
      ? `${serverPath.replace(/\/$/, '')}${upstream}`
      : upstream;
  const streamPath = playbackResourcePath(
    best.instance.baseUrl,
    best.row.providerItem.externalId,
    reference,
    undefined,mediaType
  );
  const [state] = await getDb()
    .select()
    .from(trackingState)
    .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, item.id)));
  const [edition] = await getDb()
    .select()
    .from(editionProgress)
    .where(
      and(
        eq(editionProgress.userId, userId),
        eq(editionProgress.mediaId, item.id),
        eq(editionProgress.editionId, `${best.row.availability.connectionId}:${source.id}`)
      )
    );
  const duration =
    source.durationSeconds ||
    best.row.availability.durationSeconds ||
    (item.runtimeMinutes || 0) * 60;
  const [audioProgress]=music?await getDb().select().from(musicProgress).where(and(eq(musicProgress.userId,userId),eq(musicProgress.trackId,item.id))):[];
  const saved = audioProgress ?? edition ?? state;
  const [rewatch] = await getDb()
    .select({
      startedAt: rewatchBoundary(userId, sql`${item.id}::uuid`),
      progress: rewatchFields(userId, sql`${item.id}::uuid`).progress,
    })
    .from(trackingState)
    .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, item.id)));
  const savedPosition = sequenceEntry
    ? sequenceEntry.watched
      ? 0
      : sequenceEntry.progress
    : rewatch?.startedAt
      ? rewatch.progress
      : (saved?.positionSeconds ?? 0);
  const savedDuration = saved?.durationSeconds || duration;
  // A new rewatch can have progress while canonical completion remains true. Older editions and
  // completed positions must still start at zero, including late ticks after the completion event.
  const newerThanCompletion =
    !state?.watched || !state.lastWatchedAt || (!!saved && saved.updatedAt >= state.lastWatchedAt);
  const position =
    !data.fromStart &&
    (sequenceEntry || newerThanCompletion) &&
    savedPosition > 0 &&
    (!savedDuration || savedPosition / savedDuration < (mediaType==='audio'?1:0.9))
      ? savedPosition
      : 0;
  const expiresAt = new Date(Date.now() + 24 * 3600000);
  const [viewer] = await getDb().select().from(users).where(eq(users.id,userId));
  // A user has one prepared/active playback session across audio and video.
  const session=await getDb().transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
  await tx.execute(sql`update social_checkins set state='cancelled',updated_at=now() where user_id=${userId} and state='active'`);
  await tx.update(playbackSessions).set({state:'stopped',updatedAt:new Date()}).where(and(eq(playbackSessions.userId,userId),sql`${playbackSessions.state}<>'stopped'`));
  const [prepared] = await tx
    .insert(playbackSessions)
    .values({
      userId,
      mediaId: item.id,
      mediaType,
      listenThreshold:Math.min(100,Math.max(1,Math.trunc(viewer.settings.listenThreshold??50))),
      sequence: data.sequence,
      connectionId: best.row.availability.connectionId,
      providerItemId: best.row.providerItem.id,
      sourceId: source.id,
      edition: best.row.availability.edition,
      providerSessionId: best.playSessionId,
      delivery: best.plan.useHls ? 'hls' : 'direct',
      streamPath,
      positionSeconds: position,
      durationSeconds: duration,
      state: 'prepared',
      correlationId: correlationId(context.getStore()),
      expiresAt,
    })
    .returning();
  return prepared;
  });
  void logDiagnostic('info', 'playback.ready', { sessionId: session.id, durationMs: performance.now() - started });
  const subtitles = [];
  for (const subtitle of source.streams.filter(
    (s) =>
      s.type === 'Subtitle' &&
      s.codec &&
      ['srt', 'vtt', 'subrip', 'webvtt'].includes(s.codec.toLowerCase())
  )) {
    const path = `/Videos/${encodeURIComponent(best.row.providerItem.externalId)}/${encodeURIComponent(source.id)}/Subtitles/${subtitle.index}/0/Stream.vtt`;
    subtitles.push({
      index: subtitle.index,
      label: subtitle.title || subtitle.language || `Subtitle ${subtitle.index + 1}`,
      language: subtitle.language,
      url: await resourceUrl(session.id, path, expiresAt),
    });
  }

  const languages = viewer.settings.subtitleLanguages || config.subtitleLanguages;
  const preferred = subtitles.find(
    (s) =>
      s.language &&
      languages.some((language) => s.language!.toLowerCase().startsWith(language.toLowerCase()))
  );
  const always = viewer.settings.subtitlesAlways ?? config.subtitleDefault === 'always';
  const enabled = always || config.subtitleDefault === 'preferred';
  const defaultSubtitleIndex =
    data.subtitleIndex !== undefined
      ? subtitles.some((s) => s.index === data.subtitleIndex)
        ? data.subtitleIndex
        : null
      : enabled
        ? (preferred?.index ?? (always ? subtitles[0]?.index : null) ?? null)
        : null;
  const [episode] =
    item.kind === 'episode'
      ? await getDb()
          .select({
            show: media.title,
            season: episodes.seasonNumber,
            number: episodes.episodeNumber,
          })
          .from(episodes)
          .innerJoin(media, eq(media.id, episodes.showId))
          .where(eq(episodes.mediaId, item.id))
      : [];
  const [presentation] = await mediaViews(userId, { ids: [item.id], limit: 1 });
  const detail = episode
    ? `${episode.show} · S${String(episode.season).padStart(2, '0')} E${String(episode.number).padStart(2, '0')}`
    : music?music.artistNames.join(', '):[item.year, item.kind === 'movie' ? 'Movie' : 'Episode'].filter(Boolean).join(' · ');
  return {
    id: session.id,
    mediaType,
    sequence: data.sequence,
    mediaId: item.id,
    detail,
    title: item.title,
    artwork: music?(best.row.providerItem.snapshot.primaryImageTag?`/api/v1/providers/${best.row.availability.connectionId}/music/${best.row.providerItem.externalId}/artwork`:undefined):presentation?.poster ?? presentation?.backdrop,
    url: `/api/v1/playback/${session.id}/stream`,
    kind: best.plan.useHls ? 'hls' : 'direct',
    startSeconds: position,
    durationSeconds: duration,
    provider: best.instance.name,
    edition: session.edition || undefined,
    subtitles,
    defaultSubtitleIndex,
    subtitlePrompt: viewer.settings.subtitlePrompt === true,
    sources: await getPlaybackSourceOptions(userId, item.id),
  };
}
export async function progressPlayback(userId: string, sessionId: string, input: unknown) {
  const data = v.parse(
    v.object({
      positionSeconds: seconds,
      playedSeconds: v.optional(seconds),
      durationSeconds: v.optional(seconds),
      event: v.optional(v.picklist(['start', 'progress', 'pause', 'stop', 'ended']), 'progress'),
      paused: v.optional(v.boolean()),
    }),
    input
  );
  v.parse(uuid, sessionId);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [session] = await tx
      .select()
      .from(playbackSessions)
      .where(
        and(
          eq(playbackSessions.id, sessionId),
          eq(playbackSessions.userId, userId),
          gt(playbackSessions.expiresAt, new Date())
        )
      );
    if (!session) throw new Error('This playback session has expired.');
    const stop = data.event === 'stop' || data.event === 'ended';
    if(data.event==='start')await tx.execute(sql`update social_checkins set state='cancelled',updated_at=now() where user_id=${userId} and state='active'`);
    const firstStart = session.state === 'prepared' && data.event === 'start';
    const resumed = session.state === 'paused' && data.event === 'start';
    if (
      session.state === 'stopped' ||
      (session.state === 'prepared' && !firstStart) ||
      (data.event === 'start' && !firstStart && !resumed)
    ) {
      if (session.state === 'prepared' && stop)
        await tx
          .update(playbackSessions)
          .set({ state: 'stopped', updatedAt: new Date() })
          .where(eq(playbackSessions.id, sessionId));
      const [state] = await tx
        .select()
        .from(trackingState)
        .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, session.mediaId)));
      return { complete: session.mediaType==='audio'?session.listenRecorded:session.state === 'prepared' ? false : (state?.watched ?? false), state };
    }
    const duration = session.durationSeconds || data.durationSeconds || 0;
    const position = duration ? Math.min(data.positionSeconds, duration) : data.positionSeconds;
    const complete = data.event !== 'start' && duration > 0 && position / duration >= 0.9;
    const nextState = stop
      ? 'stopped'
      : data.event === 'start'
        ? 'active'
        : data.event === 'pause' || data.paused || session.state === 'paused'
          ? 'paused'
          : 'active';
    if(session.mediaType==='audio'){
      const playedSeconds=acceptedPlayedTime(session.playedSeconds,data.playedSeconds??session.playedSeconds,(Date.now()-session.updatedAt.getTime())/1000,session.state==='active');
      const listened=session.listenRecorded||listenReached(playedSeconds,duration,session.listenThreshold);
      if(listened&&!session.listenRecorded)await recordMusicListen(tx,userId,session.mediaId,session.id,'playback');
      const savedPosition=data.event==='ended'?0:position;
      await tx.insert(musicProgress).values({userId,trackId:session.mediaId,positionSeconds:savedPosition,durationSeconds:duration||null})
        .onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{positionSeconds:savedPosition,durationSeconds:duration||null,updatedAt:new Date()}});
      await enqueuePlaybackActionsInTransaction(tx,userId,{sessionId,connectionId:session.connectionId,mediaId:session.mediaId,jellyfinEvent:firstStart?'start':stop?'stop':'progress',positionSeconds:position,durationSeconds:duration,paused:nextState==='paused'});
      await tx.update(playbackSessions).set({playedSeconds,listenRecorded:listened,positionSeconds:position,state:nextState,updatedAt:new Date()}).where(eq(playbackSessions.id,sessionId));
      return {complete:listened,state:{positionSeconds:position}};
    }
    let updated = await trackInTransaction(tx, userId, {
      mediaId: session.mediaId,
      action: 'progress',
      positionSeconds: position,
      durationSeconds: duration || undefined,
      editionId: `${session.connectionId}:${session.sourceId}`,
      source: 'playback',
      sequence: session.sequence ?? undefined,
      acknowledged: true,
    });
    if (complete) {
      const watched = await trackInTransaction(tx, userId, {
        mediaId: session.mediaId,
        action: 'watch',
        source: 'playback',
        sequence: session.sequence ?? undefined,
        sourceEventId: `playback:${session.id}`,
        rewatch: true,
        editionId: `${session.connectionId}:${session.sourceId}`,
        acknowledged: true,
      });
      if (watched.changed && watched.eventId && !watched.duplicate)
        await enqueueTraktChangeInTransaction(tx, userId, {
          mediaId: session.mediaId,
          category: 'history',
          eventId: watched.eventId,
          fromPlayback: true,
        });
      updated = watched;
    }
    await enqueuePlaybackActionsInTransaction(tx, userId, {
      sessionId,
      connectionId: session.connectionId,
      mediaId: session.mediaId,
      jellyfinEvent: firstStart ? 'start' : stop ? 'stop' : 'progress',
      traktEvent:
        firstStart || resumed
          ? 'start'
          : stop
            ? 'stop'
            : data.event === 'pause' || (nextState === 'paused' && session.state !== 'paused')
              ? 'pause'
              : undefined,
      positionSeconds: position,
      durationSeconds: duration,
      paused: nextState === 'paused',
    });
    await tx
      .update(playbackSessions)
      .set({
        positionSeconds: position,
        durationSeconds: duration || null,
        state: nextState,
        updatedAt: new Date(),
      })
      .where(eq(playbackSessions.id, sessionId));
    return { complete, state: updated.state };
  });
}
/** Rewrite every HLS URI into an encrypted capability scoped to this authorised session. */
export async function rewriteHlsManifest(
  text: string,
  resolve: (reference: string) => Promise<string>
) {
  if (!text.startsWith('#EXTM3U')) throw new Error('Jellyfin returned an invalid HLS playlist.');
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#')) {
      let transformed = line;
      const references = [...line.matchAll(/URI="([^"]+)"/g)];
      for (const match of references)
        transformed = transformed.replace(match[0], `URI="${await resolve(match[1])}"`);
      lines.push(transformed);
    } else lines.push(line.trim() ? await resolve(line.trim()) : line);
  }
  return lines.join('\n');
}
export async function streamPlayback(
  userId: string,
  sessionId: string,
  request: Request
): Promise<Response> {
  const [session] = await getDb()
    .select()
    .from(playbackSessions)
    .where(
      and(
        eq(playbackSessions.id, v.parse(uuid, sessionId)),
        eq(playbackSessions.userId, userId),
        gt(playbackSessions.expiresAt, new Date())
      )
    );
  if (!session || session.state === 'stopped')
    return new Response('Playback session expired.', { status: 410 });
  context.enterWith(session.correlationId);
  void logDiagnostic('trace', 'playback.timing', { sessionId: session.id });
  const { connection, instance } = await getJellyfin(userId, session.connectionId);
  const [item] = await getDb()
    .select()
    .from(providerItems)
    .where(eq(providerItems.id, session.providerItemId));
  if (!item) return new Response('Playback source unavailable.', { status: 404 });
  const resource = new URL(request.url).searchParams.get('resource');
  let path = session.streamPath;
  if (resource) {
    let payload;
    try {
      payload = v.parse(
        v.object({ sessionId: uuid, path: v.string(), expiresAt: v.number() }),
        JSON.parse(await decryptCredential(resource))
      );
    } catch {
      return new Response('Invalid playback resource.', { status: 403 });
    }
    if (payload.sessionId !== session.id || payload.expiresAt < Date.now())
      return new Response('Invalid playback resource.', { status: 403 });
    path = payload.path;
  }
  const prefix = new URL(instance.baseUrl).pathname.replace(/\/$/, '');
  path = playbackResourcePath(instance.baseUrl, item.externalId, `${prefix}${path}`,undefined,session.mediaType);
  const credentials = v.parse(
    v.object({ accessToken: v.string() }),
    JSON.parse(await decryptCredential(connection.credentials!))
  );
  const headers = new Headers({
    Authorization: jellyfinAuthorization(userId, credentials.accessToken),
  });
  const range = request.headers.get('range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set('Range', range);
  const requestedPlaylist = /\.m3u8(?:\?|$)/i.test(path);
  const response = await secureProviderFetch(
    { ...(await instanceFetchConfig(instance)), timeoutMs: 20000 },
    path,
    { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: request.signal },
    { stream: true, maxBytes: requestedPlaylist ? 2 * 1024 * 1024 : 128 * 1024 ** 3 }
  );
  if (!response.ok && response.status !== 206) {
    await response.body?.cancel();
    return new Response('The media source could not deliver playback.', { status: 502 });
  }
  const outgoing = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of [
    'Content-Type',
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
    'Last-Modified',
  ]) {
    const value = response.headers.get(name);
    if (value) outgoing.set(name, value);
  }
  const contentType = (response.headers.get('content-type') || 'application/octet-stream')
    .split(';')[0]
    .toLowerCase();
  const playlist = requestedPlaylist || /mpegurl/i.test(contentType);
  if (
    !playlist &&
    !/^(video\/|audio\/|text\/vtt$|application\/(octet-stream|mp4)$)/.test(contentType)
  ) {
    await response.body?.cancel();
    return new Response('Invalid playback response.', { status: 502 });
  }
  outgoing.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (playlist && request.method !== 'HEAD') {
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024) throw new Error('The HLS manifest is too large.');
    const rewritten = await rewriteHlsManifest(body, async (reference) => {
      const child = playbackResourcePath(instance.baseUrl, item.externalId, reference, path,session.mediaType);
      return resourceUrl(session.id, child, session.expiresAt);
    });
    outgoing.delete('Content-Length');
    outgoing.set('Content-Type', 'application/vnd.apple.mpegurl');
    return new Response(rewritten, { headers: outgoing });
  }
  return new Response(response.body, { status: response.status, headers: outgoing });
}

/** Local trailers use the persistent native video element without creating tracking events. */
export async function getTrailer(userId: string, mediaId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ availability, providerItem: providerItems })
    .from(availability)
    .innerJoin(providerItems, eq(providerItems.id, availability.providerItemId))
    .where(
      and(
        eq(availability.userId, userId),
        eq(availability.mediaId, mediaId),
        eq(availability.state, 'available')
      )
    );
  for (const row of rows)
    try {
      const { adapter, connection } = await getJellyfin(userId, row.availability.connectionId);
      const trailers = await adapter.localTrailers(
        connection.externalUserId!,
        row.providerItem.externalId
      );
      for (const trailer of trailers) {
        const info = await adapter.playbackInfo(
          trailer.id,
          connection.externalUserId!,
          {
            containers: ['mp4', 'm4v'],
            videoCodecs: ['h264'],
            audioCodecs: ['aac', 'mp3'],
            nativeHls: false,
            hlsJs: false,
          },
          20000000
        );
        const source = info.sources.find(
          (s) =>
            s.directPlay &&
            ['mp4', 'm4v'].includes(s.container || '') &&
            s.streams.some((x) => x.type === 'Video' && x.codec === 'h264')
        );
        if (source) {
          const token = await encryptCredential(
            JSON.stringify({
              userId,
              mediaId,
              connectionId: connection.id,
              trailerId: trailer.id,
              sourceId: source.id,
              expiresAt: Date.now() + 24 * 3600000,
            })
          );
          return `/api/v1/trailer/${mediaId}?resource=${encodeURIComponent(token)}`;
        }
      }
    } catch {
      /* Trailer failure leaves the artwork in place. */
    }
  return null;
}
export async function streamTrailer(
  userId: string,
  mediaId: string,
  request: Request
): Promise<Response> {
  const resource = new URL(request.url).searchParams.get('resource');
  if (!resource) return new Response('Trailer unavailable.', { status: 404 });
  let payload;
  try {
    payload = v.parse(
      v.object({
        userId: uuid,
        mediaId: uuid,
        connectionId: uuid,
        trailerId: v.pipe(v.string(), v.regex(/^[\w-]+$/)),
        sourceId: v.string(),
        expiresAt: v.number(),
      }),
      JSON.parse(await decryptCredential(resource))
    );
  } catch {
    return new Response('Trailer unavailable.', { status: 403 });
  }
  if (payload.userId !== userId || payload.mediaId !== mediaId || payload.expiresAt < Date.now())
    return new Response('Trailer unavailable.', { status: 403 });
  const [access] = await getDb()
    .select({ id: availability.id })
    .from(availability)
    .where(
      and(
        eq(availability.userId, userId),
        eq(availability.mediaId, mediaId),
        eq(availability.connectionId, payload.connectionId),
        eq(availability.state, 'available')
      )
    )
    .limit(1);
  if (!access) return new Response('Trailer unavailable.', { status: 403 });
  const { connection, instance } = await getJellyfin(userId, payload.connectionId),
    credentials = JSON.parse(await decryptCredential(connection.credentials!)) as {
      accessToken: string;
    };
  const headers = new Headers({
    Authorization: jellyfinAuthorization(userId, credentials.accessToken),
  });
  const range = request.headers.get('range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set('Range', range);
  const query = new URLSearchParams({ static: 'true', mediaSourceId: payload.sourceId });
  const response = await secureProviderFetch(
    await instanceFetchConfig(instance),
    `/Videos/${payload.trailerId}/stream?${query}`,
    { headers, signal: request.signal },
    { stream: true, maxBytes: 2 * 1024 ** 3 }
  );
  if (!response.ok && response.status !== 206) {
    await response.body?.cancel();
    return new Response('Trailer unavailable.', { status: 502 });
  }
  const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!mime.startsWith('video/') && mime !== 'application/octet-stream') {
    await response.body?.cancel();
    return new Response('Invalid trailer response.', { status: 502 });
  }
  const outgoing = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  for (const key of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
    const value = response.headers.get(key);
    if (value) outgoing.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers: outgoing });
}

export async function recordPlaybackError(userId: string, sessionId: string, code: unknown) {
  const [session] = await getDb()
    .select({ id: playbackSessions.id })
    .from(playbackSessions)
    .where(
      and(eq(playbackSessions.id, v.parse(uuid, sessionId)), eq(playbackSessions.userId, userId))
    );
  if (!session) throw new Error('Playback session not found.');
  void logDiagnostic('error', 'playback.failed', {
    sessionId: session.id,
    failure: 'media',
    code: typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 4 ? code : 0,
  });
}
