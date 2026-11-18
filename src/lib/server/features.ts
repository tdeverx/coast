import * as v from 'valibot';
import { sql } from 'drizzle-orm';
import { getConfig, parseConfig, featureSubject, type CoastConfig } from './config';
import { getSql, type Database } from './db';
import { AppError } from './security/errors';
import { featureDefinitions, resolveFeatures, type Feature, type FeatureChoices, type FeatureDecision, type FeatureValues } from '#lib/features.js';

export const featureChoicesSchema = v.partial(v.object(Object.fromEntries(featureDefinitions.filter(([key]) => key !== 'api').map(([key]) => [key, v.boolean()])) as Record<keyof FeatureChoices, v.BooleanSchema<undefined>>));
type Denial = NonNullable<FeatureDecision['reason']> | 'membership' | 'library-only' | 'inactive';
export type FeatureConfig = CoastConfig & { features: FeatureValues; featureDenials: Partial<Record<Feature, Denial>>; libraryOnly?:boolean; managedBitrate?:number };
export function featureDenialMessage(reason?:Denial) {
  switch(reason) {
    case 'administrator': return 'A Coast admin has disabled this feature.';
    case 'experiment': return 'This experiment is disabled. A Coast admin can enable it.';
    case 'personal': return 'Turn this feature on in Settings → Features.';
    case 'social': return 'This feature is disabled while Social is off.';
    case 'playback': return 'This feature is disabled while Playback is off.';
    case 'membership': return 'Your Coast membership does not include this feature.';
    case 'library-only': return 'Library-only accounts cannot use this feature.';
    case 'inactive': return 'This feature requires an active Coast account.';
    default: return 'This feature is unavailable for your Coast account.';
  }
}
/** An explicit subject: never project one request actor's choices onto another owner or a shared job. */
export async function getFeatureConfig(userId: string | null, database?: ReturnType<typeof getSql>): Promise<FeatureConfig> {
  // Fresh command checks use one statement/snapshot, not two pool round trips.
  const [snapshot]=database?await database`select (select value from system_settings where key='coast') as config,u.id,u.settings,u.access_defaults,
    nullif((select active_defaults#>>'{jellyfin,RemoteClientBitrateLimit}' from onboarding_provisioning p where p.user_id=u.id),'0')::integer as managed_bitrate,
    u.disabled or not coalesce(u.membership_expires_at>now(),true) as disabled from (select ${userId}::uuid as id) subject left join users u on u.id=subject.id`:[];
  const config = database?parseConfig(snapshot.config):await getConfig();
  const user = database?(snapshot.id?snapshot:undefined):userId?await featureSubject(userId):undefined;
  const decisions = resolveFeatures(config, user?.settings?.features);
  const features = {} as FeatureValues;
  const featureDenials: Partial<Record<Feature, Denial>> = {};
  for (const [key] of featureDefinitions) {
    const {enabled,reason}=decisions[key];
    features[key]=enabled;
    if(reason)featureDenials[key]=reason;
  }
  function deny(key:Feature,reason:Denial) {
    if(features[key])featureDenials[key]=reason;
    features[key]=false;
  }
  if (userId && (!user || user.disabled)) for (const [key] of featureDefinitions) deny(key,'inactive');
  for (const key of ['sharing','requests','social','parties'] as const) if (user?.access_defaults?.[key]===false) deny(key,'membership');
  if (user?.access_defaults?.libraryOnly)
    for (const key of ['sharing','requests','api','personalisation','parties','planning','game'] as const) deny(key,'library-only');
  if (!features.social) {deny('presence','social');deny('parties','social');}
  return {...config, features, featureDenials, libraryOnly:user?.access_defaults?.libraryOnly===true, managedBitrate:user?.managed_bitrate??undefined, experimentalMusic:features.music, experimentalGaming:features.game,
    experimentalBooks:features.book, experimentalComics:features.comic, experimentalParties:features.parties,
    experimentalPlanning:features.planning,
    allowPlaybackSharing:features.sharing, enableRequests:features.requests};
}
/** Acquire policy/subject before account or domain locks, without rejecting cleanup. */
export async function lockFeaturePolicyInTransaction(store: Pick<Database, 'execute'> | ReturnType<typeof getSql>, userId: string) {
  if ('execute' in store) await store.execute(sql`select coast_lock_feature_policy(${userId}::uuid)`);
  else await store`select coast_lock_feature_policy(${userId}::uuid)`;
}
export async function requireFeature(userId: string, feature: Feature, database?: ReturnType<typeof getSql>) {
  // Explicit command transactions fence policy before taking a fresh decision snapshot.
  if(database)await lockFeaturePolicyInTransaction(database,userId);
  const config = await getFeatureConfig(userId, database ?? getSql());
  if (!config.features[feature]) throw new AppError(403, featureDenialMessage(config.featureDenials[feature]), 'feature_disabled');
  return config;
}

export async function requireFeatureInTransaction(store: Pick<Database, 'execute'>, userId: string, feature: Feature) {
  await lockFeaturePolicyInTransaction(store,userId);
  const [row] = await store.execute<{enabled:boolean}>(sql`select coast_feature_enabled(${userId}::uuid,${feature}) as enabled`);
  if (!row?.enabled) throw new AppError(403, featureDenialMessage(), 'feature_disabled');
}

export async function requireWorkFeature(store: Pick<Database, 'execute'>, userId: string, workId: string) {
  await lockFeaturePolicyInTransaction(store,userId);
  const [row] = await store.execute<{allowed:boolean}>(sql`select coast_category_enabled(${userId}::uuid,category) as allowed from works where id=${workId}::uuid`);
  if (!row) throw new AppError(404, 'This work was not found.', 'not_found');
  if (!row.allowed) throw new AppError(403, 'This medium is turned off.', 'feature_disabled');
}
