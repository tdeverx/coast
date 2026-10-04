import { and, asc, count, desc, eq, ilike, sql, getTableColumns } from 'drizzle-orm';
import * as v from 'valibot';
import { ownedGameAvailable } from '../../games/availability.server';
import { getDb, type Database } from '../../server/db';
import { games, gameExternalIds, gamePlaythroughs, gameSessions, gameVariants, workFeatures } from '../../server/db/schema';
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

export async function listGames(search = '', requestedPage = 1, tracking?: { userId: string; status?: import('../../games/model').GameStatus; personal?:boolean; availableOnly?:boolean }) {
  v.parse(pageNumberSchema, requestedPage);
  const query = v.parse(v.pipe(v.string(), v.trim(), v.maxLength(250)), search);
  if (tracking) {
    uuid(tracking.userId);
    if (tracking.status !== undefined) v.parse(v.picklist(['planned', 'in-progress', 'completed', 'paused', 'dropped']), tracking.status);
  }
  const where = and(query ? ilike(games.title, `%${query.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
    tracking && (tracking.personal !== false || tracking.status) ? (tracking.status
      ? sql`(select status from game_playthroughs where game_id = ${games.id} and user_id = ${tracking.userId} order by created_at desc, id desc limit 1) = ${tracking.status}`
      : sql`(exists(select 1 from game_playthroughs where game_id = ${games.id} and user_id = ${tracking.userId}) or exists(select 1 from tracking_state where media_id=${games.id} and user_id=${tracking.userId} and (collected or watchlist or favourite)))`) : undefined,
    tracking?.availableOnly ? ownedGameAvailable(tracking.userId) : undefined);
  const db = getDb();
  const [totals] = await db.select({ total: count() }).from(games).where(where);
  const { page, pages } = pagination(totals.total, requestedPage);
  const items = await db.select({...getTableColumns(games),available:tracking?ownedGameAvailable(tracking.userId):sql<boolean>`false`}).from(games).where(where).orderBy(asc(games.title), asc(games.id))
    .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
  const presentation=await gamePresentationMetadata(items.map(item=>item.id),items);
  return { items: items.map((item) => ({ ...item,...presentation.get(item.id),category: 'game' as const })), total: totals.total, page, pages };
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
  const steam = userId ? await db.execute<{username:string;owned:boolean;minutes_played:number;recent_minutes:number;observed_at:Date;achievements_at:Date|null;unlocked:number;total:number}>(sql`
    select c.username,a.owned,a.minutes_played,a.recent_minutes,a.observed_at,a.achievements_at,
      (select count(*)::int from game_achievement_progress p join game_achievements g on g.id=p.achievement_id where p.account_id=a.account_id and g.game_id=a.game_id and p.unlocked) as unlocked,
      (select count(*)::int from game_achievements g where g.game_id=a.game_id and g.provider='steam') as total
    from game_account_state a join provider_connections c on c.sync_account_id=a.account_id join provider_instances i on i.id=c.instance_id
    where c.user_id=${userId} and c.status='connected' and i.provider='steam' and i.enabled and a.game_id=${gameId}`) : [];
  const enriched=(await gamePresentationMetadata([gameId],[game])).get(gameId)??game;
  return { ...enriched, steam: Array.from(steam), category: 'game' as const, identities, playthroughs };
}

export async function createPlaythrough(userId: string, gameId: string, raw: unknown, transaction?: Transaction) {
  uuid(userId); uuid(gameId);
  const input = v.parse(playthroughInputSchema, raw);
  const apply=async(tx:Transaction)=>{
    const [game] = await tx.select({ id: games.id }).from(games).where(eq(games.id, gameId));
    if (!game) throw new DomainError('Game not found.', 404, 'not_found');
    const [row] = await tx.insert(gamePlaythroughs).values({ userId, gameId, ...input, startedAt: input.status === 'in-progress' ? new Date() : null }).returning();
    if(input.status==='planned')await trackInTransaction(tx,userId,{mediaId:gameId,action:'watchlist',value:true});
    await enqueueCollectionProjectionInTransaction(tx,userId);
    await (await import('$lib/server/public-api/webhooks.server')).emitWebhook(tx,userId,'game.changed',{workId:gameId,playthroughId:row.id,action:'created',status:row.status});
    return { ...row, minutesPlayed: 0 };
  };
  return transaction?apply(transaction):getDb().transaction(apply);
}

async function ownedPlaythrough(tx: Transaction, userId: string, id: string) {
  const [row] = await tx.select().from(gamePlaythroughs)
    .where(and(eq(gamePlaythroughs.id, id), eq(gamePlaythroughs.userId, userId))).for('update');
  if (!row) throw new DomainError('Playthrough not found.', 404, 'not_found');
  return row;
}

export async function updatePlaythrough(userId: string, id: string, raw: unknown, transaction?: Transaction) {
  uuid(userId); uuid(id);
  const input = v.parse(playthroughUpdateSchema, raw);
  const apply=async(tx:Transaction)=>{
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
    await (await import('$lib/server/public-api/webhooks.server')).emitWebhook(tx,userId,'game.changed',{workId:current.gameId,playthroughId:id,action:'updated',status:row.status,progressPercent:row.progressPercent});
    return row;
  };
  return transaction?apply(transaction):getDb().transaction(apply);
}

export async function logGameSession(userId: string, id: string, raw: unknown, transaction?: Transaction) {
  uuid(userId); uuid(id);
  const input = v.parse(gameSessionInputSchema, raw);
  const playedAt = new Date(input.playedAt);
  const apply=async(tx:Transaction)=>{
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
    await (await import('$lib/server/public-api/webhooks.server')).emitWebhook(tx,userId,'game.changed',{workId:current.gameId,playthroughId:id,sessionId:session.id,action:'session',minutesPlayed:session.minutesPlayed,playedAt:session.playedAt.toISOString()});
    return session;
  };
  return transaction?apply(transaction):getDb().transaction(apply);
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
  const { category, provider, externalId, identities: linked = [], parent,tasteFeatures,...values } = metadata;
  const parentGame=parent?await importIgdbMetadata(parent):null;
  const identities=[{provider,externalId},...linked];
  return getDb().transaction(async (tx) => {
    for(const key of identities.map(i=>`game:${i.provider}:${i.externalId}`).sort())
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const known = await tx.select().from(gameExternalIds).where(sql`(${sql.join(identities.map(i=>sql`(provider=${i.provider} and external_id=${i.externalId})`),sql` or `)})`);
    if(new Set(known.map(i=>i.gameId)).size>1)throw new DomainError('Verified game identities refer to different records. Review the mapping.',409,'identity_conflict');
    const identity=known[0];
    let game: typeof games.$inferSelect;
    if (identity) {
      [game] = await tx.update(games).set({ ...values, updatedAt: new Date() })
        .where(eq(games.id, identity.gameId)).returning();
    } else {
      [game] = await tx.insert(games).values(values).returning();
    }
    for (const id of identities) {
      await tx.insert(gameExternalIds).values({gameId:game.id,...id}).onConflictDoNothing();
      const [saved]=await tx.select().from(gameExternalIds).where(and(eq(gameExternalIds.provider,id.provider),eq(gameExternalIds.externalId,id.externalId)));
      if(saved.gameId!==game.id)throw new DomainError('This game identity changed. Retry the import.',409,'identity_conflict');
    }
    await tx.insert(workFeatures).values({workId:game.id,provider,features:tasteFeatures}).onConflictDoUpdate({target:[workFeatures.workId,workFeatures.provider],set:{features:tasteFeatures,updatedAt:new Date()}});
    if(parentGame&&parentGame.id!==game.id)await tx.insert(gameVariants).values({gameId:game.id,parentId:parentGame.id,provider}).onConflictDoUpdate({target:gameVariants.gameId,set:{parentId:parentGame.id,provider,updatedAt:new Date()}});
    return { ...game, category, identities };
  });
}

/** Borrow only presentation fields from a verified main game; retain the variant's identity/title. */
export async function gamePresentationMetadata(ids:string[],records?:typeof games.$inferSelect[]){
  if(!ids.length)return new Map<string,typeof games.$inferSelect>();
  const db=getDb(),rows=records??await db.select().from(games).where(sql`${games.id} in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`);
  if(!rows.length)return new Map<string,typeof games.$inferSelect>();
  const parents=await db.select({gameId:gameVariants.gameId,parent:games}).from(gameVariants).innerJoin(games,eq(games.id,gameVariants.parentId)).where(sql`${gameVariants.gameId} in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`);
  const byGame=new Map(parents.map(row=>[row.gameId,row.parent]));
  return new Map(rows.map(game=>{const parent=byGame.get(game.id);return [game.id,parent?{...game,posterPath:parent.posterPath??game.posterPath,backdropPath:parent.backdropPath??game.backdropPath,overview:parent.overview??game.overview,genres:parent.genres.length?parent.genres:game.genres,developers:parent.developers.length?parent.developers:game.developers,publishers:parent.publishers.length?parent.publishers:game.publishers}:game];}));
}
