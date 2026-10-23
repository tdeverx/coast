import {librarySegmentCondition} from '#lib/server/queries/library-segments.js';
import {librarySortValues,librarySegmentValues} from '#lib/library.js';
import {libraryOrder} from '#lib/server/queries/library-order.js';
import { categoryEnabled } from '#lib/experimental.js';
import { getFeatureConfig } from '#lib/server/features.js';
import { presentationPreferences, personaliseWorkCards, presentationSearch } from '#lib/catalogue/overrides/presentation.server.js';
import { and, count, desc, eq, or, sql, getTableColumns } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '#lib/server/db/index.js';
import { ratings, readingProgress, readingWorks, workIdentifiers, trackingState } from '#lib/server/db/schema.js';
import { DomainError } from '#lib/core/errors.js';
import { PAGE_SIZE, pageNumberSchema, pagination, requestedPageInterval } from '#lib/server/queries/pagination.js';
import { getConfig } from '#lib/server/config.js';
import { enabledCategories, requireEnabledCategory } from '#lib/server/experimental.js';
import type { ReadingMetadata } from './model';
import { readingStates, readingReferenceSchema, readingProviderForId, type ReadingKind } from './model';
import { readingCard,type ReadingDetailData } from './presentation';
import {readingProviderDetails} from '#lib/providers/reading.server.js';
import { searchDocument, searchSql } from '#lib/server/queries/search-ranking.js';

import { pageInterval } from '#lib/page-window.js';

const uuid = v.pipe(v.string(), v.uuid());
/** Resolve exact identity before fetching a preview; saved metadata survives source outages. */
export async function readingStoredWorkId(kind: ReadingKind, externalId: string) {
  v.parse(readingReferenceSchema, { kind, externalId });
  const config = await getConfig();
  requireEnabledCategory(config, 'reading');
  const [item] = await getDb().select({ id: readingWorks.id, kind: readingWorks.kind }).from(workIdentifiers)
    .innerJoin(readingWorks, eq(readingWorks.id, workIdentifiers.workId)).where(and(
      sql`${workIdentifiers.kind} in ('book','comic')`, eq(workIdentifiers.provider, readingProviderForId(externalId)),
      eq(workIdentifiers.externalId, externalId),
    )).limit(1);
  if (item) requireEnabledCategory(config, item.kind);
  return item?.id;
}
export const readingCatalogueSchema = v.object({
  segment:v.optional(v.picklist(librarySegmentValues),'all'),
  sort:v.optional(v.picklist(librarySortValues),'default'),
  kind: v.optional(v.picklist(['all', 'book', 'comic']), 'all'),
  search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(250)), ''),
  page: v.optional(pageNumberSchema, 1),
  state: v.optional(v.picklist(['all', ...readingStates]), 'all'),
  available: v.optional(v.boolean(),false),
  personal: v.optional(v.boolean(), true),
});

export async function readingWork(userId: string, id: string) {
  v.parse(uuid, userId); v.parse(uuid, id);
  const db = getDb();
  const [item] = await db.select({...getTableColumns(readingWorks),
    available:sql<boolean>`exists(select 1 from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id where a.media_id=${id}::uuid and a.user_id=${userId}::uuid and a.state='available' and c.status='connected' and i.enabled)`,
    hasEditions:sql<boolean>`exists(select 1 from work_identifiers wi where wi.work_id=${id}::uuid and wi.provider='openlibrary')`,
  }).from(readingWorks).where(eq(readingWorks.id,id));
  if (!item) throw new DomainError('Reading work not found.', 404, 'not_found');
  requireEnabledCategory(await getFeatureConfig(userId), item.kind);
  return item;
}

export async function readingDetails(userId:string,id:string){
  const item=await readingWork(userId,id),db=getDb();
  const [[progress], [relationships], [rating]] = await Promise.all([
    db.select().from(readingProgress).where(and(eq(readingProgress.userId, userId), eq(readingProgress.workId, id))),
    db.select({ favourite: trackingState.favourite, watchlist: trackingState.watchlist, collected: trackingState.collected }).from(trackingState).where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, id))),
    db.select({ value: ratings.value }).from(ratings).where(and(eq(ratings.userId, userId), eq(ratings.mediaId, id))),
  ]);
  const preference=(await presentationPreferences(userId,[id])).get(id);
  const presented=preference?{...item,title:preference.title??item.title,coverUrl:preference.posterPath??item.coverUrl,
    ...(preference.backdropPath ? {backdropUrl:preference.backdropPath} : {})}:item;
  return { item:presented, progress: progress ?? null, relationships: relationships ?? { favourite: false, watchlist: false, collected: false }, rating: rating?.value ?? null };
}

/** Personal membership and state filters precede both counts and the bounded page read. */
export async function readingCatalogue(userId: string, raw: unknown = {}, firstPage?: number) {
  v.parse(uuid, userId);
  const input = v.parse(readingCatalogueSchema, raw);
  const interval = requestedPageInterval(input.page, firstPage);
  const config = await getFeatureConfig(userId);
  requireEnabledCategory(config, 'reading');
  if (input.kind !== 'all') requireEnabledCategory(config, input.kind);
  const aliases = presentationSearch(userId,sql`${readingWorks.id}`,input.search);
  const search = input.search ? searchSql(input.search, [searchDocument(sql`${readingWorks.title}`, sql`${readingWorks.seriesTitle}`, sql`${readingWorks.authors}`)], [sql`${readingWorks.title}`, sql`${readingWorks.seriesTitle}`]) : null;
  const personal = sql`exists(select 1 from reading_progress p where p.work_id=${readingWorks.id} and p.user_id=${userId})
    or exists(select 1 from tracking_state t where t.media_id=${readingWorks.id} and t.user_id=${userId} and (t.collected or t.watchlist or t.favourite))
    or exists(select 1 from ratings r where r.media_id=${readingWorks.id} and r.user_id=${userId})
    or exists(select 1 from list_items li join lists l on l.id=li.list_id where li.media_id=${readingWorks.id} and l.user_id=${userId})
    or exists(select 1 from up_next n where n.media_id=${readingWorks.id} and n.user_id=${userId})`;
  const segment=await librarySegmentCondition(userId,userId,input.segment,readingWorks.id,'reading');
  const buildWhere = (fallback = false) => and(
    segment,
    enabledCategories(sql`${readingWorks.kind}`, config),
    input.available?sql`exists(select 1 from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id where a.media_id=${readingWorks.id} and a.user_id=${userId} and a.state='available' and c.status='connected' and i.enabled)`:undefined,
    input.kind === 'all' ? undefined : eq(readingWorks.kind, input.kind),
    search ? sql`(${fallback ? search.fallback : search.matches} or ${aliases.matches(fallback)})` : undefined,
    input.personal ? sql`(${personal})` : undefined,
    input.state === 'all' ? undefined : sql`exists(select 1 from reading_progress p where p.work_id=${readingWorks.id} and p.user_id=${userId} and p.state=${input.state})`,
  );
  const db = getDb();
  let where = buildWhere();
  let [totals] = await db.select({ total: count() }).from(readingWorks).where(where);
  if (!totals.total && search) { where = buildWhere(true); [totals] = await db.select({ total: count() }).from(readingWorks).where(where); }
  const { page, pages } = pagination(totals.total, input.page);
  const bounds = pageInterval(pages, page, interval?.firstPage);
  const items = await db.select().from(readingWorks).where(where).orderBy(...(search ? [desc(sql`greatest(${search.rank},${aliases.rank})`)] : []), libraryOrder(input.sort,{title:readingWorks.title,added:readingWorks.createdAt,id:readingWorks.id},sql`${readingWorks.title} asc, ${readingWorks.id} asc`)).limit((page - bounds.firstPage + 1) * PAGE_SIZE).offset((bounds.firstPage - 1) * PAGE_SIZE);
  // SQL has ranked both canonical metadata and the viewer's private aliases
  // before paging. Rescoring raw titles here would demote alias-only matches.
  return { items, total: totals.total, page, pages, ...(interval ? { range: { ...bounds, counts: Array.from({length:page-bounds.firstPage+1}, (_,index)=>items.slice(index*PAGE_SIZE,(index+1)*PAGE_SIZE).length) } } : {}) };
}

/** Hydrate private page progress for only the selected card page, respecting the actual category. */
export async function readingCards(ownerId: string, viewerId: string | null, items: typeof readingWorks.$inferSelect[]) {
  if (!items.length) return [];
  const progress = await getDb().select({ progress: readingProgress }).from(readingProgress)
    .innerJoin(readingWorks, eq(readingWorks.id, readingProgress.workId))
    .where(sql`${readingProgress.userId}=${ownerId} and ${readingProgress.workId} in (${sql.join(items.map(item => sql`${item.id}::uuid`), sql`,`)})
      and social_visible(${ownerId}::uuid,${viewerId}::uuid,'progress',${readingWorks.kind})`)
    .limit(PAGE_SIZE);
  const available=await getDb().execute<{id:string}>(sql`select distinct a.media_id as id from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id where a.media_id in (${sql.join(items.map(item=>sql`${item.id}::uuid`),sql`,`)}) and a.user_id=${viewerId} and a.state='available' and c.status='connected' and i.enabled`);
  const accessible=new Set(Array.from(available).map(row=>row.id));
  const byId = new Map(progress.map(row => [row.progress.workId, row.progress]));
  return personaliseWorkCards(viewerId,items.map(item => ({...readingCard(item, undefined, byId.get(item.id)),available:accessible.has(item.id)})));
}

/** Resolve a bounded provider page in one query, then hydrate only its canonical matches. */
export async function readingProviderCards(userId: string, metadata: ReadingMetadata[]) {
  if (!metadata.length) return [];
  if (metadata.length > PAGE_SIZE) throw new DomainError('Too many reading results.', 400, 'invalid_input');
  const config = await getFeatureConfig(userId);
  metadata = metadata.filter(item => categoryEnabled(config, item.kind));
  if (!metadata.length) return [];
  const identities = metadata.flatMap(item => [{ provider: item.provider, externalId: item.externalId, kind: item.kind },
    ...(item.identities ?? []).map(identity => ({ ...identity, kind: item.kind }))]);
  const registered = await getDb().select({ identity: workIdentifiers, work: readingWorks }).from(workIdentifiers)
    .innerJoin(readingWorks, eq(readingWorks.id, workIdentifiers.workId)).where(and(
      enabledCategories(sql`${readingWorks.kind}`, config),
      or(...identities.map(identity => and(eq(workIdentifiers.provider, identity.provider),
        eq(workIdentifiers.externalId, identity.externalId), eq(workIdentifiers.kind, identity.kind))))
    )).limit(PAGE_SIZE * 2);
  const local = [...new Map(registered.map(row => [row.work.id, row.work])).values()];
  const cards = await readingCards(userId, userId, local);
  const byId = new Map(cards.map(card => [card.id, card]));
  const byIdentity = new Map(registered.map(row => [`${row.identity.provider}:${row.identity.externalId}`, byId.get(row.work.id)!]));
  const result = metadata.map(item => {
    const keys = [{ provider: item.provider, externalId: item.externalId }, ...(item.identities ?? [])];
    const matches = [...new Map(keys.flatMap(identity => {
      const card = byIdentity.get(`${identity.provider}:${identity.externalId}`);
      return card ? [[card.id, card] as const] : [];
    })).values()];
    return matches.length === 1 ? matches[0] : readingCard(
      { ...item, id: `${item.provider}:${item.externalId}` }, `/media/${item.provider}/${item.externalId}`, undefined, false);
  });
  return [...new Map(result.map(card => [card.id, card])).values()];
}

/** Owner-only journal. State transitions use real timestamps; page turns never fabricate read events. */
export async function readingHistoryData(userId:string,id:string,requested=1){
 await readingWork(userId,id);const page=v.parse(pageNumberSchema,requested),db=getDb();
 const {readingHistory}=await import('#lib/server/db/schema.js');
 const where=and(eq(readingHistory.userId,userId),eq(readingHistory.workId,id));
 const [result]=await db.select({total:count()}).from(readingHistory).where(where);const paging=pagination(result.total,page);
 const items=await db.select({id:readingHistory.id,state:readingHistory.state,page:readingHistory.page,totalPages:readingHistory.totalPages,occurredAt:readingHistory.occurredAt}).from(readingHistory).where(where).orderBy(sql`${readingHistory.occurredAt} desc`,sql`${readingHistory.id} desc`).limit(PAGE_SIZE).offset((paging.page-1)*PAGE_SIZE);
 return {...paging,total:result.total,items};
}

export async function readingRemoteDetail(userId:string,kind:ReadingKind,id:string):Promise<ReadingDetailData>{
 requireEnabledCategory(await getFeatureConfig(userId),'reading');
 const storedId=await readingStoredWorkId(kind,id);
 if(storedId){const detail=await readingDetails(userId,storedId);return {...detail,kind:detail.item.kind,remote:false};}
 const item=await readingProviderDetails(kind,id);
 requireEnabledCategory(await getFeatureConfig(userId),item.kind);
 return {kind:item.kind,remote:true,item:{...item,id:item.externalId},progress:null,relationships:{favourite:false,watchlist:false,collected:false},rating:null};
}
