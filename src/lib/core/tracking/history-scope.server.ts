import { sql } from 'drizzle-orm';
export const historyScope = (mediaId: string) => sql`with recursive scope(id) as (
  select ${mediaId}::uuid union select edge.id from scope parent join lateral (
    select e.media_id id from episodes e where e.show_id=parent.id or e.season_id=parent.id
    union select r.child_id from media_relationships r where r.parent_id=parent.id and r.kind in ('collection','franchise')
  ) edge on true
) select id from scope`;
