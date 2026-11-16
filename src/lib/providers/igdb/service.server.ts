import * as v from 'valibot';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../server/db';
import { providerInstances } from '../../server/db/schema';
import { AppError } from '../../server/security/errors';
import { decryptCredential } from '../../server/security/credentials';
import { createProviderTransport } from '../../server/security/provider-fetch';
import { instanceFetchConfig } from '../instances.server';
import { IgdbAdapter, igdbCredentialsSchema, type IgdbGame } from './adapter.server';
import { importIgdbMetadata } from '../../core/games/service.server';
import { providerRowCache } from '#lib/recommendations/provider-read.server.js';

const uuid = v.pipe(v.string(), v.uuid());
// Keep app tokens in memory, separate from persisted encrypted application credentials.
const adapters = new Map<string, { credentials: string; adapter: IgdbAdapter; cacheScope: string }>();
const listings = providerRowCache<IgdbGame[]>();
async function igdbSource(instanceId: string) {
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
  if (cached?.credentials === instance.credentials) return cached;
  const credentials = v.safeParse(igdbCredentialsSchema, JSON.parse(await decryptCredential(instance.credentials)));
  if (!credentials.success) throw new AppError(409, 'Configure the Twitch application credentials for IGDB.', 'igdb_not_configured');
  const adapter = new IgdbAdapter(credentials.output, createProviderTransport(config));
  if (adapters.size >= 32) adapters.delete(adapters.keys().next().value!);
  const source = {credentials:instance.credentials,adapter,cacheScope:`${instanceId}:${createHash('sha256').update(instance.credentials).digest('hex')}`};
  adapters.set(instanceId, source);
  return source;
}
const igdbAdapter = async (instanceId: string) => (await igdbSource(instanceId)).adapter;
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

export async function discoverIgdb(instanceId:string,section:'trending'|'recent',signal:AbortSignal) {
  signal.throwIfAborted();
  const {adapter,cacheScope}=await igdbSource(instanceId);
  const day = section==='recent' ? new Date().toISOString().slice(0,10) : '';
  return listings(JSON.stringify([cacheScope,'discover',section,day]),signal,upstream=>adapter.discover(section,upstream));
}
export async function browseIgdb(instanceId:string,order: 'popular'|'rated'|'upcoming',from:number,through:number,genre:string|undefined,signal:AbortSignal) {
  signal.throwIfAborted();
  const {adapter,cacheScope}=await igdbSource(instanceId);
  return listings(JSON.stringify([cacheScope,'browse',order,from,through,genre]),signal,
    upstream=>adapter.browse(order,from,through,genre,upstream));
}
export async function igdbRecommendations(instanceId:string,id:string){
  return (await igdbAdapter(instanceId)).recommendations(id);
}
