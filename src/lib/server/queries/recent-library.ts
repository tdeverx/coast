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

/** Accessible library identities, ranked by the source's added date where available. */
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
  const size=options.preview?ROW_BATCH_SIZE:PAGE_SIZE;
  const result=await getDb().execute<{total:number;ids:string[]}>(sql`
    with eligible as materialized (
      select ${s.works.id} as id, ${s.works.createdAt} as indexed_at
      from ${s.works} left join ${s.media} on ${eq(s.media.id,s.works.id)} where ${where}
    ), added as (
      select eligible.id, ${category==='screen' ? sql`coalesce(
        max((item.snapshot->>'addedAt')::timestamptz) filter(where e.show_id is not null),
        max((item.snapshot->>'addedAt')::timestamptz) filter(where e.show_id is null))`
        : sql`max((item.snapshot->>'addedAt')::timestamptz)`} as added_at
      from availability a
      join provider_connections c on c.id=a.connection_id and c.user_id=a.user_id
      join provider_instances p on p.id=c.instance_id
      join provider_items item on item.id=a.provider_item_id and item.instance_id=p.id
      ${category==='screen'?sql`left join episodes e on e.media_id=a.media_id`:undefined}
      join eligible on eligible.id=${category==='screen'?sql`coalesce(e.show_id,a.media_id)`:sql`a.media_id`}
      where a.user_id=${userId} and a.state='available' and c.status='connected' and p.enabled
        and p.provider='jellyfin' and item.snapshot ? 'addedAt'
      group by eligible.id
    ), total as (select count(*)::int as total from eligible)
    select total, coalesce((
      select jsonb_agg(id order by added_at desc,id) from (
        select eligible.id,coalesce(added.added_at,eligible.indexed_at) as added_at
        from eligible left join added on added.id=eligible.id
        order by added_at desc,eligible.id limit ${size}
        offset (least(${options.page}, greatest(1,(total+${size}-1)/${size}))-1)*${size}
      ) page
    ),'[]'::jsonb) as ids from total`);
  const {total,ids}=result[0];
  const {page,pages}=pagination(total,options.page,size);
  signal?.throwIfAborted();
  const items=await workCards(userId,userId,ids);
  signal?.throwIfAborted();
  return {items:items.map(item=>({...item,available:true})),page,pages,total};
}
