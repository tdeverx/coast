import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
import { closeDb, getDb } from '../src/lib/server/db';
import { getConfig } from '../src/lib/server/config';
import { contentRevision } from '../src/lib/server/content-revision.server';
import { listItems, lists, media, providerInstances, ratings, readingProgress, readingWorks, systemSettings, trackingState, upNext, users, workEditions, workIdentifiers, works } from '../src/lib/server/db/schema';
import { importReading } from '../src/lib/catalogue/reading.server';
import { ensureReadingSaved, updateReading } from '../src/lib/core/reading/service.server';
import { readingCatalogue, readingDetails, readingStoredWorkId, readingProviderCards } from '../src/lib/reading/query.server';
import { track } from '../src/lib/core/tracking/service.server';
import { rate } from '../src/lib/core/ratings/service.server';
import type { ReadingMetadata } from '../src/lib/reading/model';
import { progressData } from '../src/lib/server/queries/progress';
import { libraryContent } from '../src/lib/server/queries/library-content';
import { collectionData, workAssessments } from '../src/lib/collection/query.server';
import { readingProviderConfigured } from '../src/lib/providers/reading.server';
import { addReading } from '../src/lib/application/reading.server';
import { load as loadMediaPage } from '../src/routes/media/[id]/+page.server';
import { readingSearch, readingSearchInitial } from '../src/lib/server/queries/search';
import { readingDetailLoad } from '../src/lib/reading/routes.server';
import { discoveryContent } from '../src/lib/server/queries/discovery';
import * as readingProviders from '../src/lib/providers/reading.server';
import { load as loadSearchPage } from '../src/routes/search/+page.server';
import { load as loadDiscoverPage } from '../src/routes/discover/+page.server';
import { load as loadLibraryPage } from '../src/routes/library/+page.server';
import { load as loadProgressPage } from '../src/routes/progress/+page.server';
import { isHttpError } from '@sveltejs/kit';

const target = process.env.TEST_DATABASE_URL;
const suite = target ? describe : describe.skip;
suite('experimental reading identity, private state and bounded local reads', () => {
  const previous = process.env.DATABASE_URL;
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  const fixtureIds = new Set<string>();
  let bookId: string, comicId: string;
  let config: Awaited<ReturnType<typeof getConfig>>;
  const book: ReadingMetadata = { provider: 'openlibrary', externalId: 'OL900000001W', kind: 'book', title: 'Reading identity fixture', sourceUrl: 'https://openlibrary.org/works/OL900000001W', authors: ['Author'], subjects: ['Fiction'], editionIds: ['OL900000001M'] };
  const comic: ReadingMetadata = { provider: 'comic-vine', externalId: '4000-900000001', kind: 'comic', title: 'A comic issue', sourceUrl: 'https://comicvine.gamespot.com/an-issue/4000-900000001/', authors: [], subjects: [], seriesTitle: 'A series', issueNumber: '1' };
  const saveConfig = async (value: typeof config) => getDb().insert(systemSettings).values({ key: 'coast', value }).onConflictDoUpdate({ target: systemSettings.key, set: { value } });
  const mediaEvent = (id: string, userId: string | null = owner, dependencies = new Set<string>()) => ({
    locals: { user: userId ? { id: userId } : null }, params: { id }, url: new URL(`http://localhost/media/${id}`),
    depends: (...keys: string[]) => keys.forEach(key => dependencies.add(key)), setHeaders: () => {},
  }) as unknown as Parameters<typeof loadMediaPage>[0];

  beforeAll(async () => {
    await closeDb(); process.env.DATABASE_URL = target!;
    await migrate(getDb(), { migrationsFolder: `${import.meta.dir}/../drizzle` });
    await getDb().insert(users).values([owner, other].map(id => ({ id, username: `reading-${id}`, passwordHash: 'fixture' })));
    config = await getConfig();
    await saveConfig({ ...config, experimentalBooks: true, experimentalComics: true });
  });
  afterAll(async () => {
    await saveConfig(config);
    await getDb().delete(users).where(inArray(users.id, [owner, other]));
    if (fixtureIds.size) await getDb().delete(works).where(inArray(works.id, [...fixtureIds]));
    await closeDb();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  });

  test('concurrent imports share a work; repeated and refreshed metadata preserve identity', async () => {
    const imported = await Promise.all([importReading(book), importReading(book)]);
    bookId = imported[0].id; fixtureIds.add(bookId);
    expect(imported[1].id).toBe(bookId);
    expect(await getDb().select().from(workIdentifiers).where(eq(workIdentifiers.workId, bookId))).toHaveLength(1);
    expect(await getDb().select().from(workEditions).where(eq(workEditions.workId, bookId))).toEqual([]);
    const revision = await contentRevision(owner);
    await importReading(book);
    expect(await contentRevision(owner)).toEqual(revision);
    const refreshed = await importReading({ ...book, title: 'Refreshed reading title' });
    expect(refreshed.id).toBe(bookId);
    expect((await contentRevision(owner)).tracking).not.toBe(revision.tracking);
    const distinct = await importReading({ ...book, externalId: 'OL900000002W', sourceUrl: 'https://openlibrary.org/works/OL900000002W' });
    fixtureIds.add(distinct.id);
    expect(distinct.id).not.toBe(bookId);
    comicId = (await importReading(comic)).id; fixtureIds.add(comicId);
  });

  test('page progress is private and explicit completion is idempotent', async () => {
    await track(owner, { mediaId: bookId, action: 'favourite', value: true });
    await rate(owner, { mediaId: bookId, value: 4.5 });
    const ownerBefore = await contentRevision(owner), otherBefore = await contentRevision(other);
    const reading = await updateReading(owner, bookId, { page: 15, totalPages: 100 });
    expect(reading.state).toBe('reading'); expect(reading.startedAt).not.toBeNull();
    expect(reading.completedAt).toBeNull();
    expect((await contentRevision(owner)).tracking).not.toBe(ownerBefore.tracking);
    expect(await contentRevision(other)).toEqual(otherBefore);
    const own = await readingDetails(owner, bookId), theirs = await readingDetails(other, bookId);
    expect(own.progress?.page).toBe(15); expect(own.rating).toBe(4.5); expect(own.relationships.favourite).toBe(true);
    expect(theirs.progress).toBeNull(); expect(theirs.rating).toBeNull(); expect(theirs.relationships.favourite).toBe(false);
    expect((await progressData(owner, { view: 'favourites', category: 'screen' })).emptyAllMedia).toBe(false);
    await expect(updateReading(owner, bookId, { page: 101 })).rejects.toThrow('total pages');
    await expect(updateReading(owner, bookId, { totalPages: 10 })).rejects.toThrow('total pages');
    expect((await readingDetails(owner, bookId)).progress?.page).toBe(15);
    await updateReading(owner, bookId, { page: 100 });
    expect((await readingDetails(owner, bookId)).progress?.state).toBe('reading');
    const completed = await updateReading(owner, bookId, { state: 'completed' });
    const completedRevision = await contentRevision(owner);
    expect(await updateReading(owner, bookId, { state: 'completed' })).toEqual(completed);
    expect(await ensureReadingSaved(owner, bookId)).toEqual(completed);
    expect(await contentRevision(owner)).toEqual(completedRevision);
    await importReading({ ...book, title: 'Metadata after completion', pageCount: 120 });
    const retained = await readingDetails(owner, bookId);
    expect(retained.progress).toEqual(completed); expect(retained.rating).toBe(4.5); expect(retained.relationships.favourite).toBe(true);
    await updateReading(owner, bookId, { state: 'reading', page: 0, totalPages: null });
    expect((await readingDetails(owner, bookId)).progress?.completedAt).toBeNull();
    await updateReading(other, bookId, { page: 2 });
    expect((await readingDetails(owner, bookId)).progress?.page).toBe(0);
    expect((await readingDetails(other, bookId)).progress?.page).toBe(2);
  });

  test('personal and state predicates precede counts and 60-item pages', async () => {
    const db = getDb(), prefix = `Paged reading ${owner}`;
    const ids = Array.from({ length: 66 }, () => crypto.randomUUID());
    ids.forEach(id => fixtureIds.add(id));
    await db.transaction(async tx => {
      await tx.insert(works).values(ids.map(id => ({ id, category: 'book', kind: 'book' as const })));
      await tx.insert(readingWorks).values(ids.map((id, i) => ({ id, provider: 'openlibrary' as const, externalId: `OL${910000000 + i}W`, kind: 'book' as const, title: `${prefix} ${String(i).padStart(3, '0')}`, sourceUrl: `https://openlibrary.org/works/OL${910000000 + i}W` })));
      await tx.insert(trackingState).values(ids.slice(0, 61).map(mediaId => ({ userId: owner, mediaId, favourite: true })));
      await tx.insert(ratings).values({ userId: owner, mediaId: ids[61], value: 4 });
      const [list] = await tx.insert(lists).values({ userId: owner, name: 'Reading fixture list' }).returning();
      await tx.insert(listItems).values({ listId: list.id, mediaId: ids[62], position: 0 });
      await tx.insert(upNext).values({ userId: owner, mediaId: ids[63] });
    });
    const first = await readingCatalogue(owner, { search: prefix });
    expect(first.total).toBe(64); expect(first.pages).toBe(2); expect(first.items).toHaveLength(60);
    const second = await readingCatalogue(owner, { search: prefix, page: 2 });
    expect(second.items.map(item => item.id)).toEqual(ids.slice(60, 64));
    const last = await readingCatalogue(owner, { search: prefix, page: 1001 });
    expect(last.page).toBe(2); expect(last.items.map(item => item.id)).toEqual(ids.slice(60, 64));
    expect((await readingCatalogue(other, { search: prefix })).total).toBe(0);
    expect((await readingCatalogue(other, { search: prefix, personal: false })).total).toBe(66);
    await updateReading(owner, ids[64], { state: 'dropped' });
    const dropped = await readingCatalogue(owner, { search: prefix, state: 'dropped', page: 2 });
    expect(dropped.items.map(item => item.id)).toEqual([ids[64]]); expect(dropped.total).toBe(1); expect(dropped.page).toBe(1);
    expect((await readingCatalogue(other, { search: prefix, state: 'dropped', personal: false })).total).toBe(0);
    const literal = await importReading({ ...book, externalId: 'OL900000003W', title: `${prefix} 100%_literal`, sourceUrl: 'https://openlibrary.org/works/OL900000003W' }); fixtureIds.add(literal.id);
    expect((await readingCatalogue(owner, { search: '%_literal', personal: false })).items.map(item => item.id)).toEqual([literal.id]);
  });

  test('canonical title pages dispatch private reading details and preserve public screen details', async () => {
    const dependencies = new Set<string>();
    const own = await loadMediaPage(mediaEvent(bookId, owner, dependencies));
    expect(own).toMatchObject({ reading: { kind: 'book', remote: false, item: { id: bookId }, progress: { page: 0 } } });
    expect(dependencies).toContain('coast:tracking');expect(dependencies).toContain('coast:reading');
    const theirs = await loadMediaPage(mediaEvent(bookId, other));
    expect(theirs).toMatchObject({ reading: { progress: { page: 2 }, rating: null, relationships: { favourite: false } } });
    await expect(loadMediaPage(mediaEvent(bookId, null))).rejects.toMatchObject({ status: 401 });
    await expect(loadMediaPage(mediaEvent('invalid-work-id'))).rejects.toMatchObject({ status: 400 });
    const [screen] = await getDb().insert(media).values({ kind: 'movie', title: 'Canonical public screen fixture' }).returning();fixtureIds.add(screen.id);
    const publicScreen = await loadMediaPage(mediaEvent(screen.id, null));
    expect(publicScreen).toMatchObject({ item: { id: screen.id, kind: 'movie', title: screen.title }, requestable: false });
    expect('reading' in publicScreen).toBe(false);
    const signedInScreen = await loadMediaPage(mediaEvent(screen.id));
    expect(signedInScreen).toMatchObject({ item: { id: screen.id, kind: 'movie' } });
    if ('enhancement' in signedInScreen && signedInScreen.enhancement) await signedInScreen.enhancement;
  });

  test('comic discovery readiness matches deterministic source selection without linked accounts', async () => {
    expect(await readingProviderConfigured('book')).toBe(true);
    expect(await readingProviderConfigured('comic')).toBe(false);
    const db = getDb();
    const [first, second] = await db.insert(providerInstances).values([
      { provider: 'comic-vine', name: 'Unconfigured first source', baseUrl: 'https://comicvine.gamespot.com', createdAt: new Date('2000-01-01') },
      { provider: 'comic-vine', name: 'Configured second source', baseUrl: 'https://comicvine.gamespot.com', credentials: 'fixture', createdAt: new Date('2000-01-02') },
    ]).returning({ id: providerInstances.id });
    try {
      expect(await readingProviderConfigured('comic')).toBe(false);
      await db.update(providerInstances).set({ enabled: false }).where(eq(providerInstances.id, first.id));
      expect(await readingProviderConfigured('comic')).toBe(true);
      await db.update(providerInstances).set({ enabled: false }).where(eq(providerInstances.id, second.id));
      expect(await readingProviderConfigured('comic')).toBe(false);
      // Malformed references are rejected before decrypting a key or requesting metadata.
      await expect(addReading(owner, { kind: 'book', externalId: 'OL1M' })).rejects.toThrow();
      await expect(addReading(owner, { kind: 'comic', externalId: '4050-1' })).rejects.toThrow();
    } finally { await db.delete(providerInstances).where(inArray(providerInstances.id, [first.id, second.id])); }
  });

  test('shared Library, Continue, Next and saved rows retain reading gates and private page progress', async () => {
    const db=getDb();
    const savedBook=await importReading({...book,externalId:'OL990000001W',title:'Shared Reading fixture',sourceUrl:'https://openlibrary.org/works/OL990000001W'});
    const savedComic=await importReading({...comic,externalId:'4000-990000001',title:'Shared comic fixture',sourceUrl:'https://comicvine.gamespot.com/shared/4000-990000001/'});
    fixtureIds.add(savedBook.id);fixtureIds.add(savedComic.id);
    try {
      await ensureReadingSaved(owner,savedComic.id);
      await updateReading(owner,savedBook.id,{page:95,totalPages:100});
      const continuing=await progressData(owner,{category:'reading',view:'watching',kind:'book'});
      const card=continuing.items.find(item=>item.id===savedBook.id);
      expect(card?.trackingProgress).toEqual({unit:'pages',value:95,total:100});
      expect(card && 'href' in card ? card.href : null).toBe(`/media/${savedBook.id}`);
      const next=await progressData(owner,{category:'reading',view:'next',kind:'comic'});
      expect(next.items.map(item=>item.id)).toContain(savedComic.id);
      expect(next.items.map(item=>item.id)).not.toContain(savedBook.id);
      await track(owner,{mediaId:savedBook.id,action:'favourite',value:true});
      const favourites=await progressData(owner,{category:'reading',view:'favourites',kind:'book'});
      expect(favourites.total).toBeGreaterThan(60);expect(favourites.items).toHaveLength(60);
      const library=await libraryContent(owner,new URL('http://coast/library?surface=read&kind=book&selection=reading&scope=available'));
      expect(library.items).toEqual([]);
      expect((await libraryContent(owner,new URL('http://coast/library?surface=read&kind=book&selection=reading&scope=all'))).items.map(item=>item.id)).toContain(savedBook.id);
      expect(library.items.every(item=>item.kind==='book')).toBe(true);
      expect((await libraryContent(owner,new URL('http://coast/library?surface=read&kind=comic&selection=planned'))).items.map(item=>item.id)).toContain(savedComic.id);
      const collection=await collectionData(owner,{category:'reading',kind:'comic'});
      expect(collection.items.map(item=>item.id)).toContain(savedComic.id);
      await db.update(users).set({settings:{social:{audience:'public',sections:{activity:'public',collection:'public',progress:'private',favourites:'public'}}}}).where(eq(users.id,owner));
      expect((await progressData(owner,{category:'reading',view:'watching'},other)).total).toBe(0);
      await track(owner,{mediaId:savedBook.id,action:'collect',value:true});
      await updateReading(owner,savedBook.id,{state:'completed'});
      const visible=await collectionData(other,{category:'reading',kind:'book',relationship:'collected'},`reading-${owner}`);
      const visibleCard=visible.items.find(item=>item.id===savedBook.id);
      expect(visibleCard).toBeDefined();expect(visibleCard?.trackingProgress).toBeUndefined();
      expect((await workAssessments(owner,other,[savedBook.id]))[0].completed).toBe(false);
      expect((await collectionData(other,{category:'reading',kind:'comic'},`reading-${owner}`)).items.map(item=>item.id)).not.toContain(savedComic.id);
      await saveConfig({...config,experimentalBooks:true,experimentalComics:false});
      expect((await libraryContent(owner,new URL('http://coast/library?surface=read'))).items.every(item=>item.kind==='book')).toBe(true);
      expect((await collectionData(owner,{category:'reading'})).items.every(item=>item.kind==='book')).toBe(true);
      await expect(progressData(owner,{category:'reading',kind:'comic'})).rejects.toThrow('disabled');
      await expect(progressData(owner,{category:'reading',kind:'movie'})).rejects.toThrow('Books or Comics');
    } finally {
      await db.update(users).set({settings:{}}).where(eq(users.id,owner));
      await saveConfig({...config,experimentalBooks:true,experimentalComics:true});
      await db.delete(works).where(inArray(works.id,[savedBook.id,savedComic.id]));
      fixtureIds.delete(savedBook.id);fixtureIds.delete(savedComic.id);
    }
  });

  test('disabled experiments reject direct operations and filter catalogue counts', async () => {
    const saved = await Promise.all([ensureReadingSaved(owner, comicId), ensureReadingSaved(owner, comicId)]);
    expect(saved[0].state).toBe('planned'); expect(saved[1]).toEqual(saved[0]);
    await saveConfig({ ...config, experimentalBooks: true, experimentalComics: false });
    try {
      await expect(importReading(comic)).rejects.toThrow('disabled');
      await expect(readingDetails(owner, comicId)).rejects.toThrow('disabled');
      await expect(updateReading(owner, comicId, { page: 1 })).rejects.toThrow('disabled');
      await expect(readingCatalogue(owner, { kind: 'comic' })).rejects.toThrow('disabled');
      await expect(loadMediaPage(mediaEvent(comicId))).rejects.toMatchObject({ status: 404, body: { message: 'This medium is disabled.' } });
      await expect(loadMediaPage(mediaEvent(comicId, null))).rejects.toMatchObject({ status: 404, body: { message: 'This medium is disabled.' } });
      const all = await readingCatalogue(owner, { personal: false });
      expect(all.total).toBe(69); expect(all.items.every(item => item.kind === 'book')).toBe(true);
      expect(await getDb().select().from(readingProgress).where(eq(readingProgress.workId, comicId))).toHaveLength(1);
    } finally { await saveConfig({ ...config, experimentalBooks: true, experimentalComics: true }); }
  });

  test('unified Search merges providers, deduplicates saved works and hydrates only the current user', async () => {
    const readiness = spyOn(readingProviders, 'readingProviderConfigured').mockResolvedValue(true);
    const remote = { ...book, title: 'Metadata after completion' };
    const metadata = spyOn(readingProviders, 'searchReading').mockImplementation(async (kind, _query, page = 1) => ({ items: kind === 'book' && page === 1 ? [remote, { ...book, externalId: 'OL888888881W', title: 'Remote book', sourceUrl: 'https://openlibrary.org/works/OL888888881W' }] : [], total: kind === 'book' ? 21 : 0, page, nextPage: kind === 'book' && page === 1 ? 2 : null }));
    await updateReading(owner, bookId, { page: 25, totalPages: 100 });
    const before = await getDb().select({ id: works.id }).from(works);
    try {
      const result = await readingSearch(owner, { query: 'Metadata after completion', kind: 'book' });
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({ id: bookId, workId: bookId, href: `/media/${bookId}`, trackingProgress: { unit: 'pages', value: 25, total: 100 } });
      expect(result.items[1]).toMatchObject({ id: 'openlibrary:OL888888881W', href: '/media/openlibrary/OL888888881W' });
      expect(result.items[1].workId).toBeUndefined();
      const otherCards = await readingSearch(other, { query: 'Metadata after completion', kind: 'book' });
      expect(otherCards.items[0].trackingProgress).toEqual({ unit: 'pages', value: 2 });
      const second = await readingSearch(owner, { query: `Paged reading ${owner}`, kind: 'book', page: 2 });
      expect(second.items).toHaveLength(7); expect(second.page).toBe(2); expect(second.pages).toBe(2);
      expect((await readingSearch(owner, { query: `Paged reading ${owner}`, kind: 'book', page: 3 })).items).toEqual([]);
      metadata.mockImplementation(async () => { throw new Error('Provider unavailable'); });
      const fallback = await readingSearch(owner, { query: 'Metadata after completion', kind: 'book' });
      expect(fallback.items.map(item => item.id)).toEqual([bookId]); expect(fallback.failure).toContain('Open Library');
      expect(await getDb().select({ id: works.id }).from(works)).toHaveLength(before.length);
      await saveConfig({ ...config, experimentalBooks: false, experimentalComics: true });
      await expect(readingSearch(owner, { query: 'title', kind: 'book' })).rejects.toMatchObject({ status: 404 });
    } finally {
      readiness.mockRestore(); metadata.mockRestore();
      await saveConfig({ ...config, experimentalBooks: true, experimentalComics: true });
      await updateReading(owner, bookId, { page: 0, totalPages: null });
    }
  });

  test('local Search renders before provider work and streamed failures preserve that exact page', async () => {
    const readiness = spyOn(readingProviders, 'readingProviderConfigured').mockResolvedValue(true);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const metadata = spyOn(readingProviders, 'searchReading').mockImplementation(async () => { await waiting; throw new Error('Provider unavailable'); });
    try {
      const event = { locals: { user: { id: owner } }, url: new URL('http://coast/search?view=read&q=Metadata%20after%20completion'), depends: () => {} };
      const route = await loadSearchPage(event as Parameters<typeof loadSearchPage>[0]);
      expect(route!.readingInitial.items.map((item: { id: string }) => item.id)).toEqual([bookId]);
      expect(route!.readingInitial.items[0].trackingProgress).toEqual({ unit: 'pages', value: 0 });
      release();
      const result = await route!.read;
      expect(result.items).toEqual(route!.readingInitial.items);
      expect(result.failure).toContain('Open Library');
      expect(result.failure).toContain('Comic Vine');
      metadata.mockClear(); readiness.mockClear();
      const initial = await readingSearchInitial(owner, { query: 'Metadata after completion', kind: 'book' });
      expect(initial.items.map(item => item.id)).toEqual([bookId]);
      expect(metadata).not.toHaveBeenCalled(); expect(readiness).not.toHaveBeenCalled();
    } finally { release(); readiness.mockRestore(); metadata.mockRestore(); }
  });

  test('saved provider previews redirect to canonical details without requiring a working source', async () => {
    const metadata = spyOn(readingProviders, 'readingProviderDetails').mockImplementation(async () => { throw new Error('Source unavailable'); });
    const event = (externalId: string) => ({ locals: { user: { id: owner } }, params: { externalId }, depends: () => {}, setHeaders: () => {} }) as unknown as Parameters<ReturnType<typeof readingDetailLoad>>[0];
    try {
      const bookLoad = readingDetailLoad('book', true), comicLoad = readingDetailLoad('comic', true);
      await expect(bookLoad(event(book.externalId) as Parameters<typeof bookLoad>[0])).rejects.toMatchObject({ status: 303, location: `/media/${bookId}` });
      await expect(comicLoad(event(comic.externalId) as Parameters<typeof comicLoad>[0])).rejects.toMatchObject({ status: 303, location: `/media/${comicId}` });
      await expect(bookLoad(event('OL123M') as Parameters<typeof bookLoad>[0])).rejects.toMatchObject({ status: 400 });
      expect(metadata).not.toHaveBeenCalled();
      await saveConfig({ ...config, experimentalBooks: false, experimentalComics: true });
      await expect(bookLoad(event(book.externalId) as Parameters<typeof bookLoad>[0])).rejects.toMatchObject({ status: 404 });
      expect(metadata).not.toHaveBeenCalled();
    } finally { metadata.mockRestore(); await saveConfig({ ...config, experimentalBooks: true, experimentalComics: true }); }
  });

  test('Discover uses provider ranking and release feeds without importing results or inventing comic popularity', async () => {
    const readiness = spyOn(readingProviders, 'readingProviderConfigured').mockResolvedValue(true);
    const metadata = spyOn(readingProviders, 'discoverReading').mockImplementation(async (kind, _section, page = 1) => ({ items: kind === 'book' ? page === 1 ? [book] : [{ ...book, externalId: 'OL888888882W', sourceUrl: 'https://openlibrary.org/works/OL888888882W' }] : [comic], total: 21, page, nextPage: page === 1 ? 2 : null }));
    try {
      const first = await discoveryContent(owner, { surface: 'read', section: 'trending', kind: 'book' });
      expect(first.items.map(item => item.id)).toEqual([bookId]); expect(first.pages).toBe(2);
      const second = await discoveryContent(owner, { surface: 'read', section: 'trending', kind: 'book', page: 2 });
      expect(second.items[0]).toMatchObject({ href: '/media/openlibrary/OL888888882W' });
      const comics = await discoveryContent(owner, { surface: 'read', section: 'recent', kind: 'comic' });
      expect(comics.items[0]).toMatchObject({ id: comicId, href: `/media/${comicId}`, attribution: { label: 'Comic Vine', href: comic.sourceUrl } });
      metadata.mockClear(); readiness.mockClear();
      const unsupported = await discoveryContent(owner, { surface: 'read', section: 'trending', kind: 'comic' });
      expect(unsupported.items).toEqual([]); expect(unsupported.notice).toContain('does not provide a trending feed');
      expect(metadata).not.toHaveBeenCalled(); expect(readiness).not.toHaveBeenCalled();
      await saveConfig({ ...config, experimentalBooks: false, experimentalComics: true });
      await expect(discoveryContent(owner, { surface: 'read', section: 'trending', kind: 'book' })).rejects.toMatchObject({ status: 404 });
      await saveConfig({ ...config, experimentalBooks: false, experimentalComics: false });
      await expect(discoveryContent(owner, { surface: 'read', section: 'trending' })).rejects.toMatchObject({ status: 404 });
    } finally {
      readiness.mockRestore(); metadata.mockRestore();
      await saveConfig({ ...config, experimentalBooks: true, experimentalComics: true });
    }
  });

  test('empty provider Search and invalid provider pages never inspect integrations or request metadata', async () => {
    const readiness = spyOn(readingProviders, 'readingProviderConfigured').mockImplementation(async () => { throw new Error('Unexpected readiness read.'); });
    const metadata = spyOn(readingProviders, 'searchReading').mockImplementation(async () => { throw new Error('Unexpected metadata request.'); });
    try {
      const empty = await readingSearch(owner, { query: ' ', kind: 'all' });
      expect(empty).toMatchObject({ items: [], failure: '', total: 0, pages: 1 });
      await expect(readingSearch(owner, { query: 'title', page: 1001 })).rejects.toThrow();
      expect(readiness).not.toHaveBeenCalled(); expect(metadata).not.toHaveBeenCalled();
    } finally { readiness.mockRestore(); metadata.mockRestore(); }
  });

  test('shared reading routes enforce page and subtype gates and make discovery reachable without TMDB', async () => {
    const event = (url: string) => ({ locals: { user: { id: owner } }, url: new URL(`http://coast${url}`), depends: () => {} });
    const readiness = spyOn(readingProviders, 'readingProviderConfigured').mockResolvedValue(true);
    const metadata = spyOn(readingProviders, 'searchReading').mockResolvedValue({items:[],total:0,page:1,nextPage:null});
    const discoverMetadata = spyOn(readingProviders, 'discoverReading').mockResolvedValue({items:[comic],total:1,page:1,nextPage:null});
    try {
      const all = await loadSearchPage(event(`/search?q=${encodeURIComponent('Metadata after completion')}`) as Parameters<typeof loadSearchPage>[0]);
      expect((await all!.read).items.map((item: { id: string }) => item.id)).toEqual([bookId]);
      const noQuery = await loadSearchPage(event('/search?view=read&scope=providers') as Parameters<typeof loadSearchPage>[0]);
      expect((await noQuery!.read).items).toEqual([]);
      const books = await loadSearchPage(event('/search?q=Metadata%20after%20completion&type=book') as Parameters<typeof loadSearchPage>[0]);
      expect(books).toMatchObject({ kind: 'book', view: 'read' });
      await Promise.all([books!.watch, books!.listen, books!.play, books!.read]);
      expect(metadata).toHaveBeenCalledWith('book', 'Metadata after completion', 1);
      expect(metadata).toHaveBeenCalledWith('comic', 'Metadata after completion', 1);
      await expect(loadSearchPage(event('/search?type=not-a-medium') as Parameters<typeof loadSearchPage>[0])).rejects.toMatchObject({ status: 400 });
      const discover = await loadDiscoverPage(event('/discover?surface=read&kind=comic&section=recent') as Parameters<typeof loadDiscoverPage>[0]);
      expect(discover.selected?.items.map(item => item.id)).toEqual([comicId]);
      expect(discover.items).toEqual([]); expect(discover.providerUnavailable).toBe(false);
      await expect(loadSearchPage(event('/search?view=read&scope=providers&page=1001') as Parameters<typeof loadSearchPage>[0])).rejects.toMatchObject({ status: 400 });
      await expect(loadDiscoverPage(event('/discover?surface=read&page=0') as Parameters<typeof loadDiscoverPage>[0])).rejects.toMatchObject({ status: 400 });
      await saveConfig({ ...config, experimentalBooks: true, experimentalComics: false });
      await expect(loadSearchPage(event('/search?view=read&kind=comic') as Parameters<typeof loadSearchPage>[0])).rejects.toMatchObject({ status: 404 });
      await expect(loadSearchPage(event('/search?type=comic') as Parameters<typeof loadSearchPage>[0])).rejects.toMatchObject({ status: 404 });
      await expect(loadDiscoverPage(event('/discover?surface=read&kind=comic&section=recent') as Parameters<typeof loadDiscoverPage>[0])).rejects.toMatchObject({ status: 404 });
      expect(metadata).toHaveBeenCalled(); expect(discoverMetadata).toHaveBeenCalled();
    } finally {
      readiness.mockRestore(); metadata.mockRestore(); discoverMetadata.mockRestore();
      await saveConfig({ ...config, experimentalBooks: true, experimentalComics: true });
    }
  });

  test('shared Library and progress routes translate disabled reading and invalid filters into HTTP errors', async () => {
    const event = (path: string) => ({ locals: { user: { id: owner, username: 'owner' } }, url: new URL(`http://coast${path}`), depends: () => {} });
    const rejectsHttp = async (task: unknown, status: number) => {
      const failure = await Promise.resolve(task).then(() => null, cause => cause);
      expect(isHttpError(failure, status)).toBe(true);
    };
    try {
      await saveConfig({ ...config, experimentalBooks: true, experimentalComics: true });
      await rejectsHttp(loadLibraryPage(event('/library?view=read&kind=movie') as Parameters<typeof loadLibraryPage>[0]), 400);
      await rejectsHttp(loadProgressPage(event('/progress?category=screen&kind=book') as Parameters<typeof loadProgressPage>[0]), 400);
      await saveConfig({ ...config, experimentalBooks: false, experimentalComics: false });
      await rejectsHttp(loadLibraryPage(event('/library?view=read') as Parameters<typeof loadLibraryPage>[0]), 404);
      await rejectsHttp(loadProgressPage(event('/progress?category=reading') as Parameters<typeof loadProgressPage>[0]), 404);
    } finally { await saveConfig({ ...config, experimentalBooks: true, experimentalComics: true }); }
  });
  test('explicit cross-provider identities share one comic UUID, progress and canonical search card', async () => {
    const ol: ReadingMetadata = { ...book, kind: 'comic', externalId: 'OL977000001W', title: 'Shared issue #1', subjects: ['Comics'],
      sourceUrl: 'https://openlibrary.org/works/OL977000001W', identities: [{ provider: 'comic-vine', externalId: '4000-977000001' }] };
    const vine: ReadingMetadata = { ...comic, externalId: '4000-977000001', title: 'Shared issue', sourceUrl: 'https://comicvine.gamespot.com/issue/4000-977000001/' };
    const [first, second] = await Promise.all([importReading(ol), importReading(ol)]); fixtureIds.add(first.id);
    expect(second.id).toBe(first.id);
    expect((await importReading(vine)).id).toBe(first.id);
    await updateReading(owner, first.id, { page: 12, totalPages: 40 });
    expect(await readingStoredWorkId('comic', vine.externalId)).toBe(first.id);
    expect(await readingStoredWorkId('book', ol.externalId)).toBe(first.id);
    const cards = await readingProviderCards(owner, [ol, vine]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: first.id, kind: 'comic', trackingProgress: { value: 12, total: 40 } });
    const otherCards = await readingProviderCards(other, [ol, vine]);
    expect(otherCards[0].trackingProgress).toBeUndefined();
    const alternate = await importReading({ ...ol, externalId: 'OL977000002W', sourceUrl: 'https://openlibrary.org/works/OL977000002W', identities: [] }); fixtureIds.add(alternate.id);
    expect(alternate.id).not.toBe(first.id);
    await expect(importReading({ ...ol, externalId: 'OL977000002W', sourceUrl: 'https://openlibrary.org/works/OL977000002W' })).rejects.toThrow('separate saved works');
    expect((await readingDetails(owner, first.id)).progress?.page).toBe(12);
  });

  test('Open Library comic classification upgrades a saved book without replacing its progress', async () => {
    const metadata = { ...book, externalId: 'OL977000003W', sourceUrl: 'https://openlibrary.org/works/OL977000003W' };
    const item = await importReading(metadata); fixtureIds.add(item.id);
    await updateReading(owner, item.id, { page: 8, totalPages: 30 });
    expect((await importReading({ ...metadata, kind: 'comic', subjects: ['Graphic novels'] })).id).toBe(item.id);
    expect((await readingDetails(owner, item.id)).item.kind).toBe('comic');
    expect((await readingDetails(owner, item.id)).progress?.page).toBe(8);
    expect((await getDb().select().from(workIdentifiers).where(eq(workIdentifiers.workId, item.id))).map(identity => identity.kind)).toEqual(['comic']);
  });

  test('local reading search matches punctuation, reordered words, series and authors before typo fallback', async () => {
    const item = await importReading({ ...comic, externalId: '4000-977000009', title: 'A story', seriesTitle: 'Harley Quinn: Animated Series', authors: ['Amanda Conner'], sourceUrl: 'https://comicvine.gamespot.com/issue/4000-977000009/' }); fixtureIds.add(item.id);
    for (const search of ['Harley Quinn Animated', 'Quinn Harley', 'Amanda Conner', 'Harley Qunin']) {
      expect((await readingCatalogue(owner, { search, personal: false })).items.map(value => value.id)).toContain(item.id);
    }
    const indexes = await getDb().execute<{indexname:string}>(sql`select indexname from pg_indexes where indexname='reading_works_search_document_idx'`);
    expect(Array.from(indexes)).toHaveLength(1);
  });

});
