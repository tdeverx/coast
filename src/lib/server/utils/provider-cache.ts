/** Bounded response cache. Never store per-user tracking or library availability here. */
export function providerCache<T>(
  capacity = 100,
  ttl = 15 * 60_000,
  cacheable: (value: T) => boolean = () => true
) {
  const values = new Map<string, { value: T; expires: number }>();
  const pending = new Map<string, Promise<T>>();
  return async (key: string, fetcher: () => Promise<T>): Promise<T> => {
    // Lookups also release expired entries for other keys, including after outages.
    // Capacity bounds this sweep; no background timer or retained stale fallback.
    const now = Date.now();
    for (const [id, entry] of values) if (entry.expires <= now) values.delete(id);
    const cached = values.get(key);
    if (cached) return cached.value;
    const existing = pending.get(key);
    if (existing) return existing;
    const request = fetcher()
      .then((value) => {
        values.delete(key);
        if (cacheable(value)) values.set(key, { value, expires: Date.now() + ttl });
        while (values.size > capacity) values.delete(values.keys().next().value!);
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
