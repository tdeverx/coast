import * as v from 'valibot';
import { diagnosticLevels } from '../diagnostics';
import { diagnosticStore } from './diagnostics';
import { getSql } from './db';

export const configSchema = v.object({
  siteAccess: v.optional(v.picklist(['private','public-profiles','public-read-only']),'private'),
  experimentalMusic: v.optional(v.boolean(),false),
  experimentalGaming: v.optional(v.boolean(),false),
  experimentalParties: v.optional(v.boolean(),false),
  experimentalPlanning: v.optional(v.boolean(),false),
  experimentalMediaModal: v.optional(v.boolean(),false),
  allowPlaybackSharing: v.optional(v.boolean(),false),
  registrationMode: v.picklist(['invite','open']),
  registrationProvider: v.picklist(['jellyfin','trakt','either','none']),
  diagnosticLevel: v.picklist(diagnosticLevels),
  sessionLifetimeDays: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365)),
  allowArbitraryServers: v.boolean(),
  serverAllowlist: v.array(v.string()),
  allowedProviderPorts: v.array(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535))),
  playbackDelivery: v.picklist(['direct-and-relay', 'relay-only']),
  allowTranscoding: v.boolean(),
  maxBitrateMbps: v.pipe(v.number(), v.minValue(1), v.maxValue(1000)),
  cacheTmdbArtwork: v.boolean(),
  cacheServerArtwork: v.optional(v.boolean(),false),
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
  siteAccess:'private',
  experimentalMusic: false, experimentalGaming: false, experimentalParties: false,
  experimentalPlanning:false, experimentalMediaModal:false,
  allowPlaybackSharing:false,
  registrationMode: 'invite',
  registrationProvider: 'jellyfin',
  diagnosticLevel: 'info',
  sessionLifetimeDays: 30,
  allowArbitraryServers: false,
  serverAllowlist: [],
  allowedProviderPorts: [80, 443, 8096, 8920, 5055],
  playbackDelivery: 'direct-and-relay',
  allowTranscoding: true,
  maxBitrateMbps: 120,
  cacheTmdbArtwork: false,
  cacheServerArtwork: false,
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

/** Refresh between requests and jobs so persisted changes also reach other processes. */
export async function refreshDiagnosticConfig() {
  try {
    diagnosticStore.level = (await getConfig()).diagnosticLevel;
  } catch {
    /* Keep the last known level during outages. */
  }
}
