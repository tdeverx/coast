import { and, asc, count, desc, eq, ilike, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb, type Database } from '../../server/db';
import { games, gameExternalIds, gamePlaythroughs, gameSessions } from '../../server/db/schema';
import { PAGE_SIZE, pageNumberSchema, pagination } from '../../server/queries/pagination';
import { DomainError } from '../errors';
import { trackInTransaction } from '../tracking/service';
import { enqueueCollectionProjectionInTransaction } from '../../sync/changes';
import { gameInputSchema, playthroughInputSchema, playthroughUpdateSchema, gameSessionInputSchema } from '../../games/model';

const uuid = (value: string) => v.parse(v.pipe(v.string(), v.uuid()), value);
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const minutesPlayed = sql<number>`coalesce((select sum(minutes_played) from game_sessions where playthrough_id = game_playthroughs.id), 0)`.mapWith(Number);
const playthroughFields = {
  id: gamePlaythroughs.id, gameId: gamePlaythroughs.gameId, platform: gamePlaythroughs.platform,
  status: gamePlaythroughs.status, progressPercent: gamePlaythroughs.progressPercent,
  repeat: gamePlaythroughs.repeat, startedAt: gamePlaythroughs.startedAt,
  completedAt: gamePlaythroughs.completedAt, createdAt: gamePlaythroughs.createdAt,
  updatedAt: gamePlaythroughs.updatedAt, minutesPlayed,
};

export async function createGame(raw: unknown) {
  const { identities, ...input } = v.parse(gameInputSchema, raw);
  return getDb().transaction(async (tx) => {
    const [game] = await tx.insert(games).values(input).returning();
    if (identities.length) {
      const inserted = await tx.insert(gameExternalIds)
        .values(identities.map((identity) => ({ gameId: game.id, ...identity })))
        .onConflictDoNothing().returning();
      if (inserted.length !== identities.length)
        throw new DomainError('A game already uses this provider identity.', 409, 'identity_conflict');
    }
    return { ...game, category: 'game' as const, identities };
  });
}

export async function listGames(search = '', requestedPage = 1, tracking?: { userId: string; status?: import('../../games/model').GameStatus }) {
  v.parse(pageNumberSchema, requestedPage);
  const query = v.parse(v.pipe(v.string(), v.trim(), v.maxLength(250)), search);
  if (tracking) {
    uuid(tracking.userId);
    if (tracking.status !== undefined) v.parse(v.picklist(['planned', 'in-progress', 'completed', 'paused', 'dropped']), tracking.status);
  }
  const where = and(query ? ilike(games.title, `%${query.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
    tracking ? (tracking.status
      ? sql`(select status from game_playthroughs where game_id = ${games.id} and user_id = ${tracking.userId} order by created_at desc, id desc limit 1) = ${tracking.status}`
      : sql`exists(select 1 from game_playthroughs where game_id = ${games.id} and user_id = ${tracking.userId})`) : undefined);
  const db = getDb();
  const [totals] = await db.select({ total: count() }).from(games).where(where);
  const { page, pages } = pagination(totals.total, requestedPage);
  const items = await db.select().from(games).where(where).orderBy(asc(games.title), asc(games.id))
    .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
  return { items: items.map((item) => ({ ...item, category: 'game' as const })), total: totals.total, page, pages };
}

export async function gameDetails(userId: string | null, gameId: string) {
  if(userId)uuid(userId); uuid(gameId);
  const db = getDb();
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game) throw new DomainError('Game not found.', 404, 'not_found');
  const identities = await db.select({ provider: gameExternalIds.provider, externalId: gameExternalIds.externalId })
    .from(gameExternalIds).where(eq(gameExternalIds.gameId, gameId));
  const playthroughs = userId ? await db.select(playthroughFields).from(gamePlaythroughs)
    .where(and(eq(gamePlaythroughs.userId, userId), eq(gamePlaythroughs.gameId, gameId)))
    .orderBy(desc(gamePlaythroughs.createdAt), desc(gamePlaythroughs.id)).limit(PAGE_SIZE) : [];
  return { ...game, category: 'game' as const, identities, playthroughs };
}

export async function createPlaythrough(userId: string, gameId: string, raw: unknown) {
  uuid(userId); uuid(gameId);
  const input = v.parse(playthroughInputSchema, raw);
  return getDb().transaction(async (tx) => {
    const [game] = await tx.select({ id: games.id }).from(games).where(eq(games.id, gameId));
    if (!game) throw new DomainError('Game not found.', 404, 'not_found');
    const [row] = await tx.insert(gamePlaythroughs).values({ userId, gameId, ...input, startedAt: input.status === 'in-progress' ? new Date() : null }).returning();
    if(input.status==='planned')await trackInTransaction(tx,userId,{mediaId:gameId,action:'watchlist',value:true});
    await enqueueCollectionProjectionInTransaction(tx,userId);
    return { ...row, minutesPlayed: 0 };
  });
}

async function ownedPlaythrough(tx: Transaction, userId: string, id: string) {
  const [row] = await tx.select().from(gamePlaythroughs)
    .where(and(eq(gamePlaythroughs.id, id), eq(gamePlaythroughs.userId, userId))).for('update');
  if (!row) throw new DomainError('Playthrough not found.', 404, 'not_found');
  return row;
}

export async function updatePlaythrough(userId: string, id: string, raw: unknown) {
  uuid(userId); uuid(id);
  const input = v.parse(playthroughUpdateSchema, raw);
  return getDb().transaction(async (tx) => {
    const current = await ownedPlaythrough(tx, userId, id);
    const status = input.status ?? current.status;
    const now = new Date();
    const [row] = await tx.update(gamePlaythroughs).set({
      ...input,
      startedAt: status === 'in-progress' ? current.startedAt ?? now : current.startedAt,
      completedAt: status === 'completed' ? current.completedAt ?? now : null,
      updatedAt: now,
    }).where(eq(gamePlaythroughs.id, id)).returning();
    await enqueueCollectionProjectionInTransaction(tx,userId);
    return row;
  });
}

export async function logGameSession(userId: string, id: string, raw: unknown) {
  uuid(userId); uuid(id);
  const input = v.parse(gameSessionInputSchema, raw);
  const playedAt = new Date(input.playedAt);
  return getDb().transaction(async (tx) => {
    const current = await ownedPlaythrough(tx, userId, id);
    // Check retries before lifecycle: completing the playthrough must not invalidate a retry.
    const [existing] = await tx.select().from(gameSessions).where(eq(gameSessions.id, input.id));
    if (existing) {
      if (existing.playthroughId !== id || existing.minutesPlayed !== input.minutesPlayed ||
        existing.playedAt.getTime() !== playedAt.getTime() || existing.note !== (input.note ?? null))
        throw new DomainError('This session ID is already in use.', 409, 'session_conflict');
      return existing;
    }
    if (!['planned', 'in-progress'].includes(current.status))
      throw new DomainError('Resume this playthrough or start another before logging play time.', 409, 'inactive_playthrough');
    const [session] = await tx.insert(gameSessions).values({ ...input, playedAt, playthroughId: id })
      .onConflictDoNothing().returning();
    if (!session) throw new DomainError('This session ID is already in use.', 409, 'session_conflict');
    await tx.update(gamePlaythroughs).set({
      status: 'in-progress',
      startedAt: !current.startedAt || playedAt < current.startedAt ? playedAt : current.startedAt,
      updatedAt: new Date(),
    }).where(eq(gamePlaythroughs.id, id));
    await enqueueCollectionProjectionInTransaction(tx,userId);
    return session;
  });
}

export async function playthroughDetails(userId: string, id: string, requestedPage = 1) {
  uuid(userId); uuid(id); v.parse(pageNumberSchema, requestedPage);
  const db = getDb();
  const [playthrough] = await db.select(playthroughFields).from(gamePlaythroughs)
    .where(and(eq(gamePlaythroughs.id, id), eq(gamePlaythroughs.userId, userId)));
  if (!playthrough) throw new DomainError('Playthrough not found.', 404, 'not_found');
  const [totals] = await db.select({ total: count() }).from(gameSessions).where(eq(gameSessions.playthroughId, id));
  const { page, pages } = pagination(totals.total, requestedPage);
  const sessions = await db.select().from(gameSessions).where(eq(gameSessions.playthroughId, id))
    .orderBy(desc(gameSessions.playedAt), desc(gameSessions.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
  return { ...playthrough, sessions, total: totals.total, page, pages };
}

/** Refresh provider-owned metadata while retaining the game's ID and all private playthroughs. */
export async function importIgdbMetadata(metadata: import('../../providers/igdb/adapter.server').IgdbGame) {
  const { category, provider, externalId, ...values } = metadata;
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`game:igdb:${externalId}`}, 0))`);
    const [identity] = await tx.select().from(gameExternalIds).where(and(
      eq(gameExternalIds.provider, provider), eq(gameExternalIds.externalId, externalId),
    ));
    let game: typeof games.$inferSelect;
    if (identity) {
      [game] = await tx.update(games).set({ ...values, updatedAt: new Date() })
        .where(eq(games.id, identity.gameId)).returning();
    } else {
      [game] = await tx.insert(games).values(values).returning();
      // A concurrent manual insert can claim this identity; roll the game insert back on conflict.
      const inserted = await tx.insert(gameExternalIds).values({ gameId: game.id, provider, externalId })
        .onConflictDoNothing().returning();
      if (!inserted.length) throw new DomainError('This game identity changed. Retry the import.', 409, 'identity_conflict');
    }
    return { ...game, category, identities: [{ provider, externalId }] };
  });
}
