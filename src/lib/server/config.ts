import * as v from 'valibot';
import { diagnosticLevels } from '../diagnostics';
import { diagnosticStore } from './diagnostics';
import { getSql } from './db';
import { requireAdmin, type SessionUser } from './auth';

export const configSchema = v.object({
  experimentalFeatures: v.boolean(),
  jellyfinAutoCreateUsers: v.boolean(),
  jellyfinSyncAdmins: v.boolean(),
  diagnosticLevel: v.picklist(diagnosticLevels),
  sessionLifetimeDays: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365)),
  allowArbitraryServers: v.boolean(),
  serverAllowlist: v.array(v.string()),
  allowedProviderPorts: v.array(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535))),
  playbackDelivery: v.picklist(['direct-and-relay', 'relay-only']),
  allowTranscoding: v.boolean(),
  maxBitrateMbps: v.pipe(v.number(), v.minValue(1), v.maxValue(1000)),
  cacheTmdbArtwork: v.boolean(),
  metadataSource: v.picklist(['local-preferred', 'tmdb-only']),
  notificationLevel: v.picklist(['silent', 'normal', 'persistent']),
  allowNotificationSilencing: v.boolean(),
  subtitleDefault: v.picklist(['off', 'preferred', 'always']),
  subtitleLanguages: v.array(v.string()),
  enableTrakt: v.boolean(),
  enableRequests: v.boolean(),
});
export type CoastConfig = v.InferOutput<typeof configSchema>;
export const defaultConfig: CoastConfig = {
  experimentalFeatures: false,
  jellyfinAutoCreateUsers: false,
  jellyfinSyncAdmins: false,
  diagnosticLevel: 'info',
  sessionLifetimeDays: 30,
  allowArbitraryServers: false,
  serverAllowlist: [],
  allowedProviderPorts: [80, 443, 8096, 8920, 5055],
  playbackDelivery: 'direct-and-relay',
  allowTranscoding: true,
  maxBitrateMbps: 120,
  cacheTmdbArtwork: false,
  metadataSource: 'local-preferred',
  notificationLevel: 'normal',
  allowNotificationSilencing: true,
  subtitleDefault: 'preferred',
  subtitleLanguages: ['en'],
  enableTrakt: true,
  enableRequests: true,
};

export async function getConfig(database = getSql()): Promise<CoastConfig> {
  const [row] = await database`SELECT value FROM system_settings WHERE key = 'coast'`;
  const config = v.parse(configSchema, { ...defaultConfig, ...(row?.value || {}) });
  return config;
}

export async function updateConfig(
  actor: SessionUser | null,
  input: unknown
): Promise<CoastConfig> {
  const admin = requireAdmin(actor);
  const patch = v.parse(v.partial(configSchema), input);
  const next = await getSql().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('coast:configuration', 0))`;
    const previous = await getConfig(sql);
    const next = v.parse(configSchema, { ...previous, ...patch });
    await sql`INSERT INTO system_settings (key, value) VALUES ('coast', ${next}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    if (previous.diagnosticLevel !== next.diagnosticLevel)
      await sql`INSERT INTO diagnostic_setting_audit (actor_id, previous_level, next_level)
        VALUES (${admin.id}, ${previous.diagnosticLevel}, ${next.diagnosticLevel})`;
    return next;
  });
  diagnosticStore.level = next.diagnosticLevel;
  return next;
}

/** Refresh between requests and jobs so persisted changes also reach other processes. */
export async function refreshDiagnosticConfig() {
  try {
    diagnosticStore.level = (await getConfig()).diagnosticLevel;
  } catch {
    /* Keep the last known level during outages. */
  }
}
