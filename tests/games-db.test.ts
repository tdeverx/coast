import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, getSql } from '../src/lib/server/db';
import { gameRow } from '../src/lib/server/queries/media-rows';
import { getConfig } from '../src/lib/server/config';
import { libraryContent } from '../src/lib/server/queries/library-content';
import { users, games, systemSettings, gamePlaythroughs } from '../src/lib/server/db/schema';
import { createGame, createPlaythrough, gameDetails, logGameSession, playthroughDetails, playthroughChoices, updatePlaythrough, listGames } from '../src/lib/core/games/service.server';

const target = process.env.TEST_DATABASE_URL;
const suite = target ? describe : describe.skip;
suite('game catalog and private playthroughs', () => {
  const previous = process.env.DATABASE_URL;
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  let gameId: string;
  beforeAll(async () => {
    await closeDb(); process.env.DATABASE_URL = target!;
    await migrate(getDb(), { migrationsFolder: `${import.meta.dir}/../drizzle` });
    const config=await getConfig();await getDb().insert(systemSettings).values({key:'coast',value:{...config,experimentalGaming:true}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{...config,experimentalGaming:true}}});
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
  test('dated completion preserves sessions and projects its chosen date once', async () => {
    const playthrough = await createPlaythrough(owner, gameId, { status: 'in-progress' });
    const session = { id: crypto.randomUUID(), minutesPlayed: 35, playedAt: '2020-01-01T12:00:00.000Z' };
    await logGameSession(owner, playthrough.id, session);
    const completedAt = '2020-02-01T12:00:00.000Z';
    const completed = await updatePlaythrough(owner, playthrough.id, { status: 'completed', completedAt });
    expect(completed.completedAt?.toISOString()).toBe(completedAt);
    expect((await playthroughDetails(owner, playthrough.id)).minutesPlayed).toBe(35);
    expect(await updatePlaythrough(owner, playthrough.id, { status: 'completed', completedAt })).toEqual(completed);
    const nextDate = '2020-03-01T12:00:00.000Z';
    await updatePlaythrough(owner, playthrough.id, { status: 'completed', completedAt: nextDate });
    const projected = await getSql()`SELECT event_kind, occurred_at FROM social_activity
      WHERE user_id=${owner} AND source_key=${`game_playthroughs:${playthrough.id}`}`;
    expect(projected).toHaveLength(1);
    expect(projected[0].event_kind).toBe('game-completed');
    expect(new Date(projected[0].occurred_at).toISOString()).toBe(nextDate);
    await expect(updatePlaythrough(other, playthrough.id, { status: 'completed', completedAt })).rejects.toThrow('not found');
    await updatePlaythrough(owner, playthrough.id, { status: 'in-progress' });
  });
  test('game previews honour personal state; unknown availability is an empty selection rather than a failed job',async()=>{
    const saved=await getConfig();
    await getDb().insert(systemSettings).values({key:'coast',value:{...saved,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{...saved,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}});
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
  test('playthrough menu choices page only the owner and selected game in a stable order',async()=>{
    const db=getDb(),selected=(await createGame({title:'Choice pages'})).id;
    try{
      const choices=Array.from({length:23},(_,index)=>({id:crypto.randomUUID(),userId:owner,gameId:selected,platform:'PC',
        status:'in-progress' as const,createdAt:new Date(Date.UTC(2020,0,1)+Math.floor(index/2)*1000)}));
      await db.insert(gamePlaythroughs).values([...choices,{id:crypto.randomUUID(),userId:other,gameId:selected,status:'planned',createdAt:new Date('2030-01-01')}]);
      const expected=choices.toSorted((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||b.id.localeCompare(a.id));
      const first=await playthroughChoices(owner,selected,1),second=await playthroughChoices(owner,selected,2);
      expect(first.items.map(item=>item.id)).toEqual(expected.slice(0,20).map(item=>item.id));expect(first.hasMore).toBe(true);
      expect(second.items.map(item=>item.id)).toEqual(expected.slice(20).map(item=>item.id));expect(second.hasMore).toBe(false);
      expect((await playthroughChoices(other,selected)).items).toHaveLength(1);
      expect((await playthroughChoices(owner,selected,3)).items).toEqual([]);
      await expect(playthroughChoices(owner,selected,0)).rejects.toThrow();
      await db.update(users).set({settings:{features:{game:false}}}).where(eq(users.id,owner));
      await expect(playthroughChoices(owner,selected)).rejects.toMatchObject({status:403});
    }finally{
      await db.update(users).set({settings:{}}).where(eq(users.id,owner));
      await db.delete(games).where(eq(games.id,selected));
    }
  });

});
