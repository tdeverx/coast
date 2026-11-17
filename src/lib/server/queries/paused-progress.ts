import { sql } from 'drizzle-orm';
import { workCards } from '#lib/collection/query.server.js';
import { ROW_BATCH_SIZE } from '#lib/page-window.js';
import type { ProgressExperimentOptions } from '#lib/progress-experiment.js';
import { getDb } from '../db';
import { enabledCategories, selectedCategory } from '../experimental';
import { getFeatureConfig } from '../features';
import { hasPermittedWorkSource } from './media';
import { pagination, PAGE_SIZE } from './pagination';

const pausedCandidates=(userId:string,category?:string)=>sql`
  select media_id as id, updated_at from tracking_state where ${!category || category === 'screen'} and user_id = ${userId} and paused
  union all select games.game_id, games.updated_at from (
    select distinct on (game_id) game_id, status, updated_at
    from game_playthroughs where ${!category || category === 'game'} and user_id = ${userId}
    order by game_id, created_at desc, id desc
  ) games where games.status = 'paused'
  union all select work_id, updated_at from reading_progress where ${!category || category === 'reading'} and user_id = ${userId} and state = 'paused'
`;

export async function pausedProgressPresent(userId:string,viewerId:string,category?:string) {
  const [result]=await getDb().execute<{present:boolean}>(sql`select exists(
    select 1 from (${pausedCandidates(userId,category)}) paused join works on works.id=paused.id
    where social_visible(${userId}::uuid,${viewerId}::uuid,'progress',works.category)
  ) as present`);
  return result.present;
}

/** Both Progress surfaces read the existing per-medium states before hydrating a single page. */
export async function pausedProgressPage(
  userId: string,
  viewerId: string,
  options: Pick<ProgressExperimentOptions, 'kind' | 'scope' | 'page'> & { category?: string },
  preview = false,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const config = await getFeatureConfig(viewerId);
  const { category, scope } = options;
  const conditions = sql`${enabledCategories(sql`works.category`, config)}
    and ${selectedCategory(sql`works.category`, category ?? 'all')}
    and (${options.kind} = 'all' or works.kind = ${options.kind})
    and social_visible(${userId}::uuid, ${viewerId}::uuid, 'progress', works.category)
    ${scope === 'available' ? sql`and ${hasPermittedWorkSource(viewerId, category)}` : sql``}`;
  const size = preview ? ROW_BATCH_SIZE : PAGE_SIZE;
  signal?.throwIfAborted();
  const [result] = await getDb().execute<{ total: number; ids: string[] }>(sql`
    with paused as (${pausedCandidates(userId,category)}), eligible as (
      select paused.id, paused.updated_at from paused join works on works.id = paused.id
      ${scope === 'available' ? sql`left join media on media.id = works.id` : sql``}
      where ${conditions}
    ), counts as (select count(*)::int as total from eligible)
    select total, array(select id from eligible order by updated_at desc, id limit ${size}
      offset (least(${options.page}, greatest(1, ceil(counts.total::numeric / ${size})::int)) - 1) * ${size}) as ids from counts`);
  signal?.throwIfAborted();
  const items = result.ids.length ? await workCards(userId, viewerId, result.ids, true, 'paused') : [];
  signal?.throwIfAborted();
  return { ...pagination(result.total, options.page, size), total: result.total, items };
}
