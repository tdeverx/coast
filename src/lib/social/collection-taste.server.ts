import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { requireEnabledCategory } from '#lib/server/experimental.js';
import { requireFeature } from '#lib/server/features.js';
import { titleTastes, type TasteScoreMode } from './taste-cache.server';

export type TasteGroup = 'collection' | 'reading-group';
export type CollectionTaste = { score: number | null; members: { total: number; sampled: number; matched: number } };

// One explicit detail request hydrates at most 24 titles, independently of set size.
const sampleLimit = 24;

export async function collectionTaste(userId: string, id: string, group: TasteGroup, mode?: TasteScoreMode): Promise<CollectionTaste | null> {
  const config = await requireFeature(userId, 'personalisation');
  requireEnabledCategory(config, group === 'reading-group' ? 'comic' : 'screen');

  const members = group === 'reading-group' ? sql`
    select w.id, w.release_date
    from reading_groups g join reading_group_members m on m.group_id=g.id
    join reading_works w on w.id=m.work_id and w.kind='comic'
    where g.id=${id}::uuid and g.kind='comic' and g.provider='comic-vine'
  ` : sql`
    with recursive nodes(id) as (
      select id from media where id=${id}::uuid and kind='collection'
      union
      select r.child_id from nodes n join media parent on parent.id=n.id and parent.kind='collection'
      join media_relationships r on r.parent_id=n.id and r.kind in ('collection','franchise')
    )
    select distinct title.id, title.release_date from nodes n
    left join episodes e on e.media_id=n.id left join seasons s on s.media_id=n.id
    join media title on title.id=coalesce(e.show_id,s.show_id,n.id) and title.kind in ('movie','show')
  `;
  // Sample across the release order, including both ends. UNION above visits each node
  // once even for cyclic or diamond-shaped collections. Each show gets one vote.
  const sample = await getDb().execute<{ id: string; total: number }>(sql`
    with ranked as materialized (
      select id, row_number() over(order by release_date nulls last,id) as ordinal from (${members}) titles
    ), size as (
      select count(*) as total, least(count(*),${sampleLimit}::int) as samples from ranked
    )
    select r.id, s.total::int as total from size s
    cross join lateral generate_series(0::bigint,s.samples-1) n
    join ranked r on r.ordinal=1+n*(s.total-1)/greatest(s.samples-1,1)
    order by r.ordinal
  `);
  if (!sample.length) return null;
  const ids = sample.map(member => member.id);
  const matches = await titleTastes(userId, ids, config, mode);
  const scores = ids.map(id => matches.get(id)?.score).filter((score): score is number => score != null);
  const enough = scores.length >= 2 && scores.length * 2 >= sample.length;
  return {
    score: enough ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    members: { total: sample[0].total, sampled: sample.length, matched: scores.length }
  };
}
