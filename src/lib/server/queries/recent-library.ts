import * as v from 'valibot';
import {and,eq,sql} from 'drizzle-orm';
import {recentLibrarySchema,type LibraryFeedContent} from '#lib/library-feed.js';
import {workCards} from '#lib/collection/query.server.js';
import {getFeatureConfig} from '../features';
import {requireEnabledCategory} from '../experimental';
import {getDb} from '../db';
import * as s from '../db/schema';
import {hasPermittedWorkSource} from './media';
import {PAGE_SIZE,pagination} from './pagination';
import {ROW_BATCH_SIZE} from '#lib/page-window.js';

/** Newly indexed, accessible library identities; metadata refresh never changes their order. */
export async function recentLibraryData(userId:string,raw:unknown,signal?:AbortSignal):Promise<LibraryFeedContent>{
  const options=v.parse(recentLibrarySchema,raw);
  signal?.throwIfAborted();
  const category=['movie','show'].includes(options.kind)?'screen':options.kind;
  requireEnabledCategory(await getFeatureConfig(userId),category);
  const where=and(eq(s.works.kind,options.kind==='music'?'album':options.kind),hasPermittedWorkSource(userId));
  const db=getDb();
  const [count]=await db.select({total:sql<number>`count(*)::int`}).from(s.works)
    .leftJoin(s.media,eq(s.media.id,s.works.id)).where(where);
  const size=options.preview?ROW_BATCH_SIZE:PAGE_SIZE;
  const {page,pages}=pagination(count.total,options.page,size);
  signal?.throwIfAborted();
  const rows=await db.select({id:s.works.id}).from(s.works).leftJoin(s.media,eq(s.media.id,s.works.id)).where(where)
    .orderBy(sql`${s.works.createdAt} desc`,s.works.id).limit(size).offset((page-1)*size);
  signal?.throwIfAborted();
  const items=await workCards(userId,userId,rows.map(row=>row.id));
  signal?.throwIfAborted();
  return {items:items.map(item=>({...item,available:true})),page,pages,total:count.total};
}
