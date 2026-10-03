import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../server/db';
import { providerInstances } from '../../server/db/schema';
import { AppError } from '../../server/security/errors';
import { decryptCredential } from '../../server/security/credentials';
import { createProviderTransport } from '../../server/security/provider-fetch';
import { instanceFetchConfig } from '../instances.server';
import { IgdbAdapter, igdbCredentialsSchema } from './adapter.server';
import { importIgdbMetadata } from '../../core/games/service';

const uuid = v.pipe(v.string(), v.uuid());
// Keep app tokens in memory, separate from persisted encrypted application credentials.
const adapters = new Map<string, { credentials: string; adapter: IgdbAdapter }>();
async function igdbAdapter(instanceId: string) {
  v.parse(uuid, instanceId);
  const [instance] = await getDb().select().from(providerInstances).where(and(
    eq(providerInstances.id, instanceId), eq(providerInstances.provider, 'igdb'), eq(providerInstances.enabled, true),
  ));
  if (!instance?.credentials) {
    adapters.delete(instanceId);
    throw new AppError(409, 'Configure and enable an IGDB integration first.', 'igdb_not_configured');
  }
  const config = await instanceFetchConfig(instance);
  const cached = adapters.get(instanceId);
  if (cached?.credentials === instance.credentials) return cached.adapter;
  const credentials = v.safeParse(igdbCredentialsSchema, JSON.parse(await decryptCredential(instance.credentials)));
  if (!credentials.success) throw new AppError(409, 'Configure the Twitch application credentials for IGDB.', 'igdb_not_configured');
  const adapter = new IgdbAdapter(credentials.output, createProviderTransport(config));
  if (adapters.size >= 32) adapters.delete(adapters.keys().next().value!);
  adapters.set(instanceId, { credentials: instance.credentials, adapter });
  return adapter;
}
export async function searchIgdb(instanceId: string, query: string, page = 1) {
  return (await igdbAdapter(instanceId)).search(query, page);
}
export async function igdbDetails(instanceId: string, externalId: string) {
  return (await igdbAdapter(instanceId)).details(externalId);
}
export async function importIgdbGame(raw: unknown) {
  const input = v.parse(v.strictObject({ instanceId: uuid, externalId: v.string() }), raw);
  // Fetch before opening the transaction; a failed provider call leaves catalog and history intact.
  return importIgdbMetadata(await igdbDetails(input.instanceId, input.externalId));
}

export async function igdbSteamMatches(instanceId:string,ids:string[]) {
  return (await igdbAdapter(instanceId)).steamMatches(ids);
}

export async function discoverIgdb(instanceId:string,section:'trending'|'recent') {
  return (await igdbAdapter(instanceId)).discover(section);
}
