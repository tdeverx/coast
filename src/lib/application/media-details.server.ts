import { detailsData } from '#lib/server/queries/media.js';
import { requestOptions } from '#lib/providers/seerr/requests.server.js';
import { ensureDetails } from '#lib/catalogue/service.server.js';
import type {MediaView} from '#lib/ui/types.js';
export type ScreenDetailView=Omit<Awaited<ReturnType<typeof detailsData>>,'item'>&{item:MediaView;requestable:boolean;refreshUnavailable:boolean};
export type ScreenDetailData=ScreenDetailView&{enhancement:Promise<ScreenDetailView>};

/** Saved details render first; page and overlay share the same optional enrichment. */
export async function loadMediaDetails(userId: string, id: string, signal?:AbortSignal, includeChildren = true):Promise<ScreenDetailData> {
  const initial = { ...(await detailsData(userId, id, includeChildren)), requestable: false, refreshUnavailable: false };
  const enhancement = (async () => {
    let refreshUnavailable = false;
    const refresh = (workId: string) => ensureDetails(userId, workId).catch(() => {
      refreshUnavailable = true;
      return false;
    });
    const requests = requestOptions(userId, id, signal).catch(() => []);
    const refreshed = initial.item.tmdbId || initial.item.showId ? await refresh(id) : false;
    let data = refreshed ? await detailsData(userId, id, includeChildren) : initial;
    const refreshedCollections = await Promise.all(data.collections.map(collection => refresh(collection.id)));
    if (refreshedCollections.some(Boolean)) data = await detailsData(userId, id, includeChildren);
    return { ...data, requestable: (await requests).length > 0, refreshUnavailable };
  })().catch(() => ({ ...initial, refreshUnavailable: true }));
  return { ...initial, enhancement };
}
