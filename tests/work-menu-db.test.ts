import { beforeAll, afterAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { getConfig } from '../src/lib/server/config';
import { workActionData, workActionLists, workCards } from '../src/lib/collection/query.server';
import { createGame, createPlaythrough, gameDetails, listGames } from '../src/lib/core/games/service.server';
import { createList, addListItem } from '../src/lib/core/lists/service.server';
import { importReading } from '../src/lib/catalogue/reading.server';
import { readingCatalogue, readingDetails } from '../src/lib/reading/query.server';
import { getPresentationEditor, savePresentationPreference, resetPresentationPreference } from '../src/lib/catalogue/overrides/service.server';
import { personaliseMusicItems } from '../src/lib/music/service.server';
import { logMusic } from '../src/lib/music/persistence.server';
import { musicHistory } from '../src/lib/music/history.server';
import { savedMusicQueuePage } from '../src/lib/music/queue.server';
import { searchPresentations } from '../src/lib/server/queries/search';
import type { MusicItem } from '../src/lib/music/model';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const owner = crypto.randomUUID(), other = crypto.randomUUID();
let game: string, book: string, track: string, movie: string;
let config: Awaited<ReturnType<typeof getConfig>>;
const records: string[] = [];
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const db = getDb(); config = await getConfig();
  await db.insert(s.systemSettings).values({ key: 'coast', value: { ...config, experimentalMusic: true, experimentalGaming: true, experimentalBooks: true, experimentalComics: true } }).onConflictDoUpdate({ target: s.systemSettings.key, set: { value: { ...config, experimentalMusic: true, experimentalGaming: true, experimentalBooks: true, experimentalComics: true } } });
  await db.insert(s.users).values([owner, other].map(id => ({ id, username: `work-menu-${id}` })));
  game = (await createGame({ title: 'Original game', platforms: ['PC'] })).id;
  book = (await importReading({ provider: 'openlibrary', externalId: 'OL987654321W', kind: 'book', title: 'Original book', authors: [], subjects: [], sourceUrl: 'https://openlibrary.org/works/OL987654321W' })).id;
  const [music] = await db.insert(s.works).values({ category: 'music', kind: 'track' }).returning(); track = music.id;
  await db.insert(s.musicWorks).values({ id: track, kind: 'track', title: 'Original track' });
  movie = (await db.insert(s.media).values({ kind: 'movie', title: 'Original movie' }).returning())[0].id;
  records.push(game, book, track, movie);
});
afterAll(async () => {
  if (!config) return;
  const db = getDb();
  await db.delete(s.users).where(inArray(s.users.id, [owner, other]));
  await db.delete(s.works).where(inArray(s.works.id, records));
  await db.update(s.systemSettings).set({ value: config }).where(eq(s.systemSettings.key, 'coast'));
});
run('common local snapshots preserve selected playthrough and owner scope without returning lists or sessions', async () => {
  const first = await createPlaythrough(owner, game, { platform: 'PC', status: 'in-progress' });
  const second = await createPlaythrough(owner, game, { platform: 'Console', status: 'planned', repeat: true });
  const outsider = await createPlaythrough(other, game, { status: 'planned' });
  const selected = await workActionData(owner, game, first.id);
  expect(selected.game?.playthrough?.id).toBe(first.id);
  expect(selected.game?.platforms).toEqual(['PC']);
  expect((await workActionData(owner, game)).game?.playthrough?.id).toBe(second.id);
  expect((await workActionData(owner, game, outsider.id)).game?.playthrough).toBeNull();
  expect(selected).not.toHaveProperty('lists');
  expect(selected.reasons).toContainEqual({relationship:'watchlist',origin:'direct'});
  expect(selected.game?.playthrough).not.toHaveProperty('sessions');
});
run('list branch pages all lists once and reports exact repeated membership without duplicate list rows', async () => {
  const db = getDb();
  await db.insert(s.lists).values(Array.from({ length: 65 }, (_, i) => ({ userId: owner, name: `List ${String(i).padStart(2, '0')}` })));
  const playlist = await createList(owner, { name: 'Repeated playlist', playlist: true, mediaId: track });
  const repeated = await addListItem(owner, playlist.id, track);
  const first = await workActionLists(owner, track), second = await workActionLists(owner, track, 2);
  expect(first.total).toBe(66); expect(first.items).toHaveLength(60); expect(second.items).toHaveLength(6);
  expect(new Set([...first.items, ...second.items].map(list => list.id)).size).toBe(66);
  const member = second.items.find(list => list.id === playlist.id)!;
  expect(member.count).toBe(2); expect(member.entries).toHaveLength(1);
  expect(member.entries[0].id).not.toBe(repeated.entryId);
  expect((await workActionLists(other, track)).total).toBe(0);
  expect((await workActionLists(owner, book, 1, true)).total).toBe(65);
});
run('shared presentation preferences work across media, remain private, and reset without changing provider metadata', async () => {
  for (const [id, title] of [[game, 'Nebulaprivategame'], [book, 'Nebulaprivatebook'], [track, 'My peculiar track'], [movie, 'My peculiar movie']]) {
    await savePresentationPreference(owner, id, { title, posterPath: 'https://example.com/personal.jpg', backdropPath: 'https://example.com/background.jpg' });
    expect((await getPresentationEditor(owner, id)).preference?.title).toBe(title);
    expect((await getPresentationEditor(other, id)).preference).toBeNull();
  }
  expect((await gameDetails(owner, game)).title).toBe('Nebulaprivategame');
  expect((await gameDetails(other, game)).title).toBe('Original game');
  expect((await listGames('Nebulaprivategame', 1, { userId: owner, personal: false })).items[0]?.id).toBe(game);
  expect((await listGames('Nebulaprivategame', 1, { userId: other, personal: false })).total).toBe(0);
  expect((await readingDetails(owner, book)).item.title).toBe('Nebulaprivatebook');
  expect((await readingCatalogue(owner, { search: 'Nebulaprivatebook', personal: false })).total).toBe(1);
  expect((await readingCatalogue(other, { search: 'Nebulaprivatebook', personal: false })).total).toBe(0);
  const competitor = await importReading({ provider: 'openlibrary', externalId: 'OL987654322W', kind: 'book', title: 'Nebulaprivatebook anthology', authors: [], subjects: [], sourceUrl: 'https://openlibrary.org/works/OL987654322W' });
  records.push(competitor.id);
  expect((await readingCatalogue(owner, { search: 'Nebulaprivatebook', personal: false })).items[0].id).toBe(book);
  await getDb().update(s.readingWorks).set({ coverUrl: 'https://fixture.invalid/provider-cover.jpg' }).where(eq(s.readingWorks.id, book));
  await resetPresentationPreference(owner, book);
  await savePresentationPreference(owner, book, { title: 'Nebulaprivatebook' });
  const partial = (await readingDetails(owner, book)).item;
  expect(partial.coverUrl).toBe('https://fixture.invalid/provider-cover.jpg');
  expect(partial).not.toHaveProperty('backdropUrl');
  const music: MusicItem = { id: 'provider-id', workId: track, title: 'Original track', kind: 'track', artists: [], albumArtists: [], artistNames: [], genres: [], externalIds: {} };
  expect((await personaliseMusicItems(owner, [music]))[0].title).toBe('My peculiar track');
  expect((await personaliseMusicItems(other, [music]))[0].title).toBe('Original track');
  const own = await workCards(owner, owner, [game, book, track]);
  expect(own.map(item => item.title)).toEqual(['Nebulaprivategame', 'Nebulaprivatebook', 'My peculiar track']);
  expect((await workCards(owner, other, [game, book, track])).map(item => item.title)).toEqual(['Original game', 'Original book', 'Original track']);
  expect((await getDb().select().from(s.games).where(eq(s.games.id, game)))[0].title).toBe('Original game');
  await resetPresentationPreference(owner, game);
  expect((await gameDetails(owner, game)).title).toBe('Original game');
});
run('party picker has bounded complete unique pages, including tracks beyond the old 200 cutoff', async () => {
  const db = getDb();
  const tracks = await db.insert(s.works).values(Array.from({ length: 205 }, () => ({ category: 'music' as const, kind: 'track' as const }))).returning();
  records.push(...tracks.map(track => track.id));
  await db.insert(s.musicWorks).values(tracks.map((track, i) => ({ id: track.id, kind: 'track' as const, title: `Picker ${i}` })));
  await db.insert(s.upNext).values(tracks.map(track => ({ userId: owner, mediaId: track.id })));
  const pages = [];
  for (let page = 1; page <= 4; page++) pages.push(await savedMusicQueuePage(owner, page));
  expect(pages.map(page => page.items.length)).toEqual([60, 60, 60, 25]);
  expect(pages[0].total).toBe(205);
  expect(new Set(pages.flatMap(page => page.items.map(item => item.id))).size).toBe(205);
  expect((await savedMusicQueuePage(other)).total).toBe(0);
});

run('music history is local, owner scoped, bounded and preserves undated records', async () => {
  const db=getDb();
  await db.insert(s.musicListens).values(Array.from({length:61},(_,i)=>({userId:owner,trackId:track,batchId:crypto.randomUUID(),occurredAtKnown:i!==0,occurredAt:new Date(Date.UTC(2020,0,1,0,i))})));
  await db.insert(s.musicListens).values({userId:other,trackId:track,batchId:crypto.randomUUID()});
  await expect(logMusic(owner,track,{batchId:crypto.randomUUID(),occurredAt:'2999-01-01T00:00:00.000Z'})).rejects.toThrow('past');
  const first=await musicHistory(owner,track),second=await musicHistory(owner,track,2);
  expect(first.items).toHaveLength(60);expect(first.total).toBe(61);expect(second.items).toHaveLength(1);
  expect(second.items[0].dateKnown).toBe(false);expect((await musicHistory(other,track)).total).toBe(1);
});

run('private music alias search preserves availability, owner isolation and bounded-result notice', async () => {
  const db = getDb();
  const [instance] = await db.insert(s.providerInstances).values({ provider: 'jellyfin', name: 'Menu alias fixture', baseUrl: 'https://fixture.invalid' }).returning();
  try {
    // No credentials: provider browsing fails locally before any remote request.
    const [connection] = await db.insert(s.providerConnections).values({ userId: owner, instanceId: instance.id, externalUserId: 'fixture' }).returning();
    const [item] = await db.insert(s.providerItems).values({ instanceId: instance.id, mediaId: track, externalId: 'fixture-track', kind: 'track' }).returning();
    await db.insert(s.availability).values({ userId: owner, connectionId: connection.id, providerItemId: item.id, mediaId: track });
    const found = await searchPresentations(owner, 'listen', 'My peculiar track', 'track');
    expect(found.items.find(item => item.workId === track)?.available).toBe(true);
    expect((await searchPresentations(other, 'listen', 'My peculiar track', 'track')).items).toHaveLength(0);

    const tracks = await db.insert(s.works).values(Array.from({ length: 61 }, () => ({ category: 'music' as const, kind: 'track' as const }))).returning();
    records.push(...tracks.map(track => track.id));
    await db.insert(s.musicWorks).values(tracks.map((track, index) => ({ id: track.id, kind: 'track' as const, title: `Shared name ${index}` })));
    await db.insert(s.userMetadataPreferences).values(tracks.map((track, index) => ({ userId: owner, mediaId: track.id, title: `Private alias music ${index}` })));
    const bounded = await searchPresentations(owner, 'listen', 'Private alias music', 'track');
    expect(bounded.items).toHaveLength(60);
    expect(bounded.truncated).toBe(true);
    expect(bounded.items.every(item => item.available === false)).toBe(true);
  } finally {
    await db.delete(s.providerInstances).where(eq(s.providerInstances.id, instance.id));
  }
});
