import { createHash } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { providerInstances } from '#lib/server/db/schema.js';
import { createProviderTransport } from '#lib/server/security/provider-fetch.js';
import { decryptCredential } from '#lib/server/security/credentials.js';
import { TmdbAdapter } from './adapter.server';
import type { ProviderTransport } from '#lib/providers/contracts.js';

export type TmdbCredentials = { apiKey?: string; accessToken?: string };

export function authenticatedTmdbTransport(request: ProviderTransport, credentials: TmdbCredentials): ProviderTransport {
  return (path, init = {}) => request(
    credentials.apiKey ? `${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(credentials.apiKey)}` : path,
    {
      ...init,
      headers: { ...init.headers, ...(credentials.accessToken
        ? { Authorization: `Bearer ${credentials.accessToken}` } : {}) },
    },
  );
}

export async function getTmdb(language = 'en-US', region = 'GB', instanceId?:string) {
  const [instance] = await getDb()
    .select()
    .from(providerInstances)
    .where(and(eq(providerInstances.provider, 'tmdb'), eq(providerInstances.enabled, true),isNotNull(providerInstances.credentials),instanceId?eq(providerInstances.id,instanceId):undefined))
    .orderBy(providerInstances.id).limit(1);
  if (!instance?.credentials) return null;
  const credentials = JSON.parse(await decryptCredential(instance.credentials)) as TmdbCredentials;
  const request = createProviderTransport({
    provider: 'tmdb',
    baseUrl: 'https://api.themoviedb.org',
    approved: true,
    allowedPorts: [443],
  });
  return new TmdbAdapter(
    authenticatedTmdbTransport(request, credentials),
    language,
    region,
    `${instance.id}:${createHash('sha256').update(instance.credentials).digest('hex')}`
  );
}
