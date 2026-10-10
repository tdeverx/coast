import { eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../db';
import * as s from '../db/schema';
import { isHeroTitle } from '../../media/hero';
import { rewatchFields } from '../../core/tracking/rewatch.server';
import { continueHeroId } from './progress';
import { mediaViewsForIds, nextPlayable, permittedAvailability } from './media';

/** Keep the initial route limited to its hero; every shelf loads through its own source. */
export async function homeData(userId: string) {
  const heroId = await continueHeroId(userId)
    ?? await trackedHeroId(userId, true)
    ?? await libraryHeroId(userId)
    ?? await trackedHeroId(userId, false);
  const candidate = heroId ? (await mediaViewsForIds(userId, [heroId]))[0] : null;
  const hero = candidate && isHeroTitle(candidate) ? candidate : null;
  return { hero, heroNext: hero ? await nextPlayable(userId, hero) : null };
}

async function trackedHeroId(userId: string, saved: boolean) {
  const watched = rewatchFields(userId, sql`m.id`, sql`t`).watched;
  const [row] = await getDb().execute<{ id: string }>(sql`
    with recent as (
      select media_id from tracking_state where user_id=${userId}
      order by updated_at desc limit 300
    )
    select coalesce(e.show_id, se.show_id, m.id) as id
    from tracking_state t join media m on m.id=t.media_id
    left join episodes e on e.media_id=m.id left join seasons se on se.media_id=m.id
    where t.user_id=${userId}
      and (t.media_id in (select media_id from recent)
        or t.position_seconds>0 and (t.duration_seconds=0 or t.position_seconds<t.duration_seconds*.9))
      and ${saved
        ? sql`t.watchlist and not ${watched} and not t.dropped and t.completed_episodes=0 and m.kind in ('movie','show','season','episode')`
        : sql`${watched} and m.kind in ('movie','episode')`}
    order by t.updated_at desc limit 1
  `);
  return row?.id;
}

async function libraryHeroId(userId: string) {
  const root = sql<string>`coalesce(${s.episodes.showId}, ${s.availability.mediaId})`;
  const roots = getDb().select({ id: root }).from(s.availability)
    .innerJoin(s.providerConnections, eq(s.availability.connectionId, s.providerConnections.id))
    .innerJoin(s.providerInstances, eq(s.providerConnections.instanceId, s.providerInstances.id))
    .leftJoin(s.episodes, eq(s.episodes.mediaId, s.availability.mediaId))
    .where(permittedAvailability(userId)).groupBy(root)
    .orderBy(desc(sql`max(${s.availability.verifiedAt})`)).limit(100);
  const [row] = await getDb().execute<{ id: string }>(sql`
    select coalesce(e.show_id, se.show_id, m.id) as id from media m
    left join episodes e on e.media_id=m.id left join seasons se on se.media_id=m.id
    where m.id in (${roots}) and m.kind in ('movie','show','season','episode')
    order by m.updated_at desc, m.id limit 1
  `);
  return row?.id;
}
