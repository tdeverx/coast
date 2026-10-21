import { featureValues, hasWithdrawnFeatures } from '#lib/features.js';
import { queueFeatureTransition } from './feature-transition.server';
import * as v from 'valibot';
import { requireAdmin, type SessionUser } from '#lib/server/auth/index.js';
import { getConfig, configSchema, replaceRequestConfig, type CoastConfig } from '#lib/server/config.js';
import { getSql } from '#lib/server/db/index.js';
import { diagnosticStore } from '#lib/server/diagnostics/index.js';

export async function updateConfig(
  actor: SessionUser | null,
  input: unknown
): Promise<CoastConfig> {
  const admin = requireAdmin(actor);
  const patch = v.parse(v.partial(configSchema), input);
  const next = await getSql().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('coast:configuration', 0))`;
    const previous = await getConfig(sql);
    const next = v.parse(configSchema, { ...previous, ...patch, features: {...previous.features, ...patch.features} });
    await sql`INSERT INTO system_settings (key, value) VALUES ('coast', ${next}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    if (previous.diagnosticLevel !== next.diagnosticLevel)
      await sql`INSERT INTO diagnostic_setting_audit (actor_id, previous_level, next_level)
        VALUES (${admin.id}, ${previous.diagnosticLevel}, ${next.diagnosticLevel})`;
    if(hasWithdrawnFeatures(featureValues(previous),featureValues(next)))await queueFeatureTransition(sql,admin.id,next);
    return next;
  });
  diagnosticStore.level = next.diagnosticLevel;
  replaceRequestConfig(next);
  return next;
}
