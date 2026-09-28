/** Bound independent work, preserve input order, and settle workers before reporting failure. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('Concurrency must be a positive integer.');
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed && cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = await work(items[index], index);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    })
  );
  if (failed) throw failure;
  return results;
}

/** Share concurrent calls only; successful results and failures are never cached. */
export function singleFlight<T>() {
  const pending = new Map<string, Promise<T>>();
  return (key: string, work: () => Promise<T>): Promise<T> => {
    let result = pending.get(key);
    if (!result) {
      result = Promise.resolve()
        .then(work)
        .finally(() => pending.delete(key));
      pending.set(key, result);
    }
    return result;
  };
}
