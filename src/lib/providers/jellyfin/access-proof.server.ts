import {and,eq,sql} from 'drizzle-orm';
import * as v from 'valibot';
import {getDb,type Database} from '$lib/server/db';
import {providerConnections,providerInstances,users} from '$lib/server/db/schema';
import {PermanentActionError} from '$lib/server/queue';
import {ProviderHttpError} from '$lib/server/security/provider-fetch';
import type {JellyfinAdapter} from './adapter.server';
import type {AvailableItem} from '../contracts';
import {jellyfinItemKey} from './paging';
import {assertJobLease} from '$lib/server/queue/execution';
import {providerSchedule} from '../schedule';

type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
export type JellyfinAccessContext={connection:typeof providerConnections.$inferSelect;instance:typeof providerInstances.$inferSelect;adapter:JellyfinAdapter};
export type ScreenAccessProof={serverIdentity:string;serverVersion:string;connectionId:string;accountGeneration:string;externalUserId:string;libraryIds:string[];policyFingerprint:string};
/** Permissions are always fetched anew; this fence bounds the inventory observation. */
export function screenCensusMaxAgeMs(savedSchedule?:unknown) {
  const schedule=providerSchedule('jellyfin',savedSchedule);
  return schedule.fullIntervalHours*3600000+Math.min(schedule.intervalMinutes,60)*60000;
}
const knownPolicyKeys=new Set(`IsAdministrator IsHidden EnableCollectionManagement EnableSubtitleManagement EnableLyricManagement IsDisabled MaxParentalRating MaxParentalSubRating BlockedTags AllowedTags EnableUserPreferenceAccess AccessSchedules BlockUnratedItems EnableRemoteControlOfOtherUsers EnableSharedDeviceControl EnableRemoteAccess EnableLiveTvManagement EnableLiveTvAccess EnableMediaPlayback EnableAudioPlaybackTranscoding EnableVideoPlaybackTranscoding EnablePlaybackRemuxing ForceRemoteSourceTranscoding EnableContentDeletion EnableContentDeletionFromFolders EnableContentDownloading EnableSyncTranscoding EnableMediaConversion EnabledDevices EnableAllDevices EnabledChannels EnableAllChannels EnabledFolders EnableAllFolders InvalidLoginAttemptCount LoginAttemptsBeforeLockout MaxActiveSessions EnablePublicSharing BlockedMediaFolders BlockedChannels RemoteClientBitrateLimit AuthenticationProviderId PasswordResetProviderId SyncPlayAccess`.split(' '));
const strings=v.array(v.string());
const policySchema=v.object({IsDisabled:v.literal(false),EnableMediaPlayback:v.literal(true),EnableRemoteAccess:v.literal(true),EnableAllDevices:v.literal(true),
  EnableAllFolders:v.boolean(),EnabledFolders:strings,BlockedMediaFolders:strings,
  // Known server versions omit null policy fields (JsonDefaults.WhenWritingNull).
  MaxParentalRating:v.optional(v.nullable(v.number()),null),MaxParentalSubRating:v.optional(v.nullable(v.number()),null),BlockedTags:strings,AllowedTags:strings,
  BlockUnratedItems:strings,AccessSchedules:v.array(v.unknown())});
/** Only proven unrestricted item visibility is locally projected. Folder restrictions are supported. */
export function unrestrictedScreenPolicy(policy:Record<string,unknown>):string|null {
  if(Object.keys(policy).some(key=>!knownPolicyKeys.has(key)))return null;
  const result=v.safeParse(policySchema,policy);
  if(!result.success)return null;
  const p=result.output;
  if(p.MaxParentalRating!==null||p.MaxParentalSubRating!==null||p.BlockedTags.length||p.AllowedTags.length||p.BlockUnratedItems.length||p.AccessSchedules.length)return null;
  return JSON.stringify({...p,EnabledFolders:p.EnabledFolders.map(jellyfinItemKey).sort(),BlockedMediaFolders:p.BlockedMediaFolders.map(jellyfinItemKey).sort()});
}
export async function captureScreenAccessProof(context:JellyfinAccessContext):Promise<ScreenAccessProof|null> {
  const {adapter,connection,instance}=context;
  if(!connection.externalUserId||!instance.serverIdentity)return null;
  try {
    const identity=await adapter.identity(instance.serverIdentity);
    // These versions' GroupingOptions and omitted Library SourceType semantics are verified against upstream source.
    if(!/^10\.(10|11)\./.test(identity.version))return null;
    const own=await adapter.accessIdentity(connection.externalUserId);
    if(own.ServerId!==identity.id)throw new PermanentActionError('Jellyfin account returned a different server identity.');
    const policyFingerprint=unrestrictedScreenPolicy(own.Policy);
    if(policyFingerprint===null)return null;
    const libraryIds=await adapter.screenLibraries(connection.externalUserId);
    return {serverIdentity:identity.id,serverVersion:identity.version,connectionId:connection.id,accountGeneration:connection.accountGeneration,
      externalUserId:connection.externalUserId,libraryIds,policyFingerprint};
  } catch(error) {
    // Missing capability falls back to authenticated normal traversal; auth/rate/outage failures retain their meaning.
    if(error instanceof v.ValiError||error instanceof ProviderHttpError&&error.status===404)return null;
    throw error;
  }
}
export function sameScreenAccessProof(a:ScreenAccessProof,b:ScreenAccessProof|null):boolean {
  return b!==null&&JSON.stringify(a)===JSON.stringify(b);
}
async function assertContext(tx:Tx,context:JellyfinAccessContext) {
  const [instance]=await tx.select().from(providerInstances).where(eq(providerInstances.id,context.instance.id)).for('update');
  const [connection]=await tx.select().from(providerConnections).where(eq(providerConnections.id,context.connection.id)).for('update');
  const [user]=await tx.select().from(users).where(eq(users.id,context.connection.userId)).for('update');
  if(!instance?.enabled||instance.provider!=='jellyfin'||instance.serverIdentity!==context.instance.serverIdentity||!user||user.disabled||
    !connection||connection.userId!==user.id||connection.instanceId!==instance.id||connection.accountGeneration!==context.connection.accountGeneration||
    connection.externalUserId!==context.connection.externalUserId||connection.status!=='connected'||!connection.credentials)
    throw new PermanentActionError('The connected account changed during this task.');
  await assertJobLease(tx,true);
  return {instance,connection};
}
function libraryEvidence(item:AvailableItem,scanId:string) {
  // Jellyfin emits SourceType only for Channel; a real CollectionFolder census on known versions establishes Library.
  const ordinary=(item.access?.sourceType==null||item.access.sourceType==='Library')&&item.access?.locationType==='FileSystem';
  return {scanId,sourceType:ordinary?'Library':'Unsupported',locationType:item.access?.locationType??null,
    parentId:item.parentId??null,officialRating:item.access?.officialRating??null,customRating:item.access?.customRating??null,
    tags:item.access?.tags??null,expectedMembers:item.expectedMembers??null};
}
/** Attach actual library membership after canonical metadata was committed. No user observation is stored. */
export async function observeScreenLibraryPage(context:JellyfinAccessContext,proof:ScreenAccessProof,libraryId:string,scanId:string,items:AvailableItem[],offset:number) {
  if(!proof.libraryIds.includes(libraryId)||proof.connectionId!==context.connection.id||proof.accountGeneration!==context.connection.accountGeneration)throw new Error('Invalid Jellyfin library census scope.');
  if(!items.length)return;
  await getDb().transaction(async tx=>{
    const {instance}=await assertContext(tx,context);
    const parsed=v.safeParse(censusSchema,(instance.settings.screenLibraryCensus as Record<string,unknown>|undefined)?.[libraryId]);
    const completedScanId=parsed.success?parsed.output.scanId:null;
    const repeated=offset>0?await tx.execute(sql`select id from provider_items where instance_id=${context.instance.id} and external_id in (${sql.join(items.map(item=>sql`${item.id}`),sql`,`)})
      and snapshot->'screenAccess'->'libraries'->${libraryId}->>'scanId'=${scanId} limit 1`):[];
    if(repeated.length)throw new Error('Jellyfin library repeated items during pagination.');
    const rows=await tx.execute(sql`update provider_items pi set snapshot=pi.snapshot || jsonb_build_object('screenAccess',jsonb_build_object(
      'libraries',coalesce(pi.snapshot->'screenAccess'->'libraries','{}'::jsonb) || jsonb_build_object(${libraryId}::text,e.evidence),
      'completedLibraries',case when e.evidence->>'sourceType'<>'Library' then coalesce(pi.snapshot->'screenAccess'->'completedLibraries','{}'::jsonb)-${libraryId}::text
        else coalesce(pi.snapshot->'screenAccess'->'completedLibraries','{}'::jsonb) || case when pi.snapshot->'screenAccess'->'libraries'->${libraryId}->>'scanId'=${completedScanId}
          then jsonb_build_object(${libraryId}::text,pi.snapshot->'screenAccess'->'libraries'->${libraryId}) else '{}'::jsonb end end))
      from (values ${sql.join(items.map(item=>sql`(${item.id}::text,${libraryEvidence(item,scanId)}::jsonb)`),sql`,`)}) as e(external_id,evidence)
      where pi.instance_id=${context.instance.id} and pi.external_id=e.external_id returning pi.id`);
    if(rows.length!==items.length)throw new Error('Jellyfin library census has incomplete canonical mappings.');
  });
}
const censusSchema=v.object({sourceConnectionId:v.pipe(v.string(),v.uuid()),accountGeneration:v.pipe(v.string(),v.uuid()),externalUserId:v.string(),
  serverIdentity:v.string(),serverVersion:v.string(),scanId:v.pipe(v.string(),v.uuid()),total:v.pipe(v.number(),v.integer(),v.minValue(0)),completedAt:v.pipe(v.string(),v.isoTimestamp()),expiresAt:v.pipe(v.string(),v.isoTimestamp())});
type Census=v.InferOutput<typeof censusSchema>;
/** Publish only a stable completed library traversal; partial pages never replace its completion marker. */
export async function publishScreenLibraryCensus(context:JellyfinAccessContext,initial:ScreenAccessProof,libraryId:string,scanId:string,total:number):Promise<boolean> {
  if(!initial.libraryIds.includes(libraryId)||!sameScreenAccessProof(initial,await captureScreenAccessProof(context)))throw new Error('Jellyfin library permissions changed before census completion.');
  return getDb().transaction(async tx=>{
    const {instance}=await assertContext(tx,context);
    const [size]=await tx.execute<{total:number}>(sql`select count(*)::integer as total from provider_items where instance_id=${context.instance.id}
      and kind in ('movie','show','season','episode') and snapshot->'screenAccess'->'libraries'->${libraryId}->>'scanId'=${scanId}
      and snapshot->'screenAccess'->'libraries'->${libraryId}->>'sourceType'='Library'`);
    if(size.total!==total)return false;
    const completedAt=new Date();
    const marker:Census={sourceConnectionId:context.connection.id,accountGeneration:context.connection.accountGeneration,externalUserId:context.connection.externalUserId!,
      serverIdentity:initial.serverIdentity,serverVersion:initial.serverVersion,scanId,total,completedAt:completedAt.toISOString(),
      expiresAt:new Date(completedAt.getTime()+screenCensusMaxAgeMs(instance.settings.schedule)).toISOString()};
    await tx.update(providerInstances).set({settings:sql`${providerInstances.settings} || jsonb_build_object('screenLibraryCensus',
      coalesce(${providerInstances.settings}->'screenLibraryCensus','{}'::jsonb) || jsonb_build_object(${libraryId}::text,${marker}::jsonb))`}).where(eq(providerInstances.id,context.instance.id));
    return true;
  });
}
/** Positive access projection from completed per-library inventory, independent of personal import/tracking coverage. */
export async function tryReuseScreenAccess(context:JellyfinAccessContext):Promise<number|null> {
  const proof=await captureScreenAccessProof(context);
  if(!proof)return null;
  return getDb().transaction(async tx=>{
    const {instance}=await assertContext(tx,context);
    const raw=instance.settings.screenLibraryCensus as Record<string,unknown>|undefined;
    const maxAge=screenCensusMaxAgeMs(instance.settings.schedule);
    const eligible:{libraryId:string;census:Census}[]=[];
    for(const libraryId of proof.libraryIds) {
      const parsed=v.safeParse(censusSchema,raw?.[libraryId]);
      if(!parsed.success)continue;
      const census=parsed.output,age=Date.now()-Date.parse(census.completedAt);
      if(age<0||age>maxAge||Date.parse(census.expiresAt)<=Date.now()||census.serverIdentity!==proof.serverIdentity||census.serverVersion!==proof.serverVersion)continue;
      const [source]=await tx.select({connection:providerConnections,user:users}).from(providerConnections).innerJoin(users,eq(users.id,providerConnections.userId))
        .where(and(eq(providerConnections.id,census.sourceConnectionId),eq(providerConnections.instanceId,instance.id))).for('update');
      if(!source||source.user.disabled||source.connection.status!=='connected'||!source.connection.credentials||source.connection.accountGeneration!==census.accountGeneration||source.connection.externalUserId!==census.externalUserId)continue;
      const [size]=await tx.execute<{total:number}>(sql`select count(*)::integer as total from provider_items where instance_id=${instance.id}
        and kind in ('movie','show','season','episode') and (
          (snapshot->'screenAccess'->'libraries'->${libraryId}->>'scanId'=${census.scanId} and snapshot->'screenAccess'->'libraries'->${libraryId}->>'sourceType'='Library') or
          (snapshot->'screenAccess'->'completedLibraries'->${libraryId}->>'scanId'=${census.scanId} and snapshot->'screenAccess'->'completedLibraries'->${libraryId}->>'sourceType'='Library'))`);
      if(size.total===census.total)eligible.push({libraryId,census});
    }
    if(!eligible.length)return null;
    const inheritedId=crypto.randomUUID(),verifiedAt=new Date(),libraries=Object.fromEntries(eligible.map(({libraryId,census})=>[libraryId,census.scanId]));
    const granted=await tx.execute<{id:string}>(sql`insert into availability (user_id,connection_id,provider_item_id,media_id,source_id,state,source,verified_at,scan_id)
      select ${context.connection.userId}::uuid,${context.connection.id}::uuid,pi.id,pi.media_id,'default','available',
        jsonb_build_object('coastAccessKind','library-cache','coastSourceType','Library','coastAccessGeneration',${context.connection.accountGeneration}::text,
          'coastMembershipCount',e.evidence->'expectedMembers','coastLibraryId',e.library_id,'coastLibraryScanId',e.evidence->>'scanId'),${verifiedAt},${inheritedId}::uuid
      from provider_items pi cross join lateral (
        select entry.key as library_id,entry.value as evidence from (
          select key,value from jsonb_each(coalesce(pi.snapshot->'screenAccess'->'libraries','{}'::jsonb))
          union all select key,value from jsonb_each(coalesce(pi.snapshot->'screenAccess'->'completedLibraries','{}'::jsonb))
        ) entry
        where (${sql.join(eligible.map(({libraryId,census})=>sql`(entry.key=${libraryId} and entry.value->>'scanId'=${census.scanId})`),sql` or `)})
          and entry.value->>'sourceType'='Library' order by entry.key limit 1
      ) e where pi.instance_id=${instance.id} and pi.kind in ('movie','show','season','episode')
      on conflict(user_id,connection_id,provider_item_id,source_id) do update set state='available',verified_at=excluded.verified_at,scan_id=excluded.scan_id,
        source=excluded.source where availability.source->>'coastAccessKind'='library-cache' returning id`);
    await tx.update(providerConnections).set({settings:sql`${providerConnections.settings} || jsonb_build_object('screenAccessInherited',
      ${{accountGeneration:context.connection.accountGeneration,verifiedAt:verifiedAt.toISOString(),scanId:inheritedId,libraries,count:granted.length}}::jsonb)`})
      .where(eq(providerConnections.id,context.connection.id));
    return granted.length;
  });
}
