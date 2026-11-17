import * as v from 'valibot';
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { namedEdition } from '#lib/media/editions.js';
import { getJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import { jellyfinItemKey } from '#lib/providers/jellyfin/paging.js';
import { getDb } from '#lib/server/db/index.js';
import { availability, media, playbackSessions, providerConnections, providerInstances, providerItems } from '#lib/server/db/schema.js';
import { requireEnabledCategory } from '#lib/server/experimental.js';
import { requireFeature } from '#lib/server/features.js';
import { decryptCredential, encryptCredential } from '#lib/server/security/credentials.js';
import { AppError } from '#lib/server/security/errors.js';
import type { SessionUser } from '#lib/server/auth/index.js';
import { playbackResourceUrl } from './service.server';
import { addedSubtitleTrack, subtitleLanguage, subtitlePath, subtitleTrack, textSubtitle, type AddedSubtitle, type SubtitleOptions, type SubtitleResult } from './subtitles';

const id = v.pipe(v.string(), v.uuid());
const short = v.pipe(v.string(), v.maxLength(500));
const token = v.pipe(v.string(), v.maxLength(4096));
const identity = v.object({
  viewer: id, target: id, session: v.boolean(), connection: id, instance: id, generation: id,
  item: v.pipe(v.string(), v.regex(/^[\da-f-]+$/i), v.maxLength(36)), source: short,
  availability: v.optional(id), expires: v.number(),
});
const scopeSchema = v.object({ kind: v.literal('subtitle-search'), target: identity });
const ticketSchema = v.object({
  kind: v.literal('subtitle-download'), target: identity, result: short, language: short,
  forced: v.optional(v.boolean()), sdh: v.optional(v.boolean()),
});
type Target = { id: string; session: boolean };
type Source = v.InferOutput<typeof identity>;
type Provider = Awaited<ReturnType<typeof getJellyfin>>;
type Version = Awaited<ReturnType<Provider['adapter']['subtitleSources']>>[number];
const downloads = new Map<string, { ticket: string; promise: Promise<AddedSubtitle> }>();
const scopeLifetime = 15 * 60 * 1000;
const limit = 80;

function unavailable() { return new AppError(404, 'This Jellyfin video source is unavailable.'); }
async function openToken<T extends typeof scopeSchema | typeof ticketSchema>(schema: T, value: unknown): Promise<v.InferOutput<T>> {
  try { return v.parse(schema, JSON.parse(await decryptCredential(v.parse(token, value)))); }
  catch { throw new AppError(400, 'Open the subtitle search again to refresh its results.'); }
}
function checkTarget(source: Source, user: SessionUser, target: Target) {
  if (source.viewer !== user.id || source.target !== target.id || source.session !== target.session || source.expires <= Date.now())
    throw new AppError(409, 'The subtitle search has expired. Open it again.');
}
async function resolveSource(user: SessionUser, target: Target, query: URLSearchParams, expected?: Source) {
  const policy = await requireFeature(user.id, 'playback');
  requireEnabledCategory(policy, 'screen');
  if (policy.libraryOnly) throw new AppError(403, 'This account cannot manage subtitles.');
  const db = getDb();
  let connectionId: string, itemId: string, sourceId: string, availabilityId: string | undefined, expiresAt: Date | undefined;
  let generation: string | null | undefined;
  if (target.session) {
    const [row] = await db.select({ session: playbackSessions, item: providerItems.externalId }).from(playbackSessions)
      .innerJoin(providerItems, eq(providerItems.id, playbackSessions.providerItemId))
      .where(and(eq(playbackSessions.id, target.id), eq(playbackSessions.userId, user.id),
        inArray(providerItems.kind, ['movie', 'episode']), isNull(playbackSessions.shareId),
        ne(playbackSessions.state, 'stopped'), gt(playbackSessions.expiresAt, new Date()))).limit(1);
    if (!row) throw unavailable();
    ({ connectionId, sourceId, expiresAt, accountGeneration: generation } = row.session);
    itemId = row.item;
  } else {
    const edition = v.parse(v.optional(short), query.get('edition') ?? undefined);
    const editionName = v.parse(v.optional(short), query.get('editionName') ?? undefined);
    const candidates = db.select({
      id: availability.id, connectionId: availability.connectionId, sourceId: availability.sourceId,
      edition: availability.edition, item: providerItems.externalId, title: media.title,
    }).from(availability)
      .innerJoin(media, eq(media.id, availability.mediaId))
      .innerJoin(providerItems, eq(providerItems.id, availability.providerItemId))
      .innerJoin(providerConnections, eq(providerConnections.id, availability.connectionId))
      .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
      .where(and(eq(availability.mediaId, target.id), eq(availability.userId, user.id), eq(availability.state, 'available'),
        eq(providerConnections.userId, user.id), eq(providerConnections.status, 'connected'), eq(providerInstances.enabled, true),
        eq(providerInstances.provider, 'jellyfin'), eq(providerItems.instanceId, providerInstances.id),
        edition === undefined ? undefined : eq(sql`coalesce(${availability.edition}, '')`, edition),
        inArray(providerItems.kind, ['movie', 'episode']), expected?.availability ? eq(availability.id, expected.availability) : undefined))
      .orderBy(desc(availability.verifiedAt), availability.id);
    const row = editionName === undefined ? (await candidates.limit(1))[0] :
      (await candidates).find(row => namedEdition(row.edition, row.title ?? '').value === editionName);
    if (!row) throw unavailable();
    ({ id: availabilityId, connectionId, sourceId } = row);
    itemId = row.item;
    if (sourceId === 'default') sourceId = expected?.source ?? itemId;
  }
  const provider = await getJellyfin(user.id, connectionId);
  if (generation && provider.connection.accountGeneration !== generation) throw unavailable();
  if (expected && (expected.connection !== connectionId || expected.instance !== provider.instance.id || expected.generation !== provider.connection.accountGeneration ||
      expected.item !== itemId || expected.source !== sourceId)) throw unavailable();
  return { ...provider, itemId, sourceId, availabilityId, expiresAt, policy };
}
type Resolved = Awaited<ReturnType<typeof resolveSource>>;
function providerUser(source: Resolved) { return source.connection.externalUserId!; }
async function version(source: Resolved, signal?: AbortSignal) {
  const versions = await source.adapter.subtitleSources(providerUser(source), source.itemId, signal);
  const found = versions.find(entry => jellyfinItemKey(entry.id) === jellyfinItemKey(source.sourceId));
  if (!found) throw unavailable();
  return found;
}
function exactVideo(source: Resolved) {
  // Jellyfin's remote search and save target a video item ID, not a PlaybackInfo source ID.
  return jellyfinItemKey(source.itemId) === jellyfinItemKey(source.sourceId);
}
async function publicTracks(source: Resolved, target: Target, selected: Version) {
  return Promise.all(selected.tracks.filter(textSubtitle).map(async stream => {
    const track = subtitleTrack(stream);
    if (source.expiresAt) track.url = await playbackResourceUrl(target.id, subtitlePath(source.itemId, selected.id, track.index), source.expiresAt);
    return track;
  }));
}
export async function subtitleOptions(user: SessionUser, target: Target, query: URLSearchParams, signal: AbortSignal): Promise<SubtitleOptions> {
  const source = await resolveSource(user, target, query);
  await source.adapter.identity(source.instance.serverIdentity || undefined, signal);
  const selected = await version(source, signal);
  const preferred = (user.settings.subtitleLanguages || source.policy.subtitleLanguages).map(subtitleLanguage).find(Boolean) ?? 'en';
  const permission = exactVideo(source) && await source.adapter.canManageSubtitles(providerUser(source), signal);
  const context: Source = {
    viewer: user.id, target: target.id, session: target.session, connection: source.connection.id,
    instance: source.instance.id, generation: source.connection.accountGeneration, item: source.itemId, source: source.sourceId,
    availability: source.availabilityId, expires: Date.now() + scopeLifetime,
  };
  return {
    tracks: await publicTracks(source, target, selected), preferred, version: selected.label,
    scope: permission ? await encryptCredential(JSON.stringify({ kind: 'subtitle-search', target: context })) : undefined,
    expiresAt: permission ? context.expires : undefined,
    source: source.availabilityId ? { availabilityId: source.availabilityId, sourceId: selected.id } : undefined,
    unavailable: permission ? undefined : exactVideo(source)
      ? 'Your Jellyfin account needs subtitle management permission.' : 'Jellyfin cannot search subtitles for this video version.',
  };
}
export async function searchSubtitles(user: SessionUser, target: Target, body: unknown, signal: AbortSignal): Promise<SubtitleResult[]> {
  const input = v.parse(v.object({ scope: token, language: short }), body);
  const { target: expected } = await openToken(scopeSchema, input.scope);
  checkTarget(expected, user, target);
  const language = subtitleLanguage(input.language);
  if (!language) throw new AppError(400, 'Choose a supported subtitle language.');
  const source = await resolveSource(user, target, new URLSearchParams(), expected);
  if (!exactVideo(source)) throw unavailable();
  await source.adapter.identity(source.instance.serverIdentity || undefined, signal);
  const results = await source.adapter.remoteSubtitles(source.itemId, language, signal);
  const ranked = results.sort((a, b) => Number(b.IsHashMatch === true) - Number(a.IsHashMatch === true)
    || (b.DownloadCount ?? 0) - (a.DownloadCount ?? 0));
  const unique = new Set<string>();
  const listed = ranked.filter(result => !unique.has(result.Id) && unique.add(result.Id)).slice(0, limit);
  return Promise.all(listed.map(async result => ({
    id: result.Id,
    ticket: await encryptCredential(JSON.stringify({ kind: 'subtitle-download', target: expected,
      result: result.Id, language, forced: result.Forced ?? undefined, sdh: result.HearingImpaired ?? undefined })),
    name: (result.Name || 'OpenSubtitles result').slice(0, 400), format: result.Format ?? undefined,
    exact: result.IsHashMatch === true, sdh: result.HearingImpaired ?? undefined, forced: result.Forced ?? undefined,
    translated: result.AiTranslated === true || result.MachineTranslated === true, downloads: result.DownloadCount ?? undefined,
  })));
}

export async function downloadSubtitle(user: SessionUser, target: Target, body: unknown): Promise<AddedSubtitle> {
  const input = v.parse(v.object({ ticket: token }), body);
  const { target: expected, result, language, forced, sdh } = await openToken(ticketSchema, input.ticket);
  checkTarget(expected, user, target);
  const key = `${expected.instance}:${jellyfinItemKey(expected.item)}`;
  const active = downloads.get(key);
  if (active?.ticket === input.ticket) return active.promise;
  if (active) throw new AppError(409, 'A subtitle for this video is already downloading.');
  const promise = (async () => {
    const source = await resolveSource(user, target, new URLSearchParams(), expected);
    if (!exactVideo(source)) throw unavailable();
    await source.adapter.identity(source.instance.serverIdentity || undefined);
    const before = await version(source);
    await source.adapter.downloadSubtitle(source.itemId, result);
    // A 204 acknowledges the command. Jellyfin refreshes the streams asynchronously.
    for (const wait of [0, 350, 700, 1400, 2200]) {
      if (wait) await Bun.sleep(wait);
      const after = await version(source);
      const match = addedSubtitleTrack(before.tracks, after.tracks, { language, forced, sdh });
      if (match) return {
        tracks: await publicTracks(source, target, after), index: match.index,
        source: source.availabilityId ? { availabilityId: source.availabilityId, sourceId: after.id } : undefined,
      };
    }
    throw new AppError(502, 'Jellyfin did not confirm the new subtitle. Check the available tracks before downloading again.');
  })().finally(() => downloads.delete(key));
  downloads.set(key, { ticket: input.ticket, promise });
  return promise;
}
