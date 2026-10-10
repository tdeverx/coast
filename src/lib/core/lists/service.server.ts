import { and, asc, desc, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb, type Database } from '../../server/db';
import { listItems, lists, media, works, games, musicWorks, readingWorks } from '../../server/db/schema';
import { DomainError } from '../errors';
import { enqueueCollectionProjectionInTransaction } from '../../sync/changes.server';

const uuidSchema = v.pipe(v.string(), v.uuid());
export const listInputSchema = v.object({
  playlist: v.optional(v.boolean()),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  description: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2000)))),
});
const createListInputSchema = v.object({
  ...listInputSchema.entries,
  mediaId: v.optional(uuidSchema),
});
const moveListItemInputSchema = v.object({
  entryId: uuidSchema,
  direction: v.union([v.literal(-1), v.literal(1)]),
});
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
async function ownedList(tx: Transaction, userId: string, listId: string) {
  v.parse(uuidSchema, userId);
  v.parse(uuidSchema, listId);
  const [list] = await tx
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .for('update');
  if (!list) throw new DomainError('This list was not found.', 404, 'not_found');
  return list;
}
export async function createList(userId: string, raw: v.InferInput<typeof createListInputSchema>) {
  v.parse(uuidSchema, userId);
  const { mediaId, ...input } = v.parse(createListInputSchema, raw);
  return getDb().transaction(async (tx) => {
    if (mediaId) {
      const [item] = await tx.select({ id: works.id }).from(works).where(eq(works.id, mediaId));
      if (!item) throw new DomainError('This title was not found.', 404, 'not_found');
    }
    const [list] = await tx
      .insert(lists)
      .values({ userId, ...input })
      .returning();
    if (mediaId) await tx.insert(listItems).values({ listId: list.id, mediaId, position: 0 });
    await enqueueCollectionProjectionInTransaction(tx,userId);
    return list;
  });
}
export async function updateList(
  userId: string,
  listId: string,
  raw: v.InferInput<typeof listInputSchema>
) {
  const input = v.parse(listInputSchema, raw);
  return getDb().transaction(async (tx) => {
    const existing = await ownedList(tx, userId, listId);
    if (input.playlist !== undefined && input.playlist !== existing.playlist)
      throw new DomainError('Create a new playlist to change list type.');
    const [list] = await tx
      .update(lists)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(lists.id, listId))
      .returning();
    return list;
  });
}
export async function deleteList(userId: string, listId: string) {
  return getDb().transaction(async (tx) => {
    await ownedList(tx, userId, listId);
    await tx.delete(lists).where(eq(lists.id, listId));
    await enqueueCollectionProjectionInTransaction(tx,userId);
  });
}
export async function getLists(userId: string) {
  v.parse(uuidSchema, userId);
  return getDb()
    .select({
      id: lists.id,
      name: lists.name,
      description: lists.description,
      source: lists.source,
      playlist: lists.playlist,
      createdAt: lists.createdAt,
      updatedAt: lists.updatedAt,
      itemCount: sql<number>`count(${listItems.mediaId})::int`,
    })
    .from(lists)
    .leftJoin(listItems, eq(listItems.listId, lists.id))
    .where(eq(lists.userId, userId))
    .groupBy(lists.id)
    .orderBy(asc(lists.name));
}
export async function getList(userId: string, listId: string) {
  v.parse(uuidSchema, userId);
  v.parse(uuidSchema, listId);
  const [list] = await getDb()
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)));
  if (!list) throw new DomainError('This list was not found.', 404, 'not_found');
  const items = await getDb()
    .select({
      entryId: listItems.id,
      item: works,
      screen: media,
      title: sql<string>`coalesce(${media.title},${games.title},${musicWorks.title},${readingWorks.title})`,
      position: listItems.position,
      addedAt: listItems.addedAt,
    })
    .from(listItems)
    .innerJoin(works, eq(works.id, listItems.mediaId))
    .leftJoin(media, eq(media.id, works.id))
    .leftJoin(games, eq(games.id, works.id))
    .leftJoin(musicWorks, eq(musicWorks.id, works.id))
    .leftJoin(readingWorks, eq(readingWorks.id, works.id))
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.position), asc(listItems.addedAt));
  return { ...list, items: items.map(({screen,title,...entry})=>({...entry,item:screen??{...entry.item,title}})) };
}
export async function addListItem(
  userId: string,
  listId: string,
  mediaId: string,
  restorePosition?: number
) {
  v.parse(uuidSchema, mediaId);
  if (restorePosition !== undefined)
    v.parse(v.pipe(v.number(), v.integer(), v.minValue(0)), restorePosition);
  return getDb().transaction(async (tx) => {
    const list = await ownedList(tx, userId, listId);
    if (!list.playlist) {
      const [existing] = await tx
        .select()
        .from(listItems)
        .where(and(eq(listItems.listId, listId), eq(listItems.mediaId, mediaId)));
      if (existing) return { entryId: existing.id, added: false };
    }
    const [item] = await tx.select({ id: works.id, category: works.category }).from(works).where(eq(works.id, mediaId));
    if (!item) throw new DomainError('This title was not found.', 404, 'not_found');
    if (list.playlist && (item.category === 'book' || item.category === 'comic'))
      throw new DomainError('Reading works cannot be added to a playback playlist.');
    const [maximum] = await tx
      .select({ position: sql<number>`coalesce(max(${listItems.position}), -1)::int` })
      .from(listItems)
      .where(eq(listItems.listId, listId));
    const position =
      !list.playlist && restorePosition !== undefined
        ? Math.min(restorePosition, maximum.position + 1)
        : maximum.position + 1;
    if (position <= maximum.position)
      await tx
        .update(listItems)
        .set({ position: sql`${listItems.position} + 1` })
        .where(and(eq(listItems.listId, listId), sql`${listItems.position} >= ${position}`));
    const [entry] = await tx
      .insert(listItems)
      .values({ listId, mediaId, position })
      .returning({ id: listItems.id });
    await tx.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, listId));
    await enqueueCollectionProjectionInTransaction(tx,userId);
    return { entryId: entry.id, added: true };
  });
}
export async function removeListItem(userId: string, listId: string, entryId: string) {
  v.parse(uuidSchema, entryId);
  return getDb().transaction(async (tx) => {
    await ownedList(tx, userId, listId);
    await tx.delete(listItems).where(and(eq(listItems.listId, listId), eq(listItems.id, entryId)));
    const items = await tx
      .select()
      .from(listItems)
      .where(eq(listItems.listId, listId))
      .orderBy(asc(listItems.position));
    for (const [position, item] of items.entries())
      await tx
        .update(listItems)
        .set({ position })
        .where(and(eq(listItems.listId, listId), eq(listItems.id, item.id)));
    await tx.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, listId));
    await enqueueCollectionProjectionInTransaction(tx,userId);
  });
}
/** A reorder is an exact permutation, preventing hidden item deletion or cross-list insertion. */
export function isExactPermutation(existing: string[], proposed: string[]) {
  const existingIds = new Set(existing);
  return (
    existing.length === proposed.length &&
    new Set(proposed).size === proposed.length &&
    proposed.every((id) => existingIds.has(id))
  );
}
export async function reorderList(userId: string, listId: string, raw: string[]) {
  const entryIds = v.parse(v.pipe(v.array(uuidSchema), v.maxLength(10000)), raw);
  return getDb().transaction(async (tx) => {
    await ownedList(tx, userId, listId);
    const existing = await tx
      .select({ id: listItems.id })
      .from(listItems)
      .where(eq(listItems.listId, listId));
    if (
      !isExactPermutation(
        existing.map((item) => item.id),
        entryIds
      )
    )
      throw new DomainError(
        'Reordering must include every list item exactly once. Reload the list and try again.',
        409,
        'list_changed'
      );
    for (const [position, entryId] of entryIds.entries())
      await tx
        .update(listItems)
        .set({ position })
        .where(and(eq(listItems.listId, listId), eq(listItems.id, entryId)));
    await tx.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, listId));
  });
}

/** Move against the complete server-side order, including a neighbour on another page. */
export async function moveListItem(userId: string, listId: string, raw: unknown) {
  const input = v.parse(moveListItemInputSchema, raw);
  return getDb().transaction(async (tx) => {
    await ownedList(tx, userId, listId);
    const [current] = await tx
      .select()
      .from(listItems)
      .where(and(eq(listItems.listId, listId), eq(listItems.id, input.entryId)));
    if (!current) throw new DomainError('This list item was not found.', 404, 'not_found');
    const [neighbour] = await tx
      .select()
      .from(listItems)
      .where(
        and(
          eq(listItems.listId, listId),
          input.direction === -1
            ? sql`${listItems.position} < ${current.position}`
            : sql`${listItems.position} > ${current.position}`
        )
      )
      .orderBy(input.direction === -1 ? desc(listItems.position) : asc(listItems.position))
      .limit(1);
    if (!neighbour) return;
    await tx
      .update(listItems)
      .set({
        position: sql`case when ${listItems.id} = ${current.id} then ${neighbour.position} else ${current.position} end`,
      })
      .where(
        and(eq(listItems.listId, listId), sql`${listItems.id} in (${current.id}, ${neighbour.id})`)
      );
    await tx.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, listId));
  });
}
