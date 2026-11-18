import * as v from 'valibot';
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { namedEdition } from '#lib/media/editions.js';
import { getJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import { getInstance, jellyfinManagement } from '#lib/providers/instances.server.js';
import { jellyfinItemKey } from '#lib/providers/jellyfin/paging.js';
import { getDb, getSql } from '#lib/server/db/index.js';
import { availability, media, playbackSessions, providerConnections, providerInstances, providerItems } from '#lib/server/db/schema.js';
import { requireEnabledCategory } from '#lib/server/experimental.js';
import { requireFeature } from '#lib/server/features.js';
import { decryptCredential, encryptCredential } from '#lib/server/security/credentials.js';
import { AppError } from '#lib/server/security/errors.js';
import { notifyAdministrators } from '#lib/server/notifications/index.js';
import type { SessionUser } from '#lib/server/auth/index.js';
import { playbackResourceUrl } from './service.server';
import { addedSubtitleTrack, subtitleLanguage, subtitlePath, subtitleTrack, textSubtitle, type AddedSubtitle, type SubtitleOptions, type SubtitleResult } from './subtitles';

const id = v.pipe(v.string(), v.uuid());
const short = v.pipe(v.string(), v.maxLength(500));
const token = v.pipe(v.string(), v.maxLength(4096));
const subtitleFingerprintSchema=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/));
const identity = v.object({
  viewer: id, target: id, session: v.boolean(), connection: id, instance: id, generation: id,
  item: v.pipe(v.string(), v.regex(/^[\da-f-]+$/i), v.maxLength(36)), source: short,
  availability: v.optional(id), management: v.optional(id), expires: v.number(),
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
  let connectionId: string, itemId: string, providerItemId:string, sourceId: string, availabilityId: string | undefined, expiresAt: Date | undefined;
  let generation: string | null | undefined;
  if (target.session) {
    const [row] = await db.select({ session: playbackSessions, item: providerItems.externalId }).from(playbackSessions)
      .innerJoin(providerItems, eq(providerItems.id, playbackSessions.providerItemId))
      .where(and(eq(playbackSessions.id, target.id), eq(playbackSessions.userId, user.id),
        inArray(providerItems.kind, ['movie', 'episode']), isNull(playbackSessions.shareId),
        ne(playbackSessions.state, 'stopped'), gt(playbackSessions.expiresAt, new Date()))).limit(1);
    if (!row) throw unavailable();
    ({ connectionId, providerItemId, sourceId, expiresAt, accountGeneration: generation } = row.session);
    itemId = row.item;
  } else {
    const edition = v.parse(v.optional(short), query.get('edition') ?? undefined);
    const editionName = v.parse(v.optional(short), query.get('editionName') ?? undefined);
    const candidates = db.select({
      id: availability.id, connectionId: availability.connectionId, sourceId: availability.sourceId,
      edition: availability.edition, item: providerItems.externalId, providerItemId:providerItems.id, title: media.title,
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
    ({ id: availabilityId, connectionId, providerItemId, sourceId } = row);
    itemId = row.item;
    if (sourceId === 'default') sourceId = expected?.source ?? itemId;
  }
  const provider = await getJellyfin(user.id, connectionId);
  if (generation && provider.connection.accountGeneration !== generation) throw unavailable();
  if (expected && (expected.connection !== connectionId || expected.instance !== provider.instance.id || expected.generation !== provider.connection.accountGeneration ||
      expected.item !== itemId || expected.source !== sourceId)) throw unavailable();
  return { ...provider, itemId, providerItemId, sourceId, availabilityId, expiresAt, policy };
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
function managementGeneration(source:Resolved) {
  const instance=source.instance;
  return instance.settings.subtitleAuthority==='server'?String(instance.settings.managementKeyGeneration??''):undefined;
}
async function searchAuthority(source:Resolved,expected:Source,signal?:AbortSignal) {
  if(managementGeneration(source)!==expected.management)
    throw new AppError(409,'Subtitle permissions changed. Open the subtitle search again.');
  if(expected.management)return (await jellyfinManagement(source.instance,signal)).adapter;
  await source.adapter.identity(source.instance.serverIdentity||undefined,signal);
  if(!await source.adapter.canManageSubtitles(providerUser(source),signal))
    throw new AppError(403,'Your Jellyfin account needs subtitle management permission.');
  return source.adapter;
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
  const management=managementGeneration(source);
  const permission = exactVideo(source) && (management===undefined
    ? await source.adapter.canManageSubtitles(providerUser(source), signal)
    : !!management&&!!source.instance.credentials);
  const context: Source = {
    viewer: user.id, target: target.id, session: target.session, connection: source.connection.id,
    instance: source.instance.id, generation: source.connection.accountGeneration, item: source.itemId, source: source.sourceId,
    availability: source.availabilityId, management, expires: Date.now() + scopeLifetime,
  };
  return {
    tracks: await publicTracks(source, target, selected), preferred, version: selected.label,
    scope: permission ? await encryptCredential(JSON.stringify({ kind: 'subtitle-search', target: context })) : undefined,
    expiresAt: permission ? context.expires : undefined,
    source: source.availabilityId ? { availabilityId: source.availabilityId, sourceId: selected.id } : undefined,
    unavailable: permission ? undefined : exactVideo(source)
      ? management===undefined?'Your Jellyfin account needs subtitle management permission.':'A Coast admin needs to configure the Jellyfin server API key.'
      : 'Jellyfin cannot search subtitles for this video version.',
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
  const authority=await searchAuthority(source,expected,signal);
  if(expected.management)await version(source,signal);
  const results = await authority.remoteSubtitles(source.itemId, language, signal);
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
    const authority=await searchAuthority(source,expected);
    const before = await version(source);
    await authority.downloadSubtitle(source.itemId, result);
    // A 204 acknowledges the command. Jellyfin refreshes the streams asynchronously.
    for (const wait of [0, 350, 700, 1400, 2200]) {
      if (wait) await Bun.sleep(wait);
      const after = await version(source);
      const match = addedSubtitleTrack(before.tracks, after.tracks, { language, forced, sdh });
      if (match) {
        if(match.subtitleFingerprint)await getSql()`insert into subtitle_downloads (provider_item_id,source_id,fingerprint,label)
          values (${source.providerItemId},${after.id},${match.subtitleFingerprint},${subtitleTrack(match).label.slice(0,200)})
          on conflict do nothing`;
        return {
          tracks: await publicTracks(source, target, after), index: match.index,
          source: source.availabilityId ? { availabilityId: source.availabilityId, sourceId: after.id } : undefined,
        };
      }
    }
    void notifyAdministrators({
      kind:'external-action',title:`${source.instance.name} could not confirm a subtitle download`,
      body:'Jellyfin accepted the download, but the new track did not appear. Check the Jellyfin subtitle and media-probe logs.',
      sourceKey:`admin-attention:subtitle:${source.instance.id}`,
      data:{actorId:user.id,subjectId:source.instance.id,destination:'/settings/integrations'},
    }).catch(()=>{});
    throw new AppError(502,'Jellyfin could not make the subtitle available. Check the available tracks before downloading again.','subtitle_unconfirmed');
  })().finally(() => downloads.delete(key));
  downloads.set(key, { ticket: input.ticket, promise });
  return promise;
}

export async function recordSubtitleOutcome(user:SessionUser,target:Target,body:unknown,signal:AbortSignal) {
  const {index,outcome,fingerprint}=v.parse(v.strictObject({
    index:v.pipe(v.number(),v.integer(),v.minValue(0)),outcome:v.picklist(['loaded','failed']),fingerprint:subtitleFingerprintSchema,
  }),body);
  const source=await resolveSource(user,target,new URLSearchParams());
  const selected=await version(source,signal);
  if(!selected.tracks.some(track=>track.index===index&&track.subtitleFingerprint===fingerprint&&textSubtitle(track)))return;
  const providerItem=source.providerItemId,sourceId=selected.id;
  const db=getSql();
  if(outcome==='failed'){
    await db`update subtitle_downloads set failed_at=now()
      where provider_item_id=${providerItem} and source_id=${sourceId} and fingerprint=${fingerprint}`;
    return;
  }
  await db`with remembered as (
    insert into subtitle_preferences (user_id,provider_item_id,source_id,fingerprint)
    values (${user.id},${providerItem},${sourceId},${fingerprint}) on conflict (user_id,provider_item_id,source_id)
    do update set fingerprint=excluded.fingerprint where subtitle_preferences.fingerprint is distinct from excluded.fingerprint
  )
  update subtitle_downloads set last_loaded_at=now(),failed_at=null
    where provider_item_id=${providerItem} and source_id=${sourceId} and fingerprint=${fingerprint}`;
}

const reviewable = (db:ReturnType<typeof getSql>) => db`d.created_at < now()-interval '24 hours'
  and d.failed_at is not null and d.last_loaded_at is null`;

export async function listFailedSubtitleDownloads(instanceId:string) {
  const db=getSql();
  return db<{itemId:string;sourceId:string;fingerprint:string;label:string;title:string;failedAt:Date}[]>`
    select d.provider_item_id as "itemId",d.source_id as "sourceId",d.fingerprint,d.label,m.title,d.failed_at as "failedAt"
    from provider_items i join subtitle_downloads d on d.provider_item_id=i.id join media m on m.id=i.media_id
    where i.instance_id=${instanceId} and ${reviewable(db)} order by d.failed_at desc,d.provider_item_id limit 40`;
}

export async function removeFailedSubtitleDownload(instanceId:string,input:unknown) {
  const {itemId,sourceId,fingerprint}=v.parse(v.strictObject({
    itemId:id,sourceId:short,fingerprint:subtitleFingerprintSchema,
  }),input);
  const db=getSql();
  const candidate=async()=>{
    const [row]=await db<{externalId:string}[]>`
      select i.external_id as "externalId" from subtitle_downloads d join provider_items i on i.id=d.provider_item_id
      where i.instance_id=${instanceId} and d.provider_item_id=${itemId} and d.source_id=${sourceId}
        and d.fingerprint=${fingerprint} and ${reviewable(db)}`;
    return row;
  };
  const row=await candidate();
  if(!row||jellyfinItemKey(row.externalId)!==jellyfinItemKey(sourceId))
    throw new AppError(409,'This subtitle is no longer eligible for removal.');
  const group=`${instanceId}:${jellyfinItemKey(row.externalId)}`;
  if(downloads.has(group))throw new AppError(409,'Wait for the current subtitle download.');
  const {adapter}=await jellyfinManagement(await getInstance(instanceId,'jellyfin'));
  const versions=await adapter.subtitleSources(undefined,row.externalId);
  const tracks=versions.find(version=>jellyfinItemKey(version.id)===jellyfinItemKey(sourceId))?.tracks
    .filter(track=>track.external&&track.path&&track.subtitleFingerprint===fingerprint)??[];
  if(tracks.length!==1||!await candidate()||downloads.has(group))
    throw new AppError(409,'The subtitle changed. Refresh the list before removing it.');
  await adapter.deleteExternalSubtitle(row.externalId,tracks[0].index);
  await db`delete from subtitle_downloads where provider_item_id=${itemId} and source_id=${sourceId} and fingerprint=${fingerprint}`;
}
