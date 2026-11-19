import { sql } from 'drizzle-orm';
import { episodeHasAired, episodeHasAiredForProgress } from '#lib/catalogue/metadata/release-date.server.js';
import { rewatchFields } from '#lib/core/tracking/rewatch.server.js';
import type { MediaKind } from '#lib/ui/types.js';
import { getConfig, type CoastConfig } from '../config';
import { getDb } from '../db';

export type ProgressPresentation = 'continue' | 'next' | 'paused' | 'saved';
type Root = { id: string; kind: MediaKind };
type EpisodeContext = { rootId: string; episodeId: string | null; seasonId: string | null; seasonNumber: number | null };

/** One representative episode per visible root supplies captions and the existing artwork hierarchy. */
export async function progressEpisodes(
  userId: string,
  roots: Root[],
  presentation: ProgressPresentation | undefined,
  config?: Promise<Pick<CoastConfig, 'metadataSource'>>,
) {
  const targets = roots.filter(root => root.kind === 'show' || root.kind === 'season');
  if (!targets.length || !presentation || presentation === 'continue') return [];
  const resume = presentation === 'paused' || presentation === 'next';
  const state = rewatchFields(userId, sql`e.media_id`, sql`tracking`);
  const airtime = presentation==='next' ? episodeHasAiredForProgress : episodeHasAired;
  const aired = resume ? airtime(sql`e.media_id`, (await (config ?? getConfig())).metadataSource) : undefined;
  return getDb().execute<EpisodeContext>(sql`
    select root.id as "rootId", choice.media_id as "episodeId",
      coalesce(choice.season_id, fallback.media_id) as "seasonId",
      coalesce(choice.season_number, fallback.season_number) as "seasonNumber"
    from jsonb_to_recordset(${JSON.stringify(targets)}::text::jsonb) root(id uuid, kind text)
    left join lateral (
      select e.media_id, e.season_id, e.season_number from episodes e
      ${resume ? sql`left join tracking_state tracking on tracking.media_id = e.media_id and tracking.user_id = ${userId}` : sql``}
      where not e.is_special and ((root.kind = 'show' and e.show_id = root.id) or (root.kind = 'season' and e.season_id = root.id))
      ${aired ? sql`and ${aired} and not coalesce(tracking.dropped, false)` : sql``}
      order by ${resume ? sql`case when not (${state.watched}) and (${state.progress}) > 0 then 0 when not (${state.watched}) then 1 else 2 end,` : sql``}
        e.season_number, e.episode_number, e.media_id limit 1
    ) choice on true
    left join lateral (
      select s.media_id, s.season_number from seasons s
      where choice.season_id is null and root.kind = 'show' and s.show_id = root.id and s.season_number > 0
      order by s.season_number, s.media_id limit 1
    ) fallback on true`);
}

export async function progressCollections(roots: Root[], presentation?: ProgressPresentation) {
  const ids = roots.filter(root => root.kind === 'show' || root.kind === 'movie').map(root => root.id);
  if (presentation !== 'saved' || !ids.length) return [];
  return getDb().execute<{ rootId: string; collectionId: string }>(sql`
    select distinct on (r.child_id) r.child_id as "rootId", r.parent_id as "collectionId"
    from media_relationships r join media parent on parent.id = r.parent_id and parent.kind = 'collection'
    where r.child_id = any(${`{${ids.join(',')}}`}::uuid[]) and r.kind in ('collection', 'franchise')
    order by r.child_id, r.position nulls last, r.parent_id`);
}
