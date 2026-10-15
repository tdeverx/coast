import { afterAll, expect, spyOn, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { isRedirect } from '@sveltejs/kit';
import { closeDb, getDb, getSql } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { getConfig } from '../src/lib/server/config';
import { setupRequired } from '../src/lib/server/auth';
import { actions as setupActions } from '../src/routes/setup/+page.server';
import { beginOnboardingImports, onboardingStatus, pollOnboardingTrakt, startOnboardingTrakt } from '../src/lib/server/auth/onboarding';
import { encryptCredential } from '../src/lib/server/security/credentials';
import * as instances from '../src/lib/providers/instances.server';
import * as reading from '../src/lib/providers/reading.server';
import * as igdb from '../src/lib/providers/igdb/service.server';
import { OpenLibraryAdapter } from '../src/lib/providers/openlibrary/adapter.server';
import { importReading } from '../src/lib/catalogue/reading.server';
import { importJellyfinReading } from '../src/lib/sync/jellyfin-reading.server';
import { JellyfinAdapter } from '../src/lib/providers/jellyfin/adapter.server';
import { readingDetailLoad } from '../src/lib/reading/routes.server';
import { experimentalPathFeature } from '../src/lib/server/experimental';
import { searchPresentations } from '../src/lib/server/queries/search';
import { recommendationRows } from '../src/lib/recommendations/query.server';
import { tasteRevisionSql } from '../src/lib/social/taste-cache.server';
import { mapIgdbGame } from '../src/lib/providers/igdb/adapter.server';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
afterAll(closeDb);
async function configure(patch: Partial<Awaited<ReturnType<typeof getConfig>>>) {
  const previous = await getConfig();
  const value = { ...previous, ...patch };
  await getDb().insert(s.systemSettings).values({ key: 'coast', value })
    .onConflictDoUpdate({ target: s.systemSettings.key, set: { value } });
  return async () => {
    await getDb().update(s.systemSettings).set({ value: previous }).where(eq(s.systemSettings.key, 'coast'));
  };
}
async function user(label: string) {
  const [owner] = await getDb().insert(s.users).values({
    username: `${label}-${crypto.randomUUID()}`, passwordHash: 'fixture',
  }).returning();
  return owner;
}

// This file receives its own fresh migrated database from scripts/test-database.ts.
run('the real fresh setup action creates exactly one administrator and a secure session', async () => {
  expect(await setupRequired()).toBe(true);
  const cookies: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const request = (index: number) => ({
    request: new Request('https://coast.test/setup', {
      method: 'POST', body: new URLSearchParams({
        username: `first-admin-${index}`, displayName: 'First Administrator',
        password: 'Setup-fixture-password!', passwordConfirmation: 'Setup-fixture-password!',
      }),
    }),
    url: new URL('https://coast.test/setup'), locals: { setup: true },
    getClientAddress: () => `fixture-${index}`,
    cookies: { set(name: string, value: string, options: Record<string, unknown>) { cookies.push({ name, value, options }); } },
  } as unknown as Parameters<typeof setupActions.default>[0]);
  const results = await Promise.allSettled([0, 1].map(index => setupActions.default(request(index))));
  const redirects = results.filter(result => result.status === 'rejected' && isRedirect(result.reason));
  const failures = results.filter(result => result.status === 'fulfilled');
  expect(redirects).toHaveLength(1);
  expect((redirects[0] as PromiseRejectedResult).reason).toMatchObject({ status: 303, location: '/for-you' });
  expect(failures).toHaveLength(1);
  expect((failures[0] as PromiseFulfilledResult<unknown>).value).toMatchObject({ status: 409 });
  expect(await setupRequired()).toBe(false);
  const admins = await getDb().select().from(s.users);
  expect(admins).toHaveLength(1);
  expect(admins[0].role).toBe('admin');
  expect(admins[0].settings.profile?.displayName).toBe('First Administrator');
  expect(cookies).toMatchObject([{ name: 'coast_session', options: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' } }]);
  expect(await getDb().select().from(s.sessions)).toHaveLength(1);
});

run('failed onboarding Trakt reconnect cancels stale evidence and completes only with replacement imports', async () => {
  const restore = await configure({ enableTrakt: true });
  const owner = await user('reconnect');
  const other = await user('healthy');
  const db = getDb();
  const credentials = await encryptCredential(JSON.stringify({ clientId: 'fixture', clientSecret: 'fixture' }));
  const [instance] = await db.insert(s.providerInstances).values({
    provider: 'trakt', name: 'Reconnect fixture', baseUrl: 'https://api.trakt.tv', credentials,
  }).returning();
  const [connection, healthy] = await db.insert(s.providerConnections).values([owner, other].map(account => ({
    userId: account.id, instanceId: instance.id, externalUserId: account.id,
    credentials: 'synthetic-old-token', status: 'connected' as const,
  }))).returning();
  const jobs = await db.insert(s.outboxActions).values(['trakt.import', 'trakt.lists-import'].map(kind => ({
    userId: owner.id, connectionId: connection.id, accountGeneration: connection.accountGeneration,
    kind, state: 'failed' as const, payload: { initialImport: true, _jobFailure: { code: 'provider.authentication' } },
  }))).returning();
  await db.insert(s.userOnboarding).values({
    userId: owner.id, requiredProvider: 'trakt', traktConnectionId: connection.id,
    traktAccountGeneration: connection.accountGeneration, importsStartedAt: new Date(),
    importJobs: Object.fromEntries(jobs.map(job => [job.kind, job.id])),
  });
  const workId = crypto.randomUUID();
  await db.insert(s.media).values({ id: workId, kind: 'movie', title: 'Stale Trakt access fixture' });
  const [source] = await db.insert(s.providerItems).values({
    instanceId: instance.id, externalId: 'stale-access', mediaId: workId, kind: 'movie',
  }).returning();
  await db.insert(s.availability).values({
    userId: owner.id, connectionId: connection.id, providerItemId: source.id, mediaId: workId, state: 'available',
  });
  const calls: string[] = [];
  const transport = spyOn(instances, 'instanceTransport').mockReturnValue(async path => {
    calls.push(path);
    if (path === '/oauth/device/code') return { device_code: 'fixture-code', user_code: 'FIXTURE', verification_url: 'https://fixture.invalid/device', expires_in: 600, interval: 0 };
    if (path === '/oauth/device/token') return { access_token: 'new-token', refresh_token: 'new-refresh', created_at: Math.floor(Date.now() / 1000), expires_in: 3600, token_type: 'bearer', scope: 'public' };
    if (path === '/users/settings') return { user: { username: 'reconnected', ids: { uuid: 'verified-replacement-account' } } };
    throw new Error(`Unexpected Trakt fixture path: ${path}`);
  });
  try {
    expect(await onboardingStatus(owner.id)).toMatchObject({ reconnect: true, traktLinked: false, complete: false });
    expect(await startOnboardingTrakt(owner.id, { instanceId: instance.id })).toMatchObject({ userCode: 'FIXTURE' });
    const [pending] = await db.select().from(s.providerConnections).where(eq(s.providerConnections.id, connection.id));
    expect(pending.status).toBe('disconnected');
    expect(await db.select().from(s.availability).where(eq(s.availability.connectionId, connection.id)))
      .toMatchObject([{ state: 'unknown' }]);
    expect((await db.select().from(s.outboxActions).where(inArray(s.outboxActions.id, jobs.map(job => job.id)))).every(job => job.state === 'cancelled')).toBe(true);
    expect(await db.select().from(s.providerConnections).where(eq(s.providerConnections.id, healthy.id))).toEqual([healthy]);
    expect(await pollOnboardingTrakt(owner.id, { instanceId: instance.id })).toEqual({ pending: false });
    const [replaced] = await db.select().from(s.providerConnections).where(eq(s.providerConnections.id, connection.id));
    expect(replaced.externalUserId).toBe('verified-replacement-account');
    expect(replaced.accountGeneration).not.toBe(connection.accountGeneration);
    await db.update(s.outboxActions).set({ state: 'succeeded' }).where(inArray(s.outboxActions.id, jobs.map(job => job.id)));
    expect(await beginOnboardingImports(owner.id)).toMatchObject({ complete: false, reconnect: false, traktLinked: true });
    const [onboarding] = await db.select().from(s.userOnboarding).where(eq(s.userOnboarding.userId, owner.id));
    const selected = Object.values(onboarding.importJobs ?? {}) as string[];
    expect(selected).toHaveLength(2);
    expect(selected.some(id => jobs.some(job => job.id === id))).toBe(false);
    const replacements = await db.select().from(s.outboxActions).where(inArray(s.outboxActions.id, selected));
    expect(replacements.every(job => job.accountGeneration === replaced.accountGeneration && job.state === 'pending' && job.payload.initialImport === true)).toBe(true);
    await db.update(s.outboxActions).set({ state: 'succeeded' }).where(inArray(s.outboxActions.id, selected));
    expect(await onboardingStatus(owner.id)).toMatchObject({ complete: true });
    // A failed import for another owner never authorizes deleting this healthy account.
    await db.update(s.outboxActions).set({ state: 'failed' }).where(eq(s.outboxActions.id, jobs[0].id));
    await db.insert(s.userOnboarding).values({
      userId: other.id, requiredProvider: 'trakt', traktConnectionId: healthy.id,
      traktAccountGeneration: healthy.accountGeneration,
    });
    await expect(startOnboardingTrakt(other.id, { instanceId: instance.id })).rejects.toThrow('Disconnect');
    expect(await db.select().from(s.providerConnections).where(eq(s.providerConnections.id, healthy.id))).toEqual([healthy]);
    expect(calls.filter(path => path === '/oauth/device/token')).toHaveLength(1);
  } finally {
    transport.mockRestore();
    await db.delete(s.users).where(inArray(s.users.id, [owner.id, other.id]));
    await db.delete(s.providerInstances).where(eq(s.providerInstances.id, instance.id));
    await db.delete(s.works).where(eq(s.works.id, workId));
    await restore();
  }
});

run('Comics-only Jellyfin import resolves an Open Library alias locally and still rejects actual books', async () => {
  const restore = await configure({ experimentalBooks: true, experimentalComics: true });
  const owner = await user('reading-alias');
  const db = getDb();
  const comic = await importReading({
    provider: 'comic-vine', externalId: '4000-988800001', kind: 'comic', title: 'Canonical comic',
    authors: ['Fixture Author'], subjects: ['Comics'], sourceUrl: 'https://comicvine.gamespot.com/issue/4000-988800001/',
    identities: [{ provider: 'openlibrary', externalId: 'OL988800001W' }],
  });
  const book = await importReading({
    provider: 'openlibrary', externalId: 'OL988800002W', kind: 'book', title: 'Canonical book',
    authors: [], subjects: [], sourceUrl: 'https://openlibrary.org/works/OL988800002W',
  });
  const [instance] = await db.insert(s.providerInstances).values({
    provider: 'jellyfin', name: 'Reading alias fixture', baseUrl: 'https://fixture.invalid', serverIdentity: crypto.randomUUID(),
  }).returning();
  const [connection] = await db.insert(s.providerConnections).values({
    userId: owner.id, instanceId: instance.id, externalUserId: owner.id, credentials: 'synthetic',
  }).returning();
  const context = {
    instance, connection,
    adapter: new JellyfinAdapter(async () => { throw new Error('Unexpected Jellyfin fixture transport.'); }, owner.id, 'synthetic'),
  };
  const file = (id: string, externalId: string) => ({
    Id: id, Type: 'Book' as const, Name: 'Canonical comic', Path: '/books/fixture.pdf', Etag: 'v1',
    ProviderIds: { OpenLibrary: externalId },
  });
  const comicFile = file('a'.repeat(32), 'OL988800001W');
  const bookFile = file('b'.repeat(32), 'OL988800002W');
  const details = spyOn(reading, 'readingProviderDetails').mockImplementation(async () => { throw new Error('Metadata fixture unavailable.'); });
  const editions = spyOn(reading, 'readingWorkForEdition').mockImplementation(async () => { throw new Error('Edition fixture unavailable.'); });
  try {
    const current = await getConfig();
    await db.update(s.systemSettings).set({ value: { ...current, experimentalBooks: false, experimentalComics: true } }).where(eq(s.systemSettings.key, 'coast'));
    expect(await importJellyfinReading(context, [comicFile, bookFile], { access: true })).toBe(1);
    expect(details).not.toHaveBeenCalled();
    expect(editions).not.toHaveBeenCalled();
    const mapped = await db.select().from(s.workEditions).where(eq(s.workEditions.instanceId, instance.id));
    expect(mapped).toMatchObject([{ workId: comic.id, externalId: comicFile.Id }]);
    expect(await db.select().from(s.availability).where(eq(s.availability.connectionId, connection.id)))
      .toMatchObject([{ mediaId: comic.id, state: 'available', userId: owner.id }]);
    const [stored] = await db.select().from(s.readingWorks).where(eq(s.readingWorks.id, comic.id));
    expect(stored).toMatchObject({ provider: 'comic-vine', kind: 'comic' });
    // A same-title unknown identifier must take the exact metadata path, never guess this saved comic.
    await expect(importJellyfinReading(context, [file('c'.repeat(32), 'OL988800099W')], { access: true }))
      .rejects.toThrow('Metadata fixture unavailable');
    expect(await db.select().from(s.workEditions).where(eq(s.workEditions.instanceId, instance.id))).toHaveLength(1);
  } finally {
    details.mockRestore();
    editions.mockRestore();
    await db.delete(s.users).where(eq(s.users.id, owner.id));
    await db.delete(s.providerInstances).where(eq(s.providerInstances.id, instance.id));
    await db.delete(s.works).where(inArray(s.works.id, [comic.id, book.id]));
    await restore();
  }
});

run('Open Library preview gates by the resolved kind when only Comics is enabled', async () => {
  const restore = await configure({ experimentalBooks: false, experimentalComics: true });
  const owner = await user('reading-preview');
  const details = spyOn(OpenLibraryAdapter.prototype, 'details').mockImplementation(async externalId => ({
    provider: 'openlibrary', externalId, kind: externalId === 'OL988800091W' ? 'comic' : 'book',
    title: 'Resolved metadata fixture', authors: [], subjects: [], sourceUrl: `https://openlibrary.org/works/${externalId}`,
  }));
  const load = readingDetailLoad('book', true);
  const event = (externalId: string) => ({
    locals: { user: { id: owner.id } }, params: { externalId },
    depends() {}, setHeaders() {},
  } as unknown as Parameters<typeof load>[0]);
  try {
    expect(experimentalPathFeature('/media/openlibrary/OL988800091W')).toBeNull();
    expect(await load(event('OL988800091W'))).toMatchObject({ kind: 'comic', remote: true });
    await expect(load(event('OL988800092W'))).rejects.toMatchObject({ status: 404 });
    expect(details).toHaveBeenCalledTimes(2);
  } finally {
    details.mockRestore();
    await getDb().delete(s.users).where(eq(s.users.id, owner.id));
    await restore();
  }
});

run('IGDB Search uses one canonical owned game across two providers even outside the first local page', async () => {
  const restore = await configure({ experimentalGaming: true });
  const owner = await user('canonical-search');
  const db = getDb();
  const title = 'Canonical fixture';
  const fillers = Array.from({ length: 65 }, (_, index) => ({
    id: `00000003-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, title,
  }));
  const saved = { id: 'ffffffff-0003-4000-8000-000000000001', title };
  const gameIds = [...fillers, saved].map(game => game.id);
  await db.insert(s.games).values([...fillers, saved]);
  await db.insert(s.gameExternalIds).values({ gameId: saved.id, provider: 'igdb', externalId: '988800001' });
  const providers = await db.insert(s.providerInstances).values([
    { provider: 'igdb', name: 'IGDB one', baseUrl: 'https://api.igdb.com', credentials: 'synthetic-app' },
    { provider: 'igdb', name: 'IGDB two', baseUrl: 'https://api.igdb.com', credentials: 'synthetic-app' },
    { provider: 'steam', name: 'Steam ownership', baseUrl: 'https://api.steampowered.com' },
  ]).returning();
  const [connection] = await db.insert(s.providerConnections).values({
    userId: owner.id, instanceId: providers[2].id, externalUserId: owner.id, credentials: 'synthetic',
  }).returning();
  const [item] = await db.insert(s.providerItems).values({
    instanceId: providers[2].id, externalId: '988800002', mediaId: saved.id, kind: 'game',
  }).returning();
  await db.insert(s.availability).values({
    userId: owner.id, connectionId: connection.id, providerItemId: item.id, mediaId: saved.id,
    sourceId: 'steam-owned', state: 'available',
  });
  const search = spyOn(igdb, 'searchIgdb').mockResolvedValue({
    items: [mapIgdbGame({ id: 988800001, name: title })], page: 1, hasMore: false,
  });
  try {
    const result = await searchPresentations(owner.id, 'play', title, 'all');
    expect(result.failure).toBe('');
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.items.some(card => card.id === saved.id)).toBe(false);
    const all = [...result.items, ...result.discover];
    expect(all.filter(card => card.id === saved.id)).toMatchObject([
      { id: saved.id, href: `/games/${saved.id}`, available: true },
    ]);
    expect(all.some(card => card.id === 'igdb:988800001' || card.href?.includes('/igdb/'))).toBe(false);
    // Also verify deduplication when the same canonical item is on the local page.
    await db.update(s.games).set({ title: 'Unique canonical result' }).where(eq(s.games.id, saved.id));
    search.mockResolvedValue({ items: [mapIgdbGame({ id: 988800001, name: 'Unique canonical result' })], page: 1, hasMore: false });
    const local = await searchPresentations(owner.id, 'play', 'Unique canonical result', 'all');
    expect([...local.items, ...local.discover].filter(card => card.id === saved.id)).toHaveLength(1);
  } finally {
    search.mockRestore();
    await db.delete(s.users).where(eq(s.users.id, owner.id));
    await db.delete(s.providerInstances).where(inArray(s.providerInstances.id, providers.map(provider => provider.id)));
    await db.delete(s.works).where(inArray(s.works.id, gameIds));
    await restore();
  }
});

run('recommendations admit positive genre, provider and fresh taste evidence before the 2000-candidate bound', async () => {
  const restore = await configure({ experimentalGaming: true });
  const owner = await user('genre-cutoff');
  const db = getDb();
  const pool = getSql();
  const seed = 'ffffffff-0001-4000-8000-000000000001';
  const drama = 'ffffffff-0001-4000-8000-000000000002';
  const providerOnly = 'ffffffff-0001-4000-8000-000000000003';
  const tasteOnly = 'ffffffff-0001-4000-8000-000000000004';
  const staleOnly = '00000001-0000-4000-8000-000000000001';
  let providerId: string | undefined;
  try {
    await pool`insert into media(id,kind,title,genres,release_date)
      select ('00000001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'movie','Unrelated comedy',array['Comedy'],'2020-01-01'::date
      from generate_series(1,2005) n`;
    await db.insert(s.media).values([
      { id: seed, kind: 'movie', title: 'Favourite Drama', genres: ['Drama'], releaseDate: '2020-01-01' },
      { id: drama, kind: 'movie', title: 'Relevant Drama', genres: ['Drama'], releaseDate: '2020-01-01' },
      { id: providerOnly, kind: 'movie', title: 'Provider only', genres: [], releaseDate: '2020-01-01' },
      { id: tasteOnly, kind: 'movie', title: 'Fresh taste only', genres: [], releaseDate: '2020-01-01' },
    ]);
    await db.insert(s.trackingState).values({ userId: owner.id, mediaId: seed, favourite: true });
    const [provider] = await db.insert(s.providerInstances).values({
      provider: 'tmdb', name: 'Cached recommendation fixture', baseUrl: 'https://api.themoviedb.org',
    }).returning();
    providerId = provider.id;
    await db.insert(s.recommendationSets).values({
      instanceId: provider.id, key: 'fixture', seedId: seed, items: [providerOnly],
    });
    const [revision] = await db.execute<{ revision: string }>(sql`select ${tasteRevisionSql} as revision from users u where u.id=${owner.id}::uuid`);
    await db.insert(s.userTasteScores).values([
      { userId: owner.id, workId: tasteOnly, score: 100, confidence: 100, revision: revision.revision, breakdown: { score: 100, confidence: 100, dimensions: {}, reasons: [], matches: 1 } },
      { userId: owner.id, workId: staleOnly, score: 100, confidence: 100, revision: 'stale-fixture-revision', breakdown: { score: 100, confidence: 100, dimensions: {}, reasons: [], matches: 1 } },
    ]);
    const result = await recommendationRows(owner.id, 'recommendations', new URL('http://coast/recommendations?category=screen'));
    const ids = result.items.map(item => item.id);
    expect(ids).toContain(drama);
    expect(ids).toContain(providerOnly);
    expect(ids).toContain(tasteOnly);
    expect(ids).not.toContain(staleOnly);
    expect(result.total).toBe(3);
  } finally {
    await db.delete(s.users).where(eq(s.users.id, owner.id));
    if (providerId) await db.delete(s.providerInstances).where(eq(s.providerInstances.id, providerId));
    await pool`delete from works where id::text like '00000001-0000-4000-8000-%' or id in (${seed}::uuid,${drama}::uuid,${providerOnly}::uuid,${tasteOnly}::uuid)`;
    await restore();
  }
});

run('author-only and series-only recommendations survive more than 2000 unrelated reading works', async () => {
  const restore = await configure({ experimentalBooks: true, experimentalComics: true });
  const owner = await user('author-cutoff');
  const db = getDb();
  const pool = getSql();
  const seed = 'ffffffff-0002-4000-8000-000000000001';
  const author = 'ffffffff-0002-4000-8000-000000000002';
  const series = 'ffffffff-0002-4000-8000-000000000003';
  try {
    await pool`insert into works(id,category,kind)
      select ('00000002-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'book','book'
      from generate_series(1,2005) n`;
    await pool`insert into reading_works(id,provider,external_id,kind,title,source_url,authors,subjects)
      select ('00000002-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'openlibrary','OL'||(988810000+n)::text||'W','book','Unrelated reader',
        'https://openlibrary.org/works/OL'||(988810000+n)::text||'W',array['Different Author'],'{}'::text[]
      from generate_series(1,2005) n`;
    await db.insert(s.works).values([seed, author, series].map(id => ({ id, category: 'book' as const, kind: 'book' as const })));
    await db.insert(s.readingWorks).values([
      { id: seed, externalId: 'OL988820001W', title: 'Favourite book', authors: ['Fixture Writer'], seriesTitle: 'Fixture Series' },
      { id: author, externalId: 'OL988820002W', title: 'Shared author', authors: ['Fixture Writer'], seriesTitle: null },
      { id: series, externalId: 'OL988820003W', title: 'Shared series', authors: ['Another Writer'], seriesTitle: 'Fixture Series' },
    ].map(value => ({ ...value, provider: 'openlibrary' as const, kind: 'book' as const, subjects: [], sourceUrl: `https://openlibrary.org/works/${value.externalId}` })));
    await db.insert(s.trackingState).values({ userId: owner.id, mediaId: seed, favourite: true });
    const result = await recommendationRows(owner.id, 'recommendations', new URL('http://coast/recommendations?category=reading'));
    expect(result.items.map(item => item.id).sort()).toEqual([author, series].sort());
    expect(result.total).toBe(2);
  } finally {
    await db.delete(s.users).where(eq(s.users.id, owner.id));
    await pool`delete from works where id::text like '00000002-0000-4000-8000-%' or id in (${seed}::uuid,${author}::uuid,${series}::uuid)`;
    await restore();
  }
});
