import * as v from 'valibot';
import { and, asc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getDb } from '$lib/server/db';
import { providerInstances } from '$lib/server/db/schema';
import { getConfig } from '$lib/server/config';
import { requireEnabledCategory } from '$lib/server/experimental';
import { decryptCredential } from '$lib/server/security/credentials';
import { createProviderTransport } from '$lib/server/security/provider-fetch';
import { AppError } from '$lib/server/security/errors';
import { providerCache } from '$lib/server/utils/provider-cache';
import { providerSingleFlight } from '$lib/server/utils/provider-single-flight';
import { instanceFetchConfig } from './instances.server';
import { OpenLibraryAdapter, OPEN_LIBRARY_BASE_URL } from './openlibrary/adapter.server';
import { ComicVineAdapter, comicVineCredentialsSchema } from './comic-vine/adapter.server';
import { readingKinds, readingReferenceSchema, readingProviderForId, READING_PROVIDER_PAGE_LIMIT, type ReadingKind, type ReadingMetadata, type ReadingPage } from '$lib/reading/model';

const discoveries = providerCache<ReadingPage>(60, 60 * 60_000);
const discoveryFlight = providerSingleFlight<ReadingPage>('reading-discovery');
const searches = providerCache<ReadingPage>(100, 15 * 60_000);
const details = providerCache<ReadingMetadata>(200, 24 * 60 * 60_000);
const searchFlight = providerSingleFlight<ReadingPage>('reading-search');
const detailFlight = providerSingleFlight<ReadingMetadata>('reading-detail');
const kindSchema = v.picklist(readingKinds);
const comicVineSourceFilter = and(eq(providerInstances.provider, 'comic-vine'), eq(providerInstances.enabled, true));

/** The same deterministic source selection as metadata reads, without account/schedule hydration. */
export async function readingProviderConfigured(kind: ReadingKind) {
  v.parse(kindSchema, kind);
  requireEnabledCategory(await getConfig(), kind === 'book' ? 'reading' : kind);
  if (kind === 'book') return true;
  const [instance] = await getDb().select({ configured: sql<boolean>`coalesce(${providerInstances.credentials},'')<>''` })
    .from(providerInstances).where(comicVineSourceFilter)
    .orderBy(asc(providerInstances.createdAt), asc(providerInstances.id)).limit(1);
  return instance?.configured ?? false;
}

/** Metadata connections are administrator-owned; credentials never reach pages. */
async function source(kind: ReadingKind, provider = kind === 'book' ? 'openlibrary' : 'comic-vine') {
  requireEnabledCategory(await getConfig(), provider === 'openlibrary' ? 'reading' : kind);
  if (provider === 'openlibrary') {
    const adapter = new OpenLibraryAdapter(createProviderTransport({
      provider: 'openlibrary', baseUrl: OPEN_LIBRARY_BASE_URL, approved: true,
      allowedPorts: [443], maxResponseBytes: 2 * 1024 ** 2,
    }));
    return { key: 'openlibrary', adapter };
  }
  const [instance] = await getDb().select().from(providerInstances)
    .where(comicVineSourceFilter)
    .orderBy(asc(providerInstances.createdAt), asc(providerInstances.id)).limit(1);
  if (!instance?.credentials)
    throw new AppError(409, 'An administrator can add a Comic Vine API key in Integrations to enable comic discovery.', 'comic_vine_not_configured');
  const credentials = v.parse(comicVineCredentialsSchema, JSON.parse(await decryptCredential(instance.credentials)));
  const adapter = new ComicVineAdapter(credentials.apiKey, createProviderTransport({
    ...await instanceFetchConfig(instance), maxResponseBytes: 2 * 1024 ** 2,
  }));
  // Rotation/disable checks happen before cache lookup. A previous key cannot
  // keep serving provider results after the integration changes.
  const version = createHash('sha256').update(instance.credentials).digest('hex');
  return { key: `${instance.id}:${version}`, adapter };
}

export async function searchReading(kind: ReadingKind, query: string, page = 1) {
  v.parse(kindSchema, kind);
  const search = v.parse(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(250)), query);
  v.parse(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(READING_PROVIDER_PAGE_LIMIT)), page);
  const { key, adapter } = await source(kind);
  const identity = JSON.stringify([key, search, page]);
  return searchFlight(identity, () => searches(identity, () => adapter.search(search, page)));
}

/** Bounded metadata-only discovery; no catalogue ingestion or per-card requests. */
export async function discoverReading(kind: ReadingKind, section: 'trending' | 'recent', page = 1) {
  v.parse(kindSchema, kind);
  v.parse(v.picklist(['trending', 'recent']), section);
  v.parse(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(READING_PROVIDER_PAGE_LIMIT)), page);
  const { key, adapter } = await source(kind);
  const identity = JSON.stringify([key, section, page, section === 'recent' ? new Date().toISOString().slice(0, 10) : '']);
  return discoveryFlight(identity, () => discoveries(identity, () => adapter.discover(section, page)));
}

export async function readingProviderDetails(kind: ReadingKind, externalId: string) {
  v.parse(readingReferenceSchema, { kind, externalId });
  const { key, adapter } = await source(kind, readingProviderForId(externalId));
  const identity = JSON.stringify([key, externalId]);
  const item = await detailFlight(identity, () => details(identity, () => adapter.details(externalId)));
  requireEnabledCategory(await getConfig(), item.kind);
  return item;
}

const editionCache=providerCache<string|null>(200,24*60*60_000);
const editionFlight=providerSingleFlight<string|null>('reading-edition');
export async function readingWorkForEdition(identifier:string){
 const {adapter}=await source('book');if(!(adapter instanceof OpenLibraryAdapter))throw new Error('Invalid book source.');
 v.parse(v.pipe(v.string(),v.regex(/^(?:OL[1-9][0-9]{0,19}M|[0-9]{9}[0-9X]|[0-9]{13})$/)),identifier);
 return editionFlight(identifier,()=>editionCache(identifier,()=>adapter.workForEdition(identifier)));
}
