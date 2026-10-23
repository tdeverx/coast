import * as v from 'valibot';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {recentLibrarySchema,type LibraryFeedContent} from '#lib/library-feed.js';
import {workCards} from '#lib/collection/query.server.js';
import {actionCategories} from '#lib/actions.js';
import {categoryEnabled} from '#lib/experimental.js';
import {AppError} from '../security/errors';
import {getFeatureConfig} from '../features';
import {requireEnabledCategory} from '../experimental';
import {getDb} from '../db';
import * as s from '../db/schema';
import {hasPermittedWorkSource} from './media';
import {PAGE_SIZE,pagination} from './pagination';
import {ROW_BATCH_SIZE} from '#lib/page-window.js';
import {withReadCancellation} from '../db/read-cancellation';

/** Newly indexed, accessible library identities; metadata refresh never changes their order. */
export async function recentLibraryData(userId:string,raw:unknown,signal?:AbortSignal):Promise<LibraryFeedContent>{
  return withReadCancellation(signal,()=>recentLibraryRead(userId,raw,signal));
}
async function recentLibraryRead(userId:string,raw:unknown,signal?:AbortSignal):Promise<LibraryFeedContent>{
  const options=v.parse(recentLibrarySchema,raw);
  signal?.throwIfAborted();
  const config=await getFeatureConfig(userId);
  if(options.kind==='all'&&!options.action)throw new AppError(400,'Choose an action for recently added.');
  const category=options.action?actionCategories[options.action]:['movie','show'].includes(options.kind)?'screen':options.kind;
  requireEnabledCategory(config,category);
  const kinds=options.kind==='all'?(options.action==='watch'?['movie','show']:options.action==='listen'?['album']:options.action==='play'?['game']:['book','comic'].filter(kind=>categoryEnabled(config,kind))):[options.kind==='music'?'album':options.kind];
  const allowed=options.action==='watch'?['movie','show']:options.action==='listen'?['album']:options.action==='play'?['game']:options.action==='read'?['book','comic']:kinds;
  if(kinds.some(kind=>!allowed.includes(kind)))throw new AppError(400,'Choose a media type for this action.');
  if(options.kind!=='all')requireEnabledCategory(config,['movie','show'].includes(options.kind)?'screen':options.kind);
  const where=and(inArray(s.works.kind,kinds as typeof s.works.$inferSelect.kind[]),hasPermittedWorkSource(userId,category));
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
