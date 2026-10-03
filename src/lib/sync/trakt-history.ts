import type { TraktRecord } from '$lib/providers/trakt/adapter.server';

type Title = NonNullable<TraktRecord['movie' | 'show' | 'season' | 'episode']>;
export type TraktHistoryTitles = Map<string, Title>;

/** Keep history ordering/event identity, without retaining unused page payloads. */
export function compactTraktHistory(record: TraktRecord, titles: TraktHistoryTitles): TraktRecord {
  const compact: TraktRecord = {};
  for (const key of ['id', 'watched_at', 'paused_at', 'rated_at', 'collected_at', 'listed_at'] as const)
    if (record[key] !== undefined) Object.assign(compact, { [key]: record[key] });
  for (const kind of ['movie', 'show', 'season', 'episode'] as const) {
    const item = record[kind];
    if (!item) continue;
    // resolveTrakt uses these identity/title fields; year and slug are not read
    // when importing history. Keep nulls and all fields used by leaf resolution.
    const ids = { ...item.ids };
    delete ids.slug;
    const title = { ids } as Title;
    for (const field of ['title', 'runtime', 'season', 'number'] as const)
      if (field in item) Object.assign(title, { [field]: item[field as keyof typeof item] });
    const key = `${kind}:${item.ids.trakt}`;
    const previous = titles.get(key);
    // Changed metadata must remain specific to its source event. The bounded
    // interning table is only an allocation aid, never an identity resolver.
    const shared = previous && JSON.stringify(previous) === JSON.stringify(title) ? previous : title;
    if (shared !== previous) {
      if (!previous && titles.size >= 10_000) titles.clear();
      titles.set(key, shared);
    }
    Object.assign(compact, { [kind]: shared });
  }
  return compact;
}
