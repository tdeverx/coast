import { sequenceEntries, nextSequenceEntry } from '../../core/lists/sequence';
import { rewatchBoundary, rewatchFields } from '../../core/tracking/rewatch';
import { and, or, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db';
import * as s from '../db/schema';
import { permittedMediaSources } from './media';

type EpisodeEntry = {
  id: string;
  groupId: string;
  seasonId?: string | null;
  seasonNumber?: number;
  watched: boolean;
  progress: number;
  duration: number;
  dropped: boolean;
  available: boolean;
  rewatching?: boolean;
};
const active = (entry: EpisodeEntry) =>
  entry.progress > 0 && (!entry.duration || entry.progress < entry.duration * 0.9);
const started = (entry: EpisodeEntry) => entry.watched || entry.progress > 0;
/** Keep untouched seasons separate from continuations within an already-started season. */
export function planEpisodeContinuations(episodes: EpisodeEntry[], availableOnly = true) {
  const nextIds = new Set<string>(),
    newSeasonIds = new Set<string>();
  for (const entries of Map.groupBy(episodes, (entry) => entry.groupId).values()) {
    const regular = entries.filter((entry) => (entry.seasonNumber ?? 0) > 0);
    const seasons = Map.groupBy(regular, (entry) => entry.seasonNumber!);
    const startedSeasons = [...seasons]
      .filter(([, items]) => items.some(started))
      .map(([number]) => number);
    if (!startedSeasons.length) {
      const first = regular.find(
        (entry) => entry.rewatching && !entry.dropped && (!availableOnly || entry.available)
      );
      if (first) nextIds.add(first.id);
      continue;
    }
    // The progress read model already includes in-progress episodes.
    if (regular.some((entry) => active(entry) && !entry.dropped)) continue;
    const currentNumber = Math.max(...startedSeasons);
    const current = seasons.get(currentNumber)!;
    if (!current.every((entry) => entry.watched)) {
      const next = current.find(
        (entry) => !entry.watched && !entry.dropped && (!availableOnly || entry.available)
      );
      if (next) nextIds.add(next.id);
      continue;
    }
    // Hand off to exactly the next season, without skipping unavailable seasons.
    const nextNumber = [...seasons.keys()]
      .sort((a, b) => a - b)
      .find((number) => number > currentNumber);
    const nextSeason = nextNumber === undefined ? undefined : seasons.get(nextNumber);
    const candidate = nextSeason?.find(
      (entry) => (!availableOnly || entry.available) && !entry.dropped && entry.seasonId
    );
    if (candidate?.seasonId) newSeasonIds.add(candidate.seasonId);
  }
  return { nextIds: [...nextIds], newSeasonIds: [...newSeasonIds] };
}

export async function continuationIds(userId: string, startedIds: string[], availableOnly = true) {
  const db = getDb();
  const available = sql<boolean>`${s.media.id} in (select permitted.media_id from (${permittedMediaSources(userId)}) permitted)`;
  const fields = {
    id: s.media.id,
    ...rewatchFields(userId, sql`${s.media.id}`),
    rewatching: sql<boolean>`${rewatchBoundary(userId, sql`${s.media.id}`)} is not null`,
    duration: sql<number>`coalesce(${s.trackingState.durationSeconds}, 0)`,
    dropped: sql<boolean>`coalesce(${s.trackingState.dropped}, false)`,
    available,
  };
  const allowedParent = (
    id:
      | typeof s.media.id
      | typeof s.episodes.showId
      | typeof s.episodes.seasonId
      | typeof s.mediaRelationships.parentId
  ) =>
    sql`not exists (select 1 from tracking_state parent_state where parent_state.media_id = ${id} and parent_state.user_id = ${userId} and parent_state.dropped)`;
  const [episodes, collections] = await Promise.all([
    db
      .select({
        ...fields,
        groupId: s.episodes.showId,
        seasonId: s.episodes.seasonId,
        seasonNumber: s.episodes.seasonNumber,
        position: s.episodes.episodeNumber,
      })
      .from(s.episodes)
      .innerJoin(s.media, eq(s.media.id, s.episodes.mediaId))
      .leftJoin(
        s.trackingState,
        and(eq(s.trackingState.mediaId, s.media.id), eq(s.trackingState.userId, userId))
      )
      .where(
        and(
          or(
            sql`exists(select 1 from rewatches r where r.user_id=${userId} and r.media_id in (${s.episodes.showId},${s.episodes.seasonId},${s.episodes.mediaId}))`,
            inArray(
              s.episodes.showId,
              db
                .select({ id: s.episodes.showId })
                .from(s.episodes)
                .where(inArray(s.episodes.mediaId, startedIds))
            )
          ),
          allowedParent(s.episodes.showId),
          allowedParent(s.episodes.seasonId)
        )
      )
      .orderBy(asc(s.episodes.seasonNumber), asc(s.episodes.episodeNumber)),
    db
      .select({ id: s.media.id, title: s.media.title })
      .from(s.media)
      .where(
        and(
          eq(s.media.kind, 'collection'),
          allowedParent(s.media.id),
          or(
            sql`exists(select 1 from rewatches r where r.user_id=${userId} and r.media_id=${s.media.id})`,
            sql`exists (with recursive descendants(id,path) as (
          select child_id,array[parent_id,child_id] from media_relationships where parent_id=${s.media.id} and kind in ('collection','franchise')
          union all select rel.child_id,d.path||rel.child_id from descendants d join media_relationships rel on rel.parent_id=d.id
            where rel.kind in ('collection','franchise') and not rel.child_id=any(d.path)
        ) select 1 from descendants d
          left join episodes e on (e.show_id=d.id or e.season_id=d.id) and not e.is_special
          join tracking_state t on t.media_id=coalesce(e.media_id,d.id) and t.user_id=${userId}
          where not t.dropped and (t.watched or t.position_seconds>0))`
          )
        )
      ),
  ]);
  const playlists = await db
    .select({ id: s.lists.id, title: s.lists.name })
    .from(s.lists)
    .where(
      and(
        eq(s.lists.userId, userId),
        eq(s.lists.playlist, true),
        sql`${s.lists.playbackStartedAt} is not null`
      )
    );
  const sources = [
    ...collections.map((row) => ({ ...row, kind: 'collection' as const })),
    ...playlists.map((row) => ({ ...row, kind: 'playlist' as const })),
  ];
  const sequenceNext = [];
  for (const source of sources) {
    const entry = nextSequenceEntry(await sequenceEntries(userId, source));
    if (entry)
      sequenceNext.push({
        entry,
        source: { id: source.id, kind: source.kind },
        title: source.title,
      });
  }
  return { ...planEpisodeContinuations(episodes, availableOnly), sequenceNext };
}
