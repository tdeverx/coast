import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { inArray, sql } from 'drizzle-orm';
import { closeDb, getDb } from '../src/lib/server/db';
import { externalIds, media, userMetadataPreferences, users, works } from '../src/lib/server/db/schema';
import { mediaViews } from '../src/lib/server/queries/media';
import { publicSearch } from '../src/lib/social/public.server';
import { createGame, listGames } from '../src/lib/core/games/service.server';

const target = process.env.TEST_DATABASE_URL;
(target ? describe : describe.skip)('shared indexed catalogue search', () => {
  const previous = process.env.DATABASE_URL;
  const owner = crypto.randomUUID(), other = crypto.randomUUID(), exact = crypto.randomUUID(), longer = crypto.randomUUID(), alias = crypto.randomUUID();
  const ids = new Set<string>([exact, longer, alias]);
  beforeAll(async () => {
    await closeDb(); process.env.DATABASE_URL = target!;
    await migrate(getDb(), { migrationsFolder: `${import.meta.dir}/../drizzle` });
    const db = getDb();
    await db.insert(users).values([owner, other].map(id => ({ id, username: `search-${id}`, passwordHash: 'fixture' })));
    await db.insert(media).values([
      { id: longer, kind: 'movie', title: 'Quest for Tomorrow Again', updatedAt: new Date('2026-01-01') },
      { id: exact, kind: 'movie', title: 'Quest for: Tomorrow', updatedAt: new Date('2000-01-01') },
      { id: alias, kind: 'show', title: 'Hidden title' },
    ]);
    await db.insert(userMetadataPreferences).values({ userId: other, mediaId: alias, title: 'Private Alias' });
    await db.insert(externalIds).values({ mediaId: exact, provider: 'tmdb', externalId: '999777111', mediaKind: 'movie' });
  });
  afterAll(async () => {
    const db = getDb();
    await db.delete(users).where(inArray(users.id, [owner, other]));
    await db.delete(works).where(inArray(works.id, [...ids]));
    await closeDb();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  });
  test('screen relevance precedes metadata updates and tolerates punctuation/word order/typos', async () => {
    expect((await mediaViews(owner, { query: 'QUEST FOR TOMORROW' })).map(item => item.id)).toEqual([exact, longer]);
    expect((await mediaViews(owner, { query: 'Tomorrow Quest' })).map(item => item.id)).toContain(exact);
    expect((await mediaViews(owner, { query: 'Quest Tomorow' })).map(item => item.id)).toContain(exact);
    expect(await mediaViews(owner, { query: '---' })).toEqual([]);
    expect((await publicSearch('Tomorrow Quest')).map(item => item.id)).toEqual([exact]);
  });
  test('private title aliases participate only for their owner, never for guests', async () => {
    expect((await mediaViews(other, { query: 'Private Alias' })).map(item => item.id)).toEqual([alias]);
    expect(await mediaViews(owner, { query: 'Private Alias' })).toEqual([]);
    expect(await publicSearch('Private Alias')).toEqual([]);
  });
  test('games reuse word and typo search without changing private membership', async () => {
    const game = await createGame({ title: 'Quest for: Tomorrow', platforms: [], genres: [] }); ids.add(game.id);
    expect((await listGames('Tomorrow Quest', 1, { userId: owner, personal: false })).items.map(item => item.id)).toContain(game.id);
    expect((await listGames('Quest Tomorow', 1, { userId: owner, personal: false })).items.map(item => item.id)).toContain(game.id);
    expect((await listGames('Tomorrow Quest', 1, { userId: owner })).items).toEqual([]);
  });
  test('the native search index is used on a catalogue-sized candidate read', async () => {
    const db = getDb();
    const fixtures = Array.from({ length: 3000 }, (_, i) => ({ id: crypto.randomUUID(), kind: 'movie' as const, title: `Unrelated background ${i}` }));
    fixtures.forEach(item => ids.add(item.id));
    await db.insert(media).values(fixtures);
    await db.execute(sql`analyze media`);
    const plans = await db.execute<{ 'QUERY PLAN': unknown }>(sql`explain (analyze,buffers,format json)
      select id from media where coast_search_document(title,original_title) @@ to_tsquery('simple','quest:* & tomorrow:*') limit 101`);
    expect(JSON.stringify(Array.from(plans))).toContain('media_search_document_idx');
    expect((await mediaViews(owner, { query: 'Quest Tomorrow', limit: 1 })).map(item => item.id)).toEqual([exact]);
  });
});
