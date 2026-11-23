import type {SQL} from 'bun';

export const tasteSynopsisModel = 'all-MiniLM-L6-v2:coast-wordpiece-mean-v1';

// Both the offline export and the match-time digest use this precedence.
export function resolvedTasteSynopsis(sql: SQL) {
  return sql`coalesce(nullif(btrim(art.overview), ''), nullif(btrim(snap.overview), ''),
    nullif(btrim(m.overview), ''),
    (select nullif(btrim(s.overview),'') from metadata_snapshots s where s.media_id=w.id and s.provider='trakt'
      order by (s.language='en') desc,s.updated_at desc,s.id limit 1),
    (select nullif(btrim(s.overview),'') from metadata_snapshots s where s.media_id=w.id and s.provider='jellyfin'
      order by (s.language='en') desc,s.updated_at desc,s.id limit 1))`;
}
