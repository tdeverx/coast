import { requireFeature, requireFeatureInTransaction } from '#lib/server/features.js';
import { presentationPreferences, presentationSearch } from '#lib/catalogue/overrides/presentation.server.js';
import { and, asc, count, desc, eq, sql, getTableColumns } from 'drizzle-orm';
import * as v from 'valibot';
import { searchDocument, searchSql } from '../../server/queries/search-ranking';
import { rankSearch } from '../../search';
import { ownedGameAvailable } from '../../games/availability.server';
import { getDb, type Database } from '../../server/db';
import { games, gameExternalIds, gamePlaythroughs, gameSessions, gameVariants, workFeatures } from '../../server/db/schema';
import { PAGE_SIZE, pageNumberSchema, pagination, requestedPageInterval } from '../../server/queries/pagination';
import { DomainError } from '../errors';
import { trackInTransaction } from '../tracking/service.server';
import { enqueueCollectionProjectionInTransaction } from '../../sync/changes.server';
import { gameInputSchema, playthroughInputSchema, playthroughUpdateSchema, gameSessionInputSchema } from '../../games/model';

import { pageInterval } from '#lib/page-window.js';

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

/** A smaller projection hydrates only the head of the first unsearched 60-item page. */
export async function listGames(search = '', requestedPage = 1, tracking?: { userId: string; status?: import('../../games/model').GameStatus; personal?:boolean; availableOnly?:boolean }, projectionLimit = PAGE_SIZE, firstPage?: number) {
  const interval = requestedPageInterval(requestedPage, firstPage);
  const query = v.parse(v.pipe(v.string(), v.trim(), v.maxLength(250)), search);
  const limit = v.parse(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(PAGE_SIZE)), projectionLimit);
  if (limit < PAGE_SIZE && (requestedPage !== 1 || query || interval))
    throw new DomainError('Reduced game projections require the first unsearched page.', 400, 'invalid_projection');
  if(tracking)await requireFeature(tracking.userId,'game');
  if (tracking) {
    uuid(tracking.userId);
    if (tracking.status !== undefined) v.parse(v.picklist(['planned', 'in-progress', 'completed', 'paused', 'dropped']), tracking.status);
  }
  const aliases = presentationSearch(tracking?.userId ?? null, sql`${games.id}`, query);
  const searchQuery = query ? searchSql(query, [searchDocument(sql`${games.title}`)], [sql`${games.title}`]) : null;
  const buildWhere = (fallback = false) => and(searchQuery ? sql`(${fallback ? searchQuery.fallback : searchQuery.matches} or ${aliases.matches(fallback)})` : undefined,
    tracking && (tracking.personal !== false || tracking.status) ? (tracking.status
      ? sql`(select status from game_playthroughs where game_id = ${games.id} and user_id = ${tracking.userId} order by created_at desc, id desc limit 1) = ${tracking.status}`
      : sql`(exists(select 1 from game_playthroughs where game_id = ${games.id} and user_id = ${tracking.userId}) or exists(select 1 from tracking_state where media_id=${games.id} and user_id=${tracking.userId} and (collected or watchlist or favourite)))`) : undefined,
    tracking?.availableOnly ? ownedGameAvailable(tracking.userId) : undefined);
  const db = getDb();
  let where = buildWhere();
  let [totals] = await db.select({ total: count() }).from(games).where(where);
  if (!totals.total && searchQuery) { where = buildWhere(true); [totals] = await db.select({ total: count() }).from(games).where(where); }
  const { page, pages } = pagination(totals.total, requestedPage);
  const bounds = pageInterval(pages, page, interval?.firstPage);
  const items = await db.select({...getTableColumns(games),available:tracking?ownedGameAvailable(tracking.userId):sql<boolean>`false`}).from(games).where(where).orderBy(...(searchQuery ? [desc(sql`greatest(${searchQuery.rank},${aliases.rank})`)] : []), asc(games.title), asc(games.id))
    .limit(interval ? (page - bounds.firstPage + 1) * PAGE_SIZE : limit).offset((bounds.firstPage - 1) * PAGE_SIZE);
  // Ranking and preference hydration retain each native page's original semantics.
  const presented = [], counts: number[] = [];
  for (let number = bounds.firstPage; number <= page; number++) {
    const selected = items.slice((number - bounds.firstPage) * PAGE_SIZE, (number - bounds.firstPage + 1) * PAGE_SIZE);
    const presentation = await gamePresentationMetadata(selected.map(item=>item.id),selected,tracking?.userId ?? null);
    const cards = rankSearch(selected.map(item=>({...item,...presentation.get(item.id),category:'game' as const})),query);
    presented.push(...cards); counts.push(cards.length);
  }
  return { items: presented, total: totals.total, page, pages, ...(interval ? { range: { ...bounds, counts } } : {}) };
}

export async function gameDetails(userId: string | null, gameId: string) {
  if(userId)await requireFeature(userId,'game');
  if(userId)uuid(userId); uuid(gameId);
  const db = getDb();
  const [game] = await db.select({...getTableColumns(games),available:userId?ownedGameAvailable(userId):sql<boolean>`false`}).from(games).where(eq(games.id, gameId));
  if (!game) throw new DomainError('Game not found.', 404, 'not_found');
  const identities = await db.select({ provider: gameExternalIds.provider, externalId: gameExternalIds.externalId })
    .from(gameExternalIds).where(eq(gameExternalIds.gameId, gameId));
  const playthroughs = userId ? await db.select(playthroughFields).from(gamePlaythroughs)
    .where(and(eq(gamePlaythroughs.userId, userId), eq(gamePlaythroughs.gameId, gameId)))
    .orderBy(desc(gamePlaythroughs.createdAt), desc(gamePlaythroughs.id)).limit(PAGE_SIZE) : [];
  const steam = userId ? await db.execute<{username:string;owned:boolean;minutes_played:number;recent_minutes:number;observed_at:Date;achievements_at:Date|null;unlocked:number;total:number}>(sql`
    select c.username,a.owned,a.minutes_played,a.recent_minutes,a.observed_at,a.achievements_at,
      (select count(*)::int from game_achievement_progress p join game_achievements g on g.id=p.achievement_id where p.account_id=a.account_id and g.game_id=a.game_id and g.app_id=any(a.achievement_apps) and p.unlocked) as unlocked,
      (select count(*)::int from game_achievements g where g.game_id=a.game_id and g.provider='steam' and g.app_id=any(a.achievement_apps)) as total
    from (select account_id,game_id,bool_or(owned) as owned,
      sum(minutes_played)::integer as minutes_played,
      sum(recent_minutes)::integer as recent_minutes,
      max(observed_at) as observed_at,max(achievements_at) as achievements_at,
      array_agg(app_id) as achievement_apps
      from game_account_state where game_id=${gameId} group by account_id,game_id) a
    join provider_connections c on c.sync_account_id=a.account_id join provider_instances i on i.id=c.instance_id
    where c.user_id=${userId} and c.status='connected' and i.provider='steam' and i.enabled and a.game_id=${gameId}`) : [];
  const enriched=(await gamePresentationMetadata([gameId],[game],userId)).get(gameId)??game;
  return { ...enriched, steam: Array.from(steam), category: 'game' as const, identities, playthroughs };
}

export async function createPlaythrough(userId: string, gameId: string, raw: unknown, transaction?: Transaction) {
  uuid(userId); uuid(gameId);
  const input = v.parse(playthroughInputSchema, raw);
  const apply=async(tx:Transaction)=>{
    await requireFeatureInTransaction(tx,userId,'game');
    const [game] = await tx.select({ id: games.id }).from(games).where(eq(games.id, gameId));
    if (!game) throw new DomainError('Game not found.', 404, 'not_found');
    const [row] = await tx.insert(gamePlaythroughs).values({ userId, gameId, ...input, startedAt: input.status === 'in-progress' ? new Date() : null }).returning();
    if(input.status==='planned')await trackInTransaction(tx,userId,{mediaId:gameId,action:'watchlist',value:true});
    await enqueueCollectionProjectionInTransaction(tx,userId);
    await (await import('#lib/server/public-api/webhooks.server.js')).emitWebhook(tx,userId,'game.changed',{workId:gameId,playthroughId:row.id,action:'created',status:row.status});
    return { ...row, minutesPlayed: 0 };
  };
  return transaction?apply(transaction):getDb().transaction(apply);
}

async function ownedPlaythrough(tx: Transaction, userId: string, id: string) {
  await requireFeatureInTransaction(tx,userId,'game');
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
    const startedAt = status === 'in-progress' ? current.startedAt ?? now : current.startedAt;
    const completedAt = status === 'completed' ? current.completedAt ?? now : null;
    if (status === current.status && (input.progressPercent ?? current.progressPercent) === current.progressPercent &&
      startedAt === current.startedAt && completedAt === current.completedAt) return current;
    const [row] = await tx.update(gamePlaythroughs).set({
      ...input,
      startedAt,
      completedAt,
      updatedAt: now,
    }).where(eq(gamePlaythroughs.id, id)).returning();
    await enqueueCollectionProjectionInTransaction(tx,userId);
    await (await import('#lib/server/public-api/webhooks.server.js')).emitWebhook(tx,userId,'game.changed',{workId:current.gameId,playthroughId:id,action:'updated',status:row.status,progressPercent:row.progressPercent});
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
    await (await import('#lib/server/public-api/webhooks.server.js')).emitWebhook(tx,userId,'game.changed',{workId:current.gameId,playthroughId:id,sessionId:session.id,action:'session',minutesPlayed:session.minutesPlayed,playedAt:session.playedAt.toISOString()});
    return session;
  };
  return transaction?apply(transaction):getDb().transaction(apply);
}

export async function playthroughSummary(userId:string,id:string){
  uuid(userId);uuid(id);await requireFeature(userId,'game');const db=getDb();
  const [playthrough]=await db.select(playthroughFields).from(gamePlaythroughs).where(and(eq(gamePlaythroughs.id,id),eq(gamePlaythroughs.userId,userId)));
  if(!playthrough)throw new DomainError('Playthrough not found.',404,'not_found');
  const [totals]=await db.select({total:count()}).from(gameSessions).where(eq(gameSessions.playthroughId,id));
  return {...playthrough,total:totals.total};
}
export async function playthroughDetails(userId:string,id:string,requestedPage=1){
  v.parse(pageNumberSchema,requestedPage);const playthrough=await playthroughSummary(userId,id),db=getDb();
  const {page,pages}=pagination(playthrough.total,requestedPage);
  const sessions=await db.select().from(gameSessions).where(eq(gameSessions.playthroughId,id))
    .orderBy(desc(gameSessions.playedAt),desc(gameSessions.id)).limit(PAGE_SIZE).offset((page-1)*PAGE_SIZE);
  return {...playthrough,sessions,page,pages};
}

/** Refresh provider-owned metadata while retaining the game's ID and all private playthroughs. */
export async function importIgdbMetadata(metadata: import('../../providers/igdb/adapter.server').IgdbGame, parentKnown=true) {
  const { category, provider, externalId, identities: linked = [], parent,tasteFeatures,...values } = metadata;
  // Embedded parent fields omit the parent's own parent relation. Only a full
  // root observation may revoke that work's previous verified relationship.
  const parentGame=parent?await importIgdbMetadata(parent,false):null;
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
    if(parentGame&&parentGame.id!==game.id)await tx.insert(gameVariants).values({gameId:game.id,parentId:parentGame.id,provider}).onConflictDoUpdate({target:gameVariants.gameId,set:{parentId:parentGame.id,provider,updatedAt:new Date()},setWhere:sql`(${gameVariants.parentId},${gameVariants.provider}) is distinct from (excluded.parent_id,excluded.provider)`});
    else if(parentKnown)await tx.delete(gameVariants).where(and(eq(gameVariants.gameId,game.id),eq(gameVariants.provider,provider)));
    return { ...game, category, identities };
  });
}

/** Borrow only presentation fields from a verified main game; retain the variant's identity/title. */
export async function gamePresentationMetadata(ids:string[],records?:typeof games.$inferSelect[],viewerId:string|null=null){
  if(!ids.length)return new Map<string,typeof games.$inferSelect>();
  const db=getDb(),rows=records??await db.select().from(games).where(sql`${games.id} in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`);
  if(!rows.length)return new Map<string,typeof games.$inferSelect>();
  const parents=await db.select({gameId:gameVariants.gameId,parent:games}).from(gameVariants).innerJoin(games,eq(games.id,gameVariants.parentId)).where(sql`${gameVariants.gameId} in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`);
  const preferences=await presentationPreferences(viewerId,ids);
  const byGame=new Map(parents.map(row=>[row.gameId,row.parent]));
  return new Map(rows.map(game=>{const parent=byGame.get(game.id);const result=parent?{...game,posterPath:parent.posterPath??game.posterPath,backdropPath:parent.backdropPath??game.backdropPath,overview:parent.overview??game.overview,genres:parent.genres.length?parent.genres:game.genres,developers:parent.developers.length?parent.developers:game.developers,publishers:parent.publishers.length?parent.publishers:game.publishers}:game;const preference=preferences.get(game.id);return [game.id,preference?{...result,title:preference.title??result.title,posterPath:preference.posterPath??result.posterPath,backdropPath:preference.backdropPath??result.backdropPath}:result];}));
}
