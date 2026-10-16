import * as v from 'valibot';
import { administratorFeatures } from '$lib/features';
import { AsyncLocalStorage } from 'node:async_hooks';
import { diagnosticLevels } from '../diagnostics';
import { diagnosticStore } from './diagnostics';
import { getSql } from './db';
import type { Database } from './db';
import { sql } from 'drizzle-orm';

export const configSchema = v.object({
  features: v.optional(v.partial(v.object(Object.fromEntries(administratorFeatures.map(key => [key, v.boolean()])) as Record<typeof administratorFeatures[number], v.BooleanSchema<undefined>>)), {}),
  developerMode: v.optional(v.boolean(),false),
  siteAccess: v.optional(v.picklist(['private','public-profiles','public-read-only']),'private'),
  experimentalMusic: v.optional(v.boolean(),false),
  experimentalGaming: v.optional(v.boolean(),false),
  experimentalBooks: v.optional(v.boolean(),false),
  experimentalComics: v.optional(v.boolean(),false),
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
  features: {},
  developerMode:false,
  siteAccess:'private',
  experimentalMusic: false, experimentalGaming: false, experimentalParties: false,
  experimentalBooks: false, experimentalComics: false,
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

type ConfigDatabase = ReturnType<typeof getSql> | Pick<Database, 'execute'>;
const requestConfig = new AsyncLocalStorage<{ active: boolean; pending?: Promise<CoastConfig>; subjects?: Map<string, Promise<{settings:import('./db/schema').UserSettings;disabled:boolean}|undefined>> }>();

/** Share only one HTTP request's policy snapshot, never authorization between requests. */
export function withRequestConfig<T>(work: () => T | Promise<T>): Promise<T> {
  const current = { active: true, pending: undefined as Promise<CoastConfig> | undefined };
  return requestConfig.run(current, async () => {
    try { return await work(); }
    finally {
      // Timers or detached jobs can inherit async context from request startup.
      // They must not retain its settings snapshot after the response completes.
      current.active = false;
      current.pending = undefined;
      requestConfig.getStore()?.subjects?.clear();
    }
  });
}

/** Background timers started during SSR reload must not inherit request policy. */
export function withoutRequestConfig<T>(work: () => T): T {
  return requestConfig.exit(work);
}

/** A committed settings change replaces this request's snapshot, not another request's. */
export function replaceRequestConfig(config: CoastConfig) {
  const current = requestConfig.getStore();
  if (current?.active) {current.pending = Promise.resolve(config);current.subjects?.clear();}
}

async function readConfig(database: ConfigDatabase): Promise<CoastConfig> {
  // Transactional callers must not acquire another pool connection while holding locks.
  const [row] = 'execute' in database
    ? await database.execute<{ value: Partial<CoastConfig> | null }>(sql`SELECT value FROM system_settings WHERE key = 'coast'`)
    : await database`SELECT value FROM system_settings WHERE key = 'coast'`;
  const config = parseConfig(row?.value);
  return config;
}

export function getConfig(database?: ConfigDatabase): Promise<CoastConfig> {
  // Explicit connections include transactions with their own uncommitted policy writes.
  if (database) return readConfig(database);
  const current = requestConfig.getStore();
  if (current?.active) return current.pending ??= readConfig(getSql());
  return readConfig(getSql());
}

/** Refresh between requests and jobs so persisted changes also reach other processes. */
export async function refreshDiagnosticConfig() {
  try {
    diagnosticStore.level = (await getConfig()).diagnosticLevel;
  } catch {
    /* Keep the last known level during outages. */
  }
}

/** Read-model snapshots are shared only inside this request; transactions bypass them. */
export function featureSubject(userId:string) {
  const read=async()=>{const [user]=await getSql()`select settings,disabled from users where id=${userId}`;return user as {settings:import('./db/schema').UserSettings;disabled:boolean}|undefined;};
  const current=requestConfig.getStore();
  if(!current?.active)return read();
  current.subjects??=new Map();
  const existing=current.subjects.get(userId);if(existing)return existing;
  const pending=read();if(current.subjects.size<40)current.subjects.set(userId,pending);
  return pending;
}
export function invalidateFeatureSubject(userId:string) {requestConfig.getStore()?.subjects?.delete(userId);}

export function parseConfig(value:unknown):CoastConfig {
  return v.parse(configSchema,{...defaultConfig,...(value&&typeof value==='object'?value:{})});
}
