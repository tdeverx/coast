import type { PageServerLoad } from './$types';
import { detailsData } from '$lib/server/queries/media';
import { requestOptions } from '$lib/providers/seerr/requests.server';
import { ensureDetails } from '$lib/catalogue/service';

export const load = (async ({ locals, params }) => {
  const userId = locals.user!.id;
  const initial = {
    ...(await detailsData(userId, params.id)),
    requestable: false,
    refreshUnavailable: false,
  };
  // Stream provider enrichment after the saved page, so an outage never holds navigation open.
  const enhancement = (async () => {
    let refreshUnavailable = false;
    const refresh = (id: string) =>
      ensureDetails(userId, id).catch(() => {
        refreshUnavailable = true;
        return false;
      });
    const requests = requestOptions(userId, params.id).catch(() => []);
    const refreshed = initial.item.tmdbId || initial.item.showId ? await refresh(params.id) : false;
    let data = refreshed ? await detailsData(userId, params.id) : initial;
    const collectionRefreshes = await Promise.all(
      data.collections.map((collection) => refresh(collection.id))
    );
    if (collectionRefreshes.some(Boolean)) data = await detailsData(userId, params.id);
    return { ...data, requestable: (await requests).length > 0, refreshUnavailable };
  })().catch(() => ({ ...initial, refreshUnavailable: true }));
  return { ...initial, enhancement };
}) satisfies PageServerLoad;
