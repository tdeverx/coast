import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq, inArray } from 'drizzle-orm';
import { closeDb, getDb } from '../src/lib/server/db';
import { users, games } from '../src/lib/server/db/schema';
import { createGame, createPlaythrough, gameDetails, logGameSession, playthroughDetails, updatePlaythrough, listGames } from '../src/lib/core/games/service';

const target = process.env.TEST_DATABASE_URL;
const suite = target ? describe : describe.skip;
suite('game catalog and private playthroughs', () => {
  const previous = process.env.DATABASE_URL;
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  let gameId: string;
  beforeAll(async () => {
    await closeDb(); process.env.DATABASE_URL = target!;
    await migrate(getDb(), { migrationsFolder: `${import.meta.dir}/../drizzle` });
    await getDb().insert(users).values([owner, other].map((id) => ({ id, username: `games-${id}`, passwordHash: 'fixture' })));
  });
  afterAll(async () => {
    await getDb().delete(users).where(inArray(users.id, [owner, other]));
    if (gameId) await getDb().delete(games).where(eq(games.id, gameId));
    await closeDb();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  });
  test('identity conflicts roll back the whole catalog insert', async () => {
    const input = { title: `Games fixture ${owner}`, platforms: ['PC'], genres: ['RPG'], identities: [{ provider: 'fixture', externalId: owner }] };
    gameId = (await createGame(input)).id;
    await expect(createGame(input)).rejects.toThrow('provider identity');
    expect((await listGames(input.title)).total).toBe(1);
  });
  test('session retries and concurrent inserts count once; histories and edits are private', async () => {
    const playthrough = await createPlaythrough(owner, gameId, { platform: 'PC' });
    const session = { id: crypto.randomUUID(), minutesPlayed: 30, playedAt: '2020-01-01T12:00:00.000Z' };
    await Promise.all([logGameSession(owner, playthrough.id, session), logGameSession(owner, playthrough.id, session)]);
    expect((await playthroughDetails(owner, playthrough.id)).minutesPlayed).toBe(30);
    expect((await playthroughDetails(owner, playthrough.id)).status).toBe('in-progress');
    await expect(logGameSession(owner, playthrough.id, { ...session, minutesPlayed: 60 })).rejects.toThrow('already in use');
    expect((await gameDetails(other, gameId)).playthroughs).toEqual([]);
    await expect(playthroughDetails(other, playthrough.id)).rejects.toThrow('not found');
    await expect(updatePlaythrough(other, playthrough.id, { status: 'completed' })).rejects.toThrow('not found');
    await expect(logGameSession(other, playthrough.id, { ...session, id: crypto.randomUUID() })).rejects.toThrow('not found');
    await updatePlaythrough(owner, playthrough.id, { progressPercent: 100 });
    expect((await playthroughDetails(owner, playthrough.id)).status).toBe('in-progress');
    await updatePlaythrough(owner, playthrough.id, { status: 'completed' });
    await logGameSession(owner, playthrough.id, session);
    await expect(logGameSession(owner, playthrough.id, { ...session, id: crypto.randomUUID() })).rejects.toThrow('Resume');
    await updatePlaythrough(owner, playthrough.id, { status: 'in-progress' });
    expect((await playthroughDetails(owner, playthrough.id)).completedAt).toBeNull();
    const replay = await createPlaythrough(owner, gameId, { repeat: true, status: 'in-progress' });
    expect((await playthroughDetails(owner, replay.id)).minutesPlayed).toBe(0);
    expect((await playthroughDetails(owner, replay.id)).startedAt).not.toBeNull();
    expect((await playthroughDetails(owner, replay.id)).status).toBe('in-progress');
    expect((await playthroughDetails(owner, playthrough.id)).minutesPlayed).toBe(30);
  });
});
