import { addListItem, createList, getList, deleteList } from '../src/lib/core/lists/service';
import { restartPlaylist, sequenceEntries } from '../src/lib/core/lists/sequence';
import { track } from '../src/lib/core/tracking/service';
import { streamArtwork } from '../src/lib/providers/artwork.server';
import { afterAll, beforeAll, test, expect } from 'bun:test';
import { networkInterfaces } from 'node:os';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, getSql } from '../src/lib/server/db';
import {
  users,
  providerInstances,
  providerConnections,
  media,
  externalIds,
  systemSettings,
  outboxActions,
  mediaRequests,
  trackingEvents,
  trackingState,
  editionProgress,
  playbackSessions,
  notifications,
  availability,
  metadataSnapshots,
} from '../src/lib/server/db/schema';
import { defaultConfig } from '../src/lib/server/config';
import { createProviderTransport } from '../src/lib/server/security/provider-fetch';
import { configureInstance, listProviders } from '../src/lib/providers/instances.server';
import { updateJellyfinPlaybackImport, connectJellyfin } from '../src/lib/providers/jellyfin/connection.server';
import { updateProviderSchedule } from '../src/lib/providers/maintenance.server';
import { requestMedia, requestOptions } from '../src/lib/providers/seerr/requests.server';
import { registerProviderActions } from '../src/lib/providers/actions.server';
import { scanJellyfin, libraryScanProgress } from '../src/lib/sync/jellyfin';
import { importTraktFromAdapter } from '../src/lib/sync/trakt-import';
import { exportTraktToAdapter } from '../src/lib/sync/trakt-export';
import { startPlayback, streamPlayback, progressPlayback } from '../src/lib/playback/server';
import { TmdbAdapter } from '../src/lib/providers/tmdb/adapter.server';
import { runQueueOnce, registerActionHandler, enqueueAction } from '../src/lib/server/queue';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { defaultSyncPreferences } from '../src/lib/providers/contracts';
import { POST } from '../src/routes/api/v1/[...path]/+server';

const enabled = process.env.COAST_PROVIDER_HTTP_TEST === '1';
const run = enabled ? test : test.skip;
const browser = {
  containers: ['mp4'],
  videoCodecs: ['h264'],
  audioCodecs: ['aac'],
  nativeHls: false,
  hlsJs: true,
};
const fixtureName = crypto.randomUUID();
let server: ReturnType<typeof Bun.serve>,
  dataDir: string,
  actorId: string,
  otherId: string,
  instanceId: string,
  seerrId: string,
  connectionId: string,
  mediaId: string,
  baseUrl: string,
  traktInstanceId: string,
  traktConnectionId: string;
let scanMode: 'normal' | 'broken' | 'empty' = 'normal';
let productName = 'Jellyfin Server';
let requestCalls = 0;
let seerrOffline = false;
const externalRequests: Record<string, unknown>[] = [];
const seenAuthorization: string[] = [];
const seenPaths: string[] = [];
let traktWrites = 0;
const exportedHistory: Record<string, unknown>[] = [];
const traktId = Math.floor(Math.random() * 1000000000);
const historyRecords = [
  {
    id: 502,
    watched_at: '2026-01-02T12:00:00.000Z',
    movie: { title: 'Coast fixture', ids: { trakt: traktId } },
  },
  {
    id: 501,
    watched_at: '2026-01-01T12:00:00.000Z',
    movie: { title: 'Coast fixture', ids: { trakt: traktId } },
  },
];
const source = (id: string, direct: boolean) => ({
  Id: id,
  Name: direct ? 'Standard' : 'High quality',
  Container: direct ? 'mp4' : 'mkv',
  Bitrate: direct ? 5000000 : 80000000,
  RunTimeTicks: 10000000,
  SupportsDirectPlay: direct,
  SupportsTranscoding: !direct,
  TranscodingUrl: direct ? undefined : '/Videos/abc123/master.m3u8?api_key=upstream-secret',
  MediaStreams: [
    { Index: 0, Type: 'Video', Codec: direct ? 'h264' : 'hevc', Width: 160, Height: 90 },
  ],
});
let jellyfinUserData:
  | { Played: boolean; PlaybackPositionTicks: number; PlayCount: number; LastPlayedDate: string }
  | undefined;
const movie = {
  get UserData() {
    return jellyfinUserData;
  },
  Id: 'abc123',
  Name: 'Coast fixture',
  Type: 'Movie',
  ProviderIds: { Tmdb: '100' },
  RunTimeTicks: 10000000,
  MediaSources: [source('source-direct', true), source('source-hls', false)],
};
const json = (value: unknown, init?: ResponseInit) => Response.json(value, init);
beforeAll(async () => {
  if (!enabled) return;
  if (!process.env.DATABASE_URL?.endsWith('/coast_provider_test'))
    throw new Error('Provider HTTP tests require the disposable coast_provider_test database.');
  const address = Object.values(networkInterfaces())
    .flat()
    .find(
      (i) =>
        i &&
        !i.internal &&
        i.family === 'IPv4' &&
        /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)
    )?.address;
  if (!address)
    throw new Error(
      'An explicit private LAN interface is required; loopback policy is intentionally never weakened.'
    );
  dataDir = await mkdtemp(join(tmpdir(), 'coast-provider-'));
  process.env.COAST_DATA_DIR = dataDir;
  server = Bun.serve({
    hostname: address,
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url),
        path = url.pathname;
      seenPaths.push(path);
      seenAuthorization.push(request.headers.get('authorization') || '');
      if (path === '/oauth/token') {
        const body = await request.json();
        expect(body.grant_type).toBe('refresh_token');
        expect(body.refresh_token).toBe('synthetic-refresh');
        return json({
          access_token: 'synthetic-refreshed',
          refresh_token: 'synthetic-next-refresh',
          expires_in: 7200,
          created_at: Math.floor(Date.now() / 1000),
          token_type: 'bearer',
          scope: 'public',
        });
      }
      if (path.startsWith('/sync/history/movies/')) return json(exportedHistory);
      if (path === '/sync/history' && request.method === 'GET') return json(historyRecords);
      if (path === '/sync/history' && request.method === 'POST') {
        traktWrites++;
        const body = await request.json();
        exportedHistory.push({
          id: 700,
          watched_at: body.movies[0].watched_at,
          movie: { title: 'Coast fixture', ids: { trakt: traktId } },
        });
        return json({ error: 'synthetic lost response' }, { status: 503 });
      }
      if (path === '/System/Info/Public')
        return json({
          Id: 'fixture-server',
          ServerName: 'Fixture Jellyfin',
          ProductName: productName,
          Version: '10.11.0',
        });
      if (path === '/Users/AuthenticateByName')
        return json({
          AccessToken: 'fixture-token',
          ServerId: 'fixture-server',
          User: { Id: 'fixture-user', Name: 'fixture' },
        });
      if (path === '/Items')
        return json(
          scanMode === 'normal'
            ? { Items: [movie], TotalRecordCount: 1 }
            : scanMode === 'broken'
              ? { Items: [], TotalRecordCount: 2 }
              : { Items: [], TotalRecordCount: 0 }
        );
      if (path === '/Items/abc123/Images/Logo/0')
        return new Response(new TextEncoder().encode('RIFF0000WEBP'), {
          headers: { 'Content-Type': 'image/webp' },
        });
      if (path.endsWith('/PlaybackInfo'))
        return json({ MediaSources: movie.MediaSources, PlaySessionId: 'fixture-session' });
      if (path.startsWith('/Sessions/')) return new Response(null, { status: 204 });
      if (path === '/Videos/abc123/master.m3u8')
        return new Response(
          '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\nmain.m3u8?api_key=upstream-secret\n',
          { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
        );
      if (path === '/Videos/abc123/main.m3u8')
        return new Response(
          '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nsegment.ts?api_key=upstream-secret\n#EXT-X-ENDLIST\n',
          { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
        );
      if (path === '/Videos/abc123/segment.ts')
        return new Response(Bun.file(join(import.meta.dir, 'fixtures/coast.mpegts')), {
          headers: { 'content-type': 'video/mp2t' },
        });
      if (path === '/Videos/abc123/stream') {
        const bytes = new Uint8Array(
            await Bun.file(join(import.meta.dir, 'fixtures/coast.mp4')).arrayBuffer()
          ),
          range = request.headers.get('range');
        if (range) {
          const match = /bytes=(\d+)-(\d*)/.exec(range)!;
          const start = Number(match[1]),
            end = match[2] ? Number(match[2]) : bytes.length - 1;
          return new Response(bytes.slice(start, end + 1), {
            status: 206,
            headers: {
              'content-type': 'video/mp4',
              'content-range': `bytes ${start}-${end}/${bytes.length}`,
              'accept-ranges': 'bytes',
            },
          });
        }
        return new Response(bytes, {
          headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' },
        });
      }
      if (seerrOffline && path.startsWith('/api/v1/'))
        return json({ error: 'synthetic outage' }, { status: 503 });
      if (path === '/api/v1/user/jellyfin/fixture-user' || path === '/api/v1/auth/me')
        return json({ id: 5, username: 'fixture', permissions: 32 });
      if (path === '/api/v1/service/radarr')
        return json([{ id: 1, name: 'Home', is4k: false, isDefault: true }]);
      if (path === '/api/v1/movie/100')
        return json({ id: 100, mediaInfo: { status: 1, requests: externalRequests } });
      if (path === '/api/v1/request' && request.method === 'POST') {
        expect(request.headers.get('x-api-user')).toBe('5');
        requestCalls++;
        const value = {
          id: requestCalls,
          status: 2,
          is4k: false,
          serverId: 1,
          requestedBy: { id: 5 },
          media: { id: 1, tmdbId: 100, status: 3 },
        };
        externalRequests.push(value);
        return json(value);
      }
      if (path === '/3/movie/100')
        return json({
          id: 100,
          title: 'Network fixture',
          original_title: 'Original fixture',
          genres: [{ name: 'Drama' }],
        });
      return new Response('Fixture route not found', { status: 404 });
    },
  });
  baseUrl = `http://${address}:${server.port}`;
  await getDb()
    .insert(systemSettings)
    .values({
      key: 'coast',
      value: { ...defaultConfig, allowedProviderPorts: [server.port!], serverAllowlist: [address] },
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: {
          ...defaultConfig,
          allowedProviderPorts: [server.port!],
          serverAllowlist: [address],
        },
      },
    });
  const people = await getDb()
    .insert(users)
    .values([
      { username: `http-admin-${fixtureName}`, passwordHash: 'synthetic', role: 'admin' },
      { username: `http-other-${fixtureName}`, passwordHash: 'synthetic', role: 'user' },
    ])
    .returning();
  actorId = people[0].id;
  otherId = people[1].id;
  instanceId = (
    await configureInstance(actorId, {
      provider: 'jellyfin',
      name: 'Fixture',
      baseUrl,
      allowPrivateNetwork: true,
    })
  ).id;
  connectionId = (
    await connectJellyfin(actorId, { instanceId, username: 'fixture', password: 'synthetic' })
  ).id;
  await scanJellyfin(actorId, connectionId, true);
  const [identity] = await getDb()
    .select()
    .from(externalIds)
    .where(
      and(eq(externalIds.provider, `jellyfin:${instanceId}`), eq(externalIds.externalId, 'abc123'))
    );
  mediaId = identity.mediaId;
  seerrId = (
    await configureInstance(actorId, {
      provider: 'seerr',
      name: 'Fixture requests',
      baseUrl,
      apiKey: 'fixture-api-key',
      allowPrivateNetwork: true,
      linkedMediaInstanceId: instanceId,
    })
  ).id;
  const [traktInstance] = await getDb()
    .insert(providerInstances)
    .values({
      provider: 'trakt',
      name: 'Synthetic Trakt',
      baseUrl: 'https://api.trakt.tv',
      settings: { approved: true },
    })
    .returning();
  traktInstanceId = traktInstance.id;
  const [traktConnection] = await getDb()
    .insert(providerConnections)
    .values({
      userId: actorId,
      instanceId: traktInstanceId,
      externalUserId: 'fixture',
      status: 'connected',
      settings: { sync: {} },
    })
    .returning();
  traktConnectionId = traktConnection.id;
  await getDb()
    .insert(externalIds)
    .values({ mediaId, provider: 'trakt', externalId: String(traktId), mediaKind: 'movie' });
  registerProviderActions({ maintenance: false });
});
afterAll(async () => {
  if (!enabled) return;
  server?.stop(true);
  if (actorId)
    await getDb()
      .delete(users)
      .where(inArray(users.id, [actorId, otherId]));
  if (instanceId)
    await getDb()
      .delete(providerInstances)
      .where(inArray(providerInstances.id, [instanceId, seerrId, traktInstanceId]));
  if (mediaId) await getDb().delete(media).where(eq(media.id, mediaId));
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});
run('Jellyfin artwork always fetches upstream and never creates a disk cache', async () => {
  const before = seenPaths.filter((path) => path.includes('/Images/')).length;
  for (let i = 0; i < 2; i++) {
    const response = await streamArtwork(
      actorId,
      instanceId,
      'abc123',
      'logo',
      new Request('http://coast.test/image?tag=logo')
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('private');
    await response.arrayBuffer();
  }
  expect(seenPaths.filter((path) => path.includes('/Images/')).length - before).toBe(2);
  expect(await readdir(join(dataDir, 'artwork')).catch(() => [])).toEqual([]);
  expect(
    (
      await streamArtwork(
        otherId,
        instanceId,
        'abc123',
        'logo',
        new Request('http://coast.test/image')
      )
    ).status
  ).toBe(404);
});
run(
  'missing Jellyfin artwork falls back to TMDB without bypassing access or caching policy',
  async () => {
    const [snapshot] = await getDb()
      .insert(metadataSnapshots)
      .values({
        mediaId,
        provider: 'tmdb',
        language: 'en-US',
        region: 'GB',
        raw: {
          artwork: { primary: 'https://image.tmdb.org/t/p/w780/fallback.jpg' },
          artworkUpdatedAt: new Date().toISOString(),
        },
      })
      .returning();
    try {
      const image = () =>
        streamArtwork(
          actorId,
          instanceId,
          'abc123',
          'primary',
          new Request('http://coast.test/image')
        );
      const result = await image();
      expect(result.status).toBe(302);
      expect(result.headers.get('Location')).toBe('https://image.tmdb.org/t/p/w780/fallback.jpg');
      const denied = await streamArtwork(
        otherId,
        instanceId,
        'abc123',
        'primary',
        new Request('http://coast.test/image')
      );
      expect(denied.status).toBe(404);
      expect(denied.headers.get('Location')).toBeNull();
      await getSql()`UPDATE system_settings SET value = jsonb_set(value, '{cacheTmdbArtwork}', 'true') WHERE key = 'coast'`;
      expect((await image()).headers.get('Location')).toBe(
        '/api/v1/artwork/tmdb/w780/fallback.jpg'
      );
    } finally {
      await getSql()`UPDATE system_settings SET value = jsonb_set(value, '{cacheTmdbArtwork}', 'false') WHERE key = 'coast'`;
      await getDb().delete(metadataSnapshots).where(eq(metadataSnapshots.id, snapshot.id));
    }
  }
);

run(
  'Jellyfin playback import is opt-in, scoped, repeatable and preserves newer Coast changes',
  async () => {
    jellyfinUserData = {
      Played: true,
      PlaybackPositionTicks: 3000000,
      PlayCount: 3,
      LastPlayedDate: '2020-01-01T00:00:00Z',
    };
    try {
      await scanJellyfin(actorId, connectionId, true);
      expect(
        await getDb().select().from(trackingState).where(eq(trackingState.mediaId, mediaId))
      ).toHaveLength(0);
      await expect(
        updateJellyfinPlaybackImport(otherId, connectionId, { enabled: true })
      ).rejects.toThrow();
      await updateJellyfinPlaybackImport(actorId, connectionId, { enabled: true });
      await scanJellyfin(actorId, connectionId, true);
      const state = async () =>
        (
          await getDb()
            .select()
            .from(trackingState)
            .where(and(eq(trackingState.mediaId, mediaId), eq(trackingState.userId, actorId)))
        )[0];
      expect(await state()).toMatchObject({ watched: true, playCount: 3 });
      expect((await state()).positionSeconds).toBeCloseTo(0.3);
      const events = async () =>
        (await getDb().select().from(trackingEvents).where(eq(trackingEvents.mediaId, mediaId)))
          .length;
      const importedCount = await events();
      await scanJellyfin(actorId, connectionId, true);
      expect(await events()).toBe(importedCount);
      await track(actorId, {
        mediaId,
        action: 'progress',
        positionSeconds: 0.6,
        durationSeconds: 1,
        occurredAt: '2021-01-01T00:00:00Z',
      });
      jellyfinUserData.PlaybackPositionTicks = 4000000;
      await scanJellyfin(actorId, connectionId, true);
      expect((await state()).positionSeconds).toBeCloseTo(0.6);
      await updateJellyfinPlaybackImport(actorId, connectionId, { enabled: false });
      jellyfinUserData.LastPlayedDate = '2022-01-01T00:00:00Z';
      await scanJellyfin(actorId, connectionId, true);
      expect((await state()).positionSeconds).toBeCloseTo(0.6);
      expect((await state()).playCount).toBe(3);
      const [connection] = await getDb()
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.id, connectionId));
      expect(connection.settings.importPlayback).toBe(false);
      expect(connection.settings.libraryScan).toBeDefined();
    } finally {
      jellyfinUserData = undefined;
      await updateJellyfinPlaybackImport(actorId, connectionId, { enabled: false });
      await getDb().delete(trackingEvents).where(eq(trackingEvents.mediaId, mediaId));
      await getDb().delete(trackingState).where(eq(trackingState.mediaId, mediaId));
    }
  }
);
run(
  'job schedules are admin-only and shared by integration while preserving connection preferences',
  async () => {
    await expect(
      updateProviderSchedule(otherId, instanceId, {
        enabled: false,
        intervalMinutes: 30,
        fullIntervalHours: 48,
      })
    ).rejects.toThrow();
    await updateProviderSchedule(actorId, instanceId, {
      enabled: false,
      intervalMinutes: 30,
      fullIntervalHours: 48,
    });
    const [connection] = await getDb()
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connectionId));
    const [instance] = await getDb()
      .select()
      .from(providerInstances)
      .where(eq(providerInstances.id, instanceId));
    expect(instance.settings.schedule).toEqual({
      enabled: false,
      intervalMinutes: 30,
      fullIntervalHours: 48,
    });
    expect(connection.settings.importPlayback).toBe(false);
    expect(connection.settings.libraryScan).toBeDefined();
  }
);
run('library scans persist real counts without exposing another user’s scan', async () => {
  const [connection] = await getDb()
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.id, connectionId));
  expect(connection.settings.libraryScan).toMatchObject({
    processed: 1,
    total: 1,
    phase: 'complete',
  });
  await expect(libraryScanProgress(otherId, connectionId)).rejects.toThrow();
  expect(await libraryScanProgress(actorId, connectionId)).toMatchObject({
    processed: 1,
    total: 1,
    phase: 'complete',
  });
});
run('native pinned transport authenticates/scans and receives typed TMDB metadata', async () => {
  const adapter = new TmdbAdapter(
    createProviderTransport({
      baseUrl,
      approved: true,
      allowPrivateNetwork: true,
      allowedPorts: [server.port!],
    })
  );
  expect((await adapter.details('movie', '100')).originalTitle).toBe('Original fixture');
  expect(seenAuthorization.some((value) => value.includes('fixture-token'))).toBe(true);
});
run(
  'integration API returns an actionable identity error for a non-Jellyfin endpoint',
  async () => {
    productName = 'Emby Server';
    try {
      const url = new URL('http://coast.test/api/v1/providers');
      const response = await POST({
        url,
        params: { path: 'providers' },
        request: new Request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: instanceId,
            provider: 'jellyfin',
            name: 'Fixture',
            baseUrl,
            allowPrivateNetwork: true,
          }),
        }),
        locals: {
          user: { id: actorId, username: 'fixture', email: null, role: 'admin', settings: {} },
        },
      } as Parameters<typeof POST>[0]);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'The endpoint is not a Jellyfin server.',
        code: 'identity',
      });
    } finally {
      productName = 'Jellyfin Server';
    }
  }
);
const sessionActions = (sessionId: string) =>
  getDb()
    .select()
    .from(outboxActions)
    .where(
      and(
        eq(outboxActions.userId, actorId),
        sql`${outboxActions.payload}->>'sessionId' = ${sessionId}`
      )
    )
    .orderBy(outboxActions.createdAt);
run(
  'prepared playback and cancellation create no progress, history, or scrobble intent',
  async () => {
    await getDb()
      .update(providerConnections)
      .set({ settings: { sync: { scrobble: true, progress: true, history: true } } })
      .where(eq(providerConnections.id, traktConnectionId));
    await getDb()
      .update(users)
      .set({ settings: { subtitlePrompt: true } })
      .where(eq(users.id, actorId));
    try {
      const session = await startPlayback(actorId, { mediaId, browser });
      expect(session.subtitlePrompt).toBe(true);
      const [prepared] = await getDb()
        .select()
        .from(playbackSessions)
        .where(eq(playbackSessions.id, session.id));
      expect(prepared.state).toBe('prepared');
      expect(await sessionActions(session.id)).toHaveLength(0);
      await progressPlayback(actorId, session.id, { positionSeconds: 0.99, event: 'progress' });
      await progressPlayback(actorId, session.id, { positionSeconds: 0.99, event: 'pause' });
      await progressPlayback(actorId, session.id, { positionSeconds: 0.99, event: 'stop' });
      await progressPlayback(actorId, session.id, { positionSeconds: 0.99, event: 'ended' });
      await progressPlayback(actorId, session.id, { positionSeconds: 0.5, event: 'start' });
      const [cancelled] = await getDb()
        .select()
        .from(playbackSessions)
        .where(eq(playbackSessions.id, session.id));
      expect(cancelled.state).toBe('stopped');
      expect(cancelled.positionSeconds).toBe(0);
      expect(await sessionActions(session.id)).toHaveLength(0);
      expect(
        await getDb().select().from(trackingEvents).where(eq(trackingEvents.userId, actorId))
      ).toHaveLength(0);
      expect(
        await getDb().select().from(trackingState).where(eq(trackingState.userId, actorId))
      ).toHaveLength(0);
    } finally {
      await getDb()
        .update(providerConnections)
        .set({ settings: { sync: {} } })
        .where(eq(providerConnections.id, traktConnectionId));
      await getDb().update(users).set({ settings: {} }).where(eq(users.id, actorId));
    }
  }
);
run(
  'concurrent starts are idempotent and pause/resume preserves Trakt lifecycle order',
  async () => {
    await getDb()
      .update(providerConnections)
      .set({ settings: { sync: { scrobble: true } } })
      .where(eq(providerConnections.id, traktConnectionId));
    const session = await startPlayback(actorId, { mediaId, browser });
    try {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          progressPlayback(actorId, session.id, { positionSeconds: 0.1, event: 'start' })
        )
      );
      await progressPlayback(actorId, session.id, { positionSeconds: 0.2, event: 'pause' });
      const pauseAction = (await sessionActions(session.id)).find(
        (action) => action.kind === 'jellyfin.scrobble' && action.payload.event === 'progress'
      )!;
      await getDb()
        .insert(notifications)
        .values({
          userId: actorId,
          kind: 'external-action',
          title: 'Synthetic retry notice',
          sourceKey: `outbox:${pauseAction.id}`,
        });
      await progressPlayback(actorId, session.id, { positionSeconds: 0.2, event: 'start' });
      expect(
        await getDb()
          .select()
          .from(notifications)
          .where(eq(notifications.sourceKey, `outbox:${pauseAction.id}`))
      ).toHaveLength(0);
      await progressPlayback(actorId, session.id, { positionSeconds: 0.2, event: 'start' });
      const actions = await sessionActions(session.id);
      expect(
        actions.filter(
          (action) => action.kind === 'jellyfin.scrobble' && action.payload.event === 'start'
        )
      ).toHaveLength(1);
      expect(
        actions
          .filter((action) => action.kind === 'trakt.scrobble')
          .map((action) => action.payload.event)
      ).toEqual(['start', 'pause', 'start']);
      const [active] = await getDb()
        .select()
        .from(playbackSessions)
        .where(eq(playbackSessions.id, session.id));
      expect(active.state).toBe('active');
      await progressPlayback(actorId, session.id, { positionSeconds: 0.25, event: 'stop' });
      await progressPlayback(actorId, session.id, { positionSeconds: 0.25, event: 'start' });
      expect(
        (await sessionActions(session.id))
          .filter((action) => action.kind === 'trakt.scrobble')
          .map((action) => action.payload.event)
      ).toEqual(['start', 'pause', 'start', 'stop']);
    } finally {
      // This test examines durable intent, without dispatching a synthetic account to public Trakt.
      await getDb()
        .update(outboxActions)
        .set({ state: 'cancelled' })
        .where(
          and(
            eq(outboxActions.connectionId, traktConnectionId),
            sql`${outboxActions.payload}->>'sessionId' = ${session.id}`
          )
        );
      await getDb()
        .update(providerConnections)
        .set({ settings: { sync: {} } })
        .where(eq(providerConnections.id, traktConnectionId));
    }
  }
);
run(
  'first-start queue failure rolls back session and canonical progress so retry retains start',
  async () => {
    const session = await startPlayback(actorId, { mediaId, browser });
    const [before] = await getDb()
      .select()
      .from(trackingState)
      .where(and(eq(trackingState.userId, actorId), eq(trackingState.mediaId, mediaId)));
    const beforeEvents = await getDb()
      .select({ id: trackingEvents.id })
      .from(trackingEvents)
      .where(eq(trackingEvents.userId, actorId));
    const trigger = `playback_start_failure_${fixtureName.replaceAll('-', '')}`;
    await getSql().unsafe(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'jellyfin.scrobble' AND NEW.payload->>'sessionId' = '${session.id}' AND NEW.payload->>'event' = 'start' THEN RAISE EXCEPTION 'synthetic first-start queue failure'; END IF; RETURN NEW; END $$`
    );
    await getSql().unsafe(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON outbox_actions FOR EACH ROW EXECUTE FUNCTION ${trigger}()`
    );
    try {
      await expect(
        progressPlayback(actorId, session.id, { positionSeconds: 0.5, event: 'start' })
      ).rejects.toThrow();
      const [prepared] = await getDb()
        .select()
        .from(playbackSessions)
        .where(eq(playbackSessions.id, session.id));
      expect(prepared.state).toBe('prepared');
      expect(await sessionActions(session.id)).toHaveLength(0);
      const [after] = await getDb()
        .select()
        .from(trackingState)
        .where(and(eq(trackingState.userId, actorId), eq(trackingState.mediaId, mediaId)));
      expect(after).toEqual(before);
      expect(
        await getDb()
          .select({ id: trackingEvents.id })
          .from(trackingEvents)
          .where(eq(trackingEvents.userId, actorId))
      ).toHaveLength(beforeEvents.length);
    } finally {
      await getSql().unsafe(`DROP TRIGGER ${trigger} ON outbox_actions`);
      await getSql().unsafe(`DROP FUNCTION ${trigger}()`);
    }
    await progressPlayback(actorId, session.id, { positionSeconds: 0.5, event: 'start' });
    expect(
      (await sessionActions(session.id)).filter((action) => action.payload.event === 'start')
    ).toHaveLength(1);
    await progressPlayback(actorId, session.id, { positionSeconds: 0.5, event: 'stop' });
  }
);
run('direct session streams a real MP4 range and rejects another Coast user', async () => {
  const session = await startPlayback(actorId, { mediaId, browser });
  expect(session.kind).toBe('direct');
  expect(session.url).not.toContain('fixture-token');
  const response = await streamPlayback(
    actorId,
    session.id,
    new Request(`http://coast.test${session.url}`, { headers: { Range: 'bytes=0-31' } })
  );
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toStartWith('bytes 0-31/');
  expect((await response.arrayBuffer()).byteLength).toBe(32);
  const denied = await streamPlayback(
    otherId,
    session.id,
    new Request(`http://coast.test${session.url}`)
  );
  expect(denied.status).toBe(410);
  await progressPlayback(actorId, session.id, { positionSeconds: 0, event: 'start' });
  await progressPlayback(actorId, session.id, { positionSeconds: 0.95, event: 'progress' });
  await progressPlayback(actorId, session.id, { positionSeconds: 0.99, event: 'ended' });
  await progressPlayback(actorId, session.id, { positionSeconds: 0.3, event: 'progress' });
  const [stopped] = await getDb()
    .select()
    .from(playbackSessions)
    .where(eq(playbackSessions.id, session.id));
  expect(stopped.state).toBe('stopped');
  const completion = await getDb()
    .select()
    .from(trackingEvents)
    .where(
      and(
        eq(trackingEvents.userId, actorId),
        eq(trackingEvents.sourceEventId, `playback:${session.id}`)
      )
    );
  expect(completion).toHaveLength(1);
});
run(
  'completed titles resume new rewatch progress while completed and older editions start at zero',
  async () => {
    const rewatch = await startPlayback(actorId, { mediaId, browser });
    expect(rewatch.startSeconds).toBe(0);
    const [before] = await getDb()
      .select()
      .from(trackingState)
      .where(and(eq(trackingState.userId, actorId), eq(trackingState.mediaId, mediaId)));
    expect(before.watched).toBe(true);
    await progressPlayback(actorId, rewatch.id, { positionSeconds: 0, event: 'start' });
    await progressPlayback(actorId, rewatch.id, { positionSeconds: 0.3, event: 'progress' });
    await progressPlayback(actorId, rewatch.id, { positionSeconds: 0.3, event: 'stop' });
    const resumed = await startPlayback(actorId, { mediaId, browser });
    expect(resumed.startSeconds).toBeCloseTo(0.3);
    const fromBeginning = await startPlayback(actorId, { mediaId, browser, fromStart: true });
    expect(fromBeginning.startSeconds).toBe(0);
    await progressPlayback(actorId, fromBeginning.id, { positionSeconds: 0, event: 'stop' });
    const [state] = await getDb()
      .select()
      .from(trackingState)
      .where(and(eq(trackingState.userId, actorId), eq(trackingState.mediaId, mediaId)));
    expect(state.watched).toBe(true);
    expect(state.playCount).toBe(before.playCount);
    await getDb()
      .insert(editionProgress)
      .values({
        userId: actorId,
        mediaId,
        editionId: `${connectionId}:source-hls`,
        positionSeconds: 0.4,
        durationSeconds: 1,
        updatedAt: new Date(state.lastWatchedAt!.getTime() - 1000),
      });
    const olderEdition = await startPlayback(actorId, { mediaId, sourceId: 'source-hls', browser });
    expect(olderEdition.startSeconds).toBe(0);
    await progressPlayback(actorId, resumed.id, { positionSeconds: 0.3, event: 'stop' });
    await progressPlayback(actorId, olderEdition.id, { positionSeconds: 0, event: 'stop' });
  }
);
run(
  'playlist sessions resume their own entry and completion cannot consume a repeated title',
  async () => {
    const list = await createList(actorId, { name: 'Playback entries', playlist: true });
    try {
      await addListItem(actorId, list.id, mediaId);
      await addListItem(actorId, list.id, mediaId);
      await restartPlaylist(actorId, list.id);
      const entries = (await getList(actorId, list.id)).items;
      const source = { kind: 'playlist' as const, id: list.id };
      const sequence = { ...source, entryId: entries[0].entryId };
      const first = await startPlayback(actorId, { mediaId, browser, sequence });
      expect(first.startSeconds).toBe(0);
      expect(first.sequence).toEqual(sequence);
      await progressPlayback(actorId, first.id, { positionSeconds: 0, event: 'start' });
      await progressPlayback(actorId, first.id, { positionSeconds: 0.3, event: 'stop' });
      const resumed = await startPlayback(actorId, { mediaId, browser, sequence });
      expect(resumed.startSeconds).toBeCloseTo(0.3);
      const second = await startPlayback(actorId, {
        mediaId,
        browser,
        sequence: { ...source, entryId: entries[1].entryId },
      });
      expect(second.startSeconds).toBe(0);
      await progressPlayback(actorId, second.id, { positionSeconds: 0, event: 'stop' });
      await progressPlayback(actorId, resumed.id, { positionSeconds: 0.3, event: 'start' });
      await progressPlayback(actorId, resumed.id, { positionSeconds: 0.99, event: 'ended' });
      expect((await sequenceEntries(actorId, source)).map((entry) => entry.watched)).toEqual([
        true,
        false,
      ]);
    } finally {
      await deleteList(actorId, list.id);
    }
  }
);
run(
  'HLS manifests and real transport-stream segments stay inside the authorised session',
  async () => {
    const session = await startPlayback(actorId, { mediaId, sourceId: 'source-hls', browser });
    expect(session.kind).toBe('hls');
    const master = await (
      await streamPlayback(actorId, session.id, new Request(`http://coast.test${session.url}`))
    ).text();
    expect(master).not.toContain('upstream-secret');
    const variant = master.split('\n').find((line) => line.startsWith('/api/'))!;
    const playlist = await (
      await streamPlayback(actorId, session.id, new Request(`http://coast.test${variant}`))
    ).text();
    expect(playlist).not.toContain('upstream-secret');
    const segment = playlist.split('\n').find((line) => line.startsWith('/api/'))!;
    const response = await streamPlayback(
      actorId,
      session.id,
      new Request(`http://coast.test${segment}`)
    );
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes[0]).toBe(0x47);
    expect(bytes.length).toBeGreaterThan(188);
    const forbidden = await streamPlayback(
      actorId,
      session.id,
      new Request(`http://coast.test${segment}tampered`)
    );
    expect(forbidden.status).toBe(403);
  }
);
run(
  'concurrent requests atomically deduplicate local rows, watchlist and external queue delivery',
  async () => {
    expect(await requestOptions(actorId, mediaId)).toHaveLength(1);
    const dto = await listProviders(actorId);
    expect(JSON.stringify(dto)).not.toContain('requestOptionsCache');
    seerrOffline = true;
    const input = { mediaId, instanceId: seerrId, is4k: false, addToWatchlist: true };
    const [a, b] = await Promise.all([requestMedia(actorId, input), requestMedia(actorId, input)]);
    expect(a.id).toBe(b.id);
    const pending = await getDb()
      .select()
      .from(outboxActions)
      .where(and(eq(outboxActions.userId, actorId), eq(outboxActions.kind, 'seerr.request')));
    expect(pending).toHaveLength(1);
    const watches = await getDb()
      .select()
      .from(trackingEvents)
      .where(
        and(
          eq(trackingEvents.userId, actorId),
          eq(trackingEvents.mediaId, mediaId),
          eq(trackingEvents.action, 'watchlist')
        )
      );
    expect(watches).toHaveLength(1);
    for (let i = 0; i < 15; i++) {
      await runQueueOnce();
      const [attempt] = await getDb()
        .select()
        .from(outboxActions)
        .where(eq(outboxActions.id, pending[0].id));
      if (attempt.attempts > 0) {
        expect(attempt.state).toBe('pending');
        break;
      }
    }
    expect(requestCalls).toBe(0);
    seerrOffline = false;
    await getDb()
      .update(outboxActions)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(outboxActions.id, pending[0].id));
    for (let i = 0; i < 15 && requestCalls === 0; i++) await runQueueOnce();
    expect(requestCalls).toBe(1);
    const [stored] = await getDb().select().from(mediaRequests).where(eq(mediaRequests.id, a.id));
    expect(stored.state).toBe('approved');
    expect(stored.externalId).toBe('1');
  }
);

run(
  'an interrupted library page preserves availability; a complete empty scan invalidates it',
  async () => {
    scanMode = 'broken';
    await expect(scanJellyfin(actorId, connectionId, true)).rejects.toThrow('incomplete library');
    expect(
      (
        await getDb()
          .select()
          .from(availability)
          .where(
            and(eq(availability.connectionId, connectionId), eq(availability.state, 'available'))
          )
      ).length
    ).toBe(2);
    scanMode = 'empty';
    await scanJellyfin(actorId, connectionId, true);
    expect(
      await getDb()
        .select()
        .from(availability)
        .where(
          and(eq(availability.connectionId, connectionId), eq(availability.state, 'available'))
        )
    ).toHaveLength(0);
  }
);

run(
  'Trakt refresh and selective history import preserve source identities over real HTTP',
  async () => {
    const transport = createProviderTransport({
      baseUrl,
      approved: true,
      allowPrivateNetwork: true,
      allowedPorts: [server.port!],
    });
    const initial = new TraktAdapter(transport, 'synthetic-client', 'synthetic-secret');
    const tokens = await initial.refresh('synthetic-refresh');
    expect(tokens.access_token).toBe('synthetic-refreshed');
    expect(tokens.refresh_token).toBe('synthetic-next-refresh');
    const adapter = new TraktAdapter(
        transport,
        'synthetic-client',
        'synthetic-secret',
        tokens.access_token
      ),
      sync = { ...defaultSyncPreferences, history: true };
    const start = seenPaths.length;
    const [beforeImport] = await getDb()
      .select()
      .from(trackingState)
      .where(and(eq(trackingState.userId, actorId), eq(trackingState.mediaId, mediaId)));
    const first = await importTraktFromAdapter(actorId, traktConnectionId, { adapter, sync });
    const again = await importTraktFromAdapter(actorId, traktConnectionId, { adapter, sync });
    expect(first.imported).toBe(2);
    expect(again.imported).toBe(0);
    expect(seenPaths.slice(start).every((path) => path === '/sync/history')).toBe(true);
    const events = await getDb()
      .select()
      .from(trackingEvents)
      .where(and(eq(trackingEvents.userId, actorId), eq(trackingEvents.source, 'trakt')));
    expect(events).toHaveLength(2);
    expect(
      events.every((event) => event.sourceEventId?.startsWith(`${traktConnectionId}:history:`))
    ).toBe(true);
    const [state] = await getDb()
      .select()
      .from(trackingState)
      .where(and(eq(trackingState.userId, actorId), eq(trackingState.mediaId, mediaId)));
    expect(state.playCount).toBe(beforeImport.playCount + 2);
  }
);
run('Trakt durable export reconciles a lost response before retrying history', async () => {
  const adapter = new TraktAdapter(
      createProviderTransport({
        baseUrl,
        approved: true,
        allowPrivateNetwork: true,
        allowedPorts: [server.port!],
      }),
      'synthetic-client',
      'synthetic-secret',
      'synthetic-refreshed'
    ),
    sync = { ...defaultSyncPreferences, history: true };
  registerActionHandler('fixture.trakt-export', (action) =>
    exportTraktToAdapter(action.userId, action.payload, { adapter, sync })
  );
  const actionId = await enqueueAction({
    userId: actorId,
    connectionId: traktConnectionId,
    kind: 'fixture.trakt-export',
    payload: { mediaId, category: 'history', occurredAt: '2026-02-01T12:00:00.000Z' },
  });
  for (let i = 0; i < 20 && traktWrites === 0; i++) await runQueueOnce();
  const [waiting] = await getDb()
    .select()
    .from(outboxActions)
    .where(eq(outboxActions.id, actionId));
  expect(waiting.state).toBe('pending');
  expect(waiting.attempts).toBe(1);
  expect(waiting.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  await getDb()
    .update(outboxActions)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(eq(outboxActions.id, actionId));
  for (let i = 0; i < 20; i++) {
    await runQueueOnce();
    const [action] = await getDb()
      .select()
      .from(outboxActions)
      .where(eq(outboxActions.id, actionId));
    if (action.attempts >= 2) break;
  }
  const [done] = await getDb().select().from(outboxActions).where(eq(outboxActions.id, actionId));
  expect(done.state).toBe('succeeded');
  expect(done.attempts).toBe(2);
  expect(traktWrites).toBe(1);
  expect(exportedHistory).toHaveLength(1);
});
