import { detailsData } from '#lib/server/queries/media.js';
import { requestOptions } from '#lib/providers/seerr/requests.server.js';
import { ensureDetails } from '#lib/catalogue/service.server.js';
import { classifyFailure, diagnosticErrorCode, logDiagnostic } from '#lib/server/diagnostics/index.js';
import { ProviderHttpError } from '#lib/server/security/provider-fetch.js';
import type {MediaView} from '#lib/ui/types.js';
export type ScreenDetailView=Omit<Awaited<ReturnType<typeof detailsData>>,'item'>&{item:MediaView;requestable:boolean};
export type ScreenDetailData=ScreenDetailView&{enhancement:Promise<ScreenDetailView>};

function reportEnrichmentFailure(error: unknown, stage: 'metadata-refresh' | 'metadata-read' | 'request-options') {
  const status = error instanceof ProviderHttpError ? error.status : undefined;
  const failure = classifyFailure(error);
  void logDiagnostic(failure === 'aborted' ? 'debug' : status === 404 ? 'info' : 'warn', 'application.failed', {
    operation: 'media', requestAction: 'details-enhance', stage, status, failure,
    provider: stage === 'metadata-refresh' ? 'tmdb' : stage === 'request-options' ? 'seerr' : undefined,
    errorCode: diagnosticErrorCode(error),
  });
}

/** Saved details render first; page and overlay share the same optional enrichment. */
export async function loadMediaDetails(userId: string, id: string, signal?:AbortSignal, includeChildren = true):Promise<ScreenDetailData> {
  const initial = { ...(await detailsData(userId, id, includeChildren)), requestable: false };
  const enhancement = (async () => {
    const refresh = async (workId: string) => {
      if (signal?.aborted) return false;
      try { return await ensureDetails(userId, workId); }
      catch (cause) { reportEnrichmentFailure(cause, 'metadata-refresh'); return false; }
    };
    const requests = requestOptions(userId, id, signal).catch(cause => {
      if (!signal?.aborted) reportEnrichmentFailure(cause, 'request-options');
      return [];
    });
    const refreshed = initial.item.tmdbId || initial.item.showId ? await refresh(id) : false;
    let data = refreshed ? await detailsData(userId, id, includeChildren) : initial;
    const refreshedCollections = await Promise.all(data.collections.map(collection => refresh(collection.id)));
    if (refreshedCollections.some(Boolean)) data = await detailsData(userId, id, includeChildren);
    return { ...data, requestable: (await requests).length > 0 };
  })().catch(cause => { reportEnrichmentFailure(cause, 'metadata-read'); return initial; });
  return { ...initial, enhancement };
}
