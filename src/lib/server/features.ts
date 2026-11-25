import * as v from 'valibot';
import { sql } from 'drizzle-orm';
import { getConfig, parseConfig, featureSubject, type CoastConfig } from './config';
import { getSql, type Database } from './db';
import { AppError } from './security/errors';
import { featureDefinitions, featureGranted, resolveFeatures, type Feature, type FeatureChoices, type FeatureDecision, type FeatureValues } from '#lib/features.js';

export const featureChoicesSchema = v.partial(v.strictObject(Object.fromEntries(featureDefinitions.map(([key]) => [key, v.boolean()])) as Record<keyof FeatureChoices, v.BooleanSchema<undefined>>));
const libraryOnlyFeatures = new Set<Feature>(['sharing','requests','api','personalisation','parties','planning','game','cardTasteScores','richToasts']);

type Denial = NonNullable<FeatureDecision['reason']> | 'membership' | 'library-only' | 'inactive';
export type FeatureConfig = CoastConfig & { features: FeatureValues; featureDenials: Partial<Record<Feature, Denial>>; libraryOnly?:boolean; managedBitrate?:number };
export function featureDenialMessage(reason?:Denial) {
  switch(reason) {
    case 'administrator': return 'A Coast admin has disabled this feature.';
    case 'experiment': return 'This experiment is disabled. A Coast admin can enable it.';
    case 'personal': return 'Turn this feature on in Settings → Features.';
    case 'social': return 'This feature is disabled while Social is off.';
    case 'personalisation': return 'This feature is disabled while Personalisation is off.';
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
  const [snapshot]=database?await database`select (select value from system_settings where key='coast') as config,u.id,u.role,u.settings,u.access_defaults,
    nullif((select active_defaults#>>'{jellyfin,RemoteClientBitrateLimit}' from onboarding_provisioning p where p.user_id=u.id),'0')::integer as managed_bitrate,
    u.disabled or not coalesce(u.membership_expires_at>now(),true) as disabled from (select ${userId}::uuid as id) subject left join users u on u.id=subject.id`:[];
  const config = database?parseConfig(snapshot.config):await getConfig();
  const user = database?(snapshot.id?snapshot:undefined):userId?await featureSubject(userId):undefined;
  const decisions = resolveFeatures(config, user?.settings?.features, userId ? user?.settings.featurePermissions ?? {} : undefined,
    user?.role === 'admin' || user?.settings.allowPlaybackSharing === true || !userId);
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
  for (const [key] of featureDefinitions) if (user?.access_defaults?.[key as keyof typeof user.access_defaults] === false) deny(key,'membership');
  if (user?.access_defaults?.libraryOnly)
    for (const key of libraryOnlyFeatures) deny(key,'library-only');
  if (!features.social) {deny('presence','social');deny('parties','social');}
  if (!features.playback) deny('sharing','playback');
  if (!features.personalisation) deny('cardTasteScores','personalisation');
  return {...config, features, featureDenials, libraryOnly:user?.access_defaults?.libraryOnly===true, managedBitrate:user?.managed_bitrate??undefined, experimentalMusic:features.music, experimentalGaming:features.game,
    experimentalCardTasteScores:!!userId && features.cardTasteScores, experimentalRichToasts:!!userId && features.richToasts,
    experimentalBooks:features.book, experimentalComics:features.comic, experimentalParties:features.parties,
    experimentalPlanning:features.planning,
    allowPlaybackSharing:features.sharing, enableRequests:features.requests};
}
export function userFeatureGrant(config: CoastConfig, user: {role: string; settings: import('./db/schema').UserSettings; access?: import('#lib/auth/invites.js').CoastAccess}, key: Feature) {
  if (user.access?.[key as keyof typeof user.access] === false || user.access?.libraryOnly && libraryOnlyFeatures.has(key)) return false;
  return featureGranted(config, key, user.settings.featurePermissions ?? {}, user.role === 'admin' || user.settings.allowPlaybackSharing === true);
}

/** Shared provider work is useful whenever at least one active account uses the medium. */
export async function sharedProviderFeatures(config: CoastConfig, database = getSql()) {
  const [row] = await database<{screen:boolean;game:boolean;comic:boolean;book:boolean;music:boolean;requests:boolean;personalisation:boolean}[]>`
    select coast_shared_feature_enabled('screen') as screen, coast_shared_feature_enabled('game') as game,
      coast_shared_feature_enabled('comic') as comic, coast_shared_feature_enabled('book') as book,
      coast_shared_feature_enabled('music') as music, coast_shared_feature_enabled('requests') as requests,
      coast_shared_feature_enabled('personalisation') as personalisation`;
  return {...config, features:{...config.features,screen:row.screen,personalisation:row.personalisation,music:row.music,book:row.book,comic:row.comic,game:row.game}, experimentalGaming:row.game, experimentalComics:row.comic,
    experimentalBooks:row.book, experimentalMusic:row.music, enableRequests:row.requests};
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
