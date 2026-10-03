import type { ActivityStatus } from '$lib/social/status';

export type WorkSocial = {
  friends: { username: string; avatar?: string | null; status?: ActivityStatus }[];
  total: number;
};
export type SocialEnrichment = Record<string, WorkSocial>;

/** Shelf-local results. Appends keep badges; a changed viewer/selection/revision discards them. */
export function createSocialEnrichment(
  fetchBatch: (ids: string[], signal: AbortSignal) => Promise<SocialEnrichment>,
  publish: (value: SocialEnrichment) => void,
) {
  let scope: string | undefined;
  let ids = new Set<string>();
  let completed = new Set<string>();
  let pending = new Set<string>();
  let queue: string[] = [];
  let results: SocialEnrichment = {};
  let controller = new AbortController();
  let running = 0;

  function cancel() {
    controller.abort();
    controller = new AbortController();
    queue = [];
    pending = new Set();
    running = 0;
  }

  function pump() {
    while (running < 2 && queue.length) {
      const batch = queue.splice(0, 60).filter(id => ids.has(id));
      if (!batch.length) continue;
      const request = controller;
      running++;
      void fetchBatch(batch, request.signal).then(value => {
        if (request.signal.aborted || request !== controller) return;
        // Empty results count as resolved too. Only requested, still-visible IDs may publish.
        for (const id of batch) {
          if (!ids.has(id)) continue;
          completed.add(id);
          if (Object.hasOwn(value, id)) results[id] = value[id];
        }
        publish({ ...results });
      }).catch(() => {
        // Failed IDs remain missing and can retry on the next update/explicit refresh.
      }).finally(() => {
        if (request !== controller) return;
        batch.forEach(id => pending.delete(id));
        running--;
        pump();
      });
    }
  }

  function update(next: { scope: string; ids: string[]; active: boolean }) {
    const nextIds = new Set(next.active ? next.ids : []);
    const changed = scope !== next.scope || !next.active;
    if (changed) {
      cancel();
      scope = next.scope;
      completed.clear();
      results = {};
      publish(results);
    } else if ([...ids].some(id => !nextIds.has(id))) {
      // Replacement/removal cancels requests that belong to the previous card selection.
      cancel();
      completed = new Set([...completed].filter(id => nextIds.has(id)));
      results = Object.fromEntries(Object.entries(results).filter(([id]) => nextIds.has(id)));
      publish(results);
    }
    ids = nextIds;
    for (const id of ids) {
      if (completed.has(id) || pending.has(id)) continue;
      pending.add(id);
      queue.push(id);
    }
    pump();
  }

  return { update, cancel };
}
