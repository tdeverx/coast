import * as v from 'valibot';
import { sql } from 'drizzle-orm';
import { getConfig, parseConfig, featureSubject, type CoastConfig } from './config';
import { getSql, type Database } from './db';
import { AppError } from './security/errors';
import { featureDefinitions, featureValues, type Feature, type FeatureChoices, type FeatureValues } from '$lib/features';

export const featureChoicesSchema = v.partial(v.object(Object.fromEntries(featureDefinitions.filter(([key]) => key !== 'api').map(([key]) => [key, v.boolean()])) as Record<keyof FeatureChoices, v.BooleanSchema<undefined>>));
export type FeatureConfig = CoastConfig & { features: FeatureValues };
/** An explicit subject: never project one request actor's choices onto another owner or a shared job. */
export async function getFeatureConfig(userId: string | null, database?: ReturnType<typeof getSql>): Promise<FeatureConfig> {
  // Fresh command checks use one statement/snapshot, not two pool round trips.
  const [snapshot]=database?await database`select (select value from system_settings where key='coast') as config,u.id,u.settings,u.disabled from (select ${userId}::uuid as id) subject left join users u on u.id=subject.id`:[];
  const config = database?parseConfig(snapshot.config):await getConfig();
  const user = database?(snapshot.id?snapshot:undefined):userId?await featureSubject(userId):undefined;
  const features = featureValues(config, user?.settings?.features);
  if (userId && (!user || user.disabled)) for (const key of Object.keys(features) as Feature[]) features[key] = false;
  return {...config, features, experimentalMusic:features.music, experimentalGaming:features.game,
    experimentalBooks:features.book, experimentalComics:features.comic, experimentalParties:features.parties,
    experimentalPlanning:features.planning,
    allowPlaybackSharing:features.sharing, enableRequests:features.requests};
}
export async function requireFeature(userId: string, feature: Feature, database?: ReturnType<typeof getSql>) {
  // Explicit command transactions fence policy before taking a fresh decision snapshot.
  if(database)await database`select coast_lock_feature_policy(${userId}::uuid)`;
  const config = await getFeatureConfig(userId, database ?? getSql());
  if (!config.features[feature]) throw new AppError(403, 'This feature is disabled.', 'feature_disabled');
  return config;
}

export async function requireFeatureInTransaction(store: Pick<Database, 'execute'>, userId: string, feature: Feature) {
  await store.execute(sql`select coast_lock_feature_policy(${userId}::uuid)`);
  const [row] = await store.execute<{enabled:boolean}>(sql`select coast_feature_enabled(${userId}::uuid,${feature}) as enabled`);
  if (!row?.enabled) throw new AppError(403, 'This feature is disabled.', 'feature_disabled');
}

export async function requireWorkFeature(store: Pick<Database, 'execute'>, userId: string, workId: string) {
  await store.execute(sql`select coast_lock_feature_policy(${userId}::uuid)`);
  const [row] = await store.execute<{allowed:boolean}>(sql`select coast_category_enabled(${userId}::uuid,category) as allowed from works where id=${workId}::uuid`);
  if (!row) throw new AppError(404, 'This work was not found.', 'not_found');
  if (!row.allowed) throw new AppError(403, 'This medium is turned off.', 'feature_disabled');
}
