import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq, inArray } from 'drizzle-orm';
import { closeDb, getDb } from '../src/lib/server/db';
import { gameRow } from '../src/lib/server/queries/media-rows';
import { getConfig } from '../src/lib/server/config';
import { libraryContent } from '../src/lib/server/queries/library-content';
import { users, games, systemSettings } from '../src/lib/server/db/schema';
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
    await updatePlaythrough(owner, playthrough.id, { status: 'completed' });
    const replay = await createPlaythrough(owner, gameId, { repeat: true, status: 'in-progress' });
    expect((await listGames('', 1, { userId: owner, status: 'completed' })).items.some((item) => item.id === gameId)).toBe(false);
    expect((await listGames('', 1, { userId: owner, status: 'in-progress' })).items.some((item) => item.id === gameId)).toBe(true);
    expect((await playthroughDetails(owner, replay.id)).minutesPlayed).toBe(0);
    expect((await playthroughDetails(owner, replay.id)).startedAt).not.toBeNull();
    expect((await playthroughDetails(owner, replay.id)).status).toBe('in-progress');
    expect((await playthroughDetails(owner, playthrough.id)).minutesPlayed).toBe(30);
    expect((await listGames('', 1, { userId: owner })).items.some((item) => item.id === gameId)).toBe(true);
    expect((await listGames('', 1, { userId: other })).items).toEqual([]);
    await expect(listGames('', 1, { userId: owner, status: '' as never })).rejects.toThrow();
    expect((await gameRow(owner, true)).items.map((item) => item.id)).toEqual([gameId]);
    expect((await gameRow(other, true)).items).toEqual([]);
    expect((await gameRow(other)).items.some((item) => item.id === gameId)).toBe(true);
    expect((await listGames('', 1, { userId: owner, status: 'in-progress' })).items.some((item) => item.id === gameId)).toBe(true);
    expect((await listGames('', 1, { userId: other, status: 'in-progress' })).items).toEqual([]);
    await createPlaythrough(other, gameId, { status: 'planned' });
    expect((await listGames('', 1, { userId: owner, status: 'planned' })).items).toEqual([]);
    expect((await listGames('', 1, { userId: other, status: 'planned' })).items.map((item) => item.id)).toEqual([gameId]);
  });
  test('game previews honour personal state; unknown availability is an empty selection rather than a failed job',async()=>{
    const saved=await getConfig();
    await getDb().insert(systemSettings).values({key:'coast',value:{...saved,experimentalFeatures:true}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{...saved,experimentalFeatures:true}}});
    try{
      const browse=(user:string,parameters:string)=>libraryContent(user,new URL(`http://coast/library?surface=play&${parameters}`));
      expect((await browse(owner,'preview=true&personal=true&selection=in-progress')).items.map(item=>item.id)).toEqual([gameId]);
      expect((await browse(other,'preview=true&personal=true&selection=in-progress')).items).toEqual([]);
      const unknown=await browse(owner,'preview=true&personal=true&scope=available');
      expect(unknown.items).toEqual([]);expect(unknown.failure).toBeFalsy();
      expect((await browse(owner,'scope=all')).items.map(item=>item.id)).toEqual([gameId]);
      expect((await browse(owner,'scope=available')).failure).toBeUndefined();
    }finally{await getDb().update(systemSettings).set({value:saved}).where(eq(systemSettings.key,'coast'));}
  });

});
