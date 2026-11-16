import { providerCache } from '#lib/server/utils/provider-cache.js';
import { createSharedFlights } from '#lib/server/utils/shared-flights.js';
import { AppError } from '#lib/server/security/errors.js';

// Shared metadata pages only. Check the provider and credential generation
// before looking here. Keep abandoned work charged until it settles.
export function providerRowCache<T>(capacity = 80, ttl = 30 * 60_000) {
  const cache = providerCache<T>(capacity,ttl);
  const flights = createSharedFlights<T>();
  return (key: string, caller: AbortSignal, load: (signal: AbortSignal) => Promise<T>) => {
    caller.throwIfAborted();
    const cached = cache.peek(key);
    if (cached !== undefined) return Promise.resolve(cached);
    if (!flights.has(key) && flights.active >= 12) throw new AppError(503,'Discovery is busy. Try again shortly.','discovery_busy');
    return flights.run(key,caller,async signal => {
      const result = await load(signal);
      signal.throwIfAborted();
      return cache.store(key,result);
    });
  };
}
