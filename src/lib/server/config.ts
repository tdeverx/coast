import * as v from 'valibot';
import { getSql } from './db';
import { requireAdmin, type SessionUser } from './auth';

export const configSchema = v.object({
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
  return v.parse(configSchema, { ...defaultConfig, ...(row?.value || {}) });
}

export async function updateConfig(
  actor: SessionUser | null,
  input: unknown
): Promise<CoastConfig> {
  requireAdmin(actor);
  const next = v.parse(configSchema, input);
  await getSql()`INSERT INTO system_settings (key, value) VALUES ('coast', ${next}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  return next;
}
