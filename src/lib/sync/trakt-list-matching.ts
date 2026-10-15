type Identity = { kind: string; ids: Record<string, unknown> };
const providers = ['trakt', 'tmdb', 'tvdb', 'imdb'] as const;
const keys = (entry: Identity) => providers.flatMap(provider => entry.ids[provider] == null ? []
  : [JSON.stringify([entry.kind, provider, String(entry.ids[provider])])]);

/** Match any shared alias, retaining the first remote occurrence across aliases. */
export function matchTraktList<T extends Identity>(desired: readonly Identity[], remote: readonly T[]) {
  const wanted = new Set(desired.flatMap(keys));
  const first = new Map<string, number>();
  remote.forEach((entry, index) => {
    for (const key of keys(entry)) if (!first.has(key)) first.set(key, index);
  });
  return {
    removed: remote.filter(entry => !keys(entry).some(key => wanted.has(key))),
    matches: desired.map(entry => {
      let index = Infinity;
      for (const key of keys(entry)) index = Math.min(index, first.get(key) ?? Infinity);
      return index === Infinity ? undefined : remote[index];
    }),
  };
}
