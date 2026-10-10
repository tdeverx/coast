import { detailsData } from '$lib/server/queries/media';
import { requestOptions } from '$lib/providers/seerr/requests.server';
import { ensureDetails } from '$lib/catalogue/service.server';

/** Saved details render first; page and overlay share the same optional enrichment. */
export async function loadMediaDetails(userId: string, id: string) {
  const initial = { ...(await detailsData(userId, id)), requestable: false, refreshUnavailable: false };
  const enhancement = (async () => {
    let refreshUnavailable = false;
    const refresh = (workId: string) => ensureDetails(userId, workId).catch(() => {
      refreshUnavailable = true;
      return false;
    });
    const requests = requestOptions(userId, id).catch(() => []);
    const refreshed = initial.item.tmdbId || initial.item.showId ? await refresh(id) : false;
    let data = refreshed ? await detailsData(userId, id) : initial;
    const refreshedCollections = await Promise.all(data.collections.map(collection => refresh(collection.id)));
    if (refreshedCollections.some(Boolean)) data = await detailsData(userId, id);
    return { ...data, requestable: (await requests).length > 0, refreshUnavailable };
  })().catch(() => ({ ...initial, refreshUnavailable: true }));
  return { ...initial, enhancement };
}
