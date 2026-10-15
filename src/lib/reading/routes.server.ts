import * as v from 'valibot';
import { error, redirect, type ServerLoadEvent } from '@sveltejs/kit';
import { readingDetails, readingStoredWorkId } from '$lib/reading/query.server';
import type { ReadingDetailData } from '$lib/reading/presentation';
import type { ReadingKind } from '$lib/reading/model';
import { readingProviderDetails } from '$lib/providers/reading.server';
import { getConfig } from '$lib/server/config';
import { requireEnabledCategory } from '$lib/server/experimental';
import { AppError } from '$lib/server/security/errors';
import { ProviderHttpError } from '$lib/server/security/provider-fetch';
import { providerApiError } from '$lib/server/security/provider-api-error';
import { DomainError } from '$lib/core/errors';

function routeError(cause: unknown, event: ServerLoadEvent): never {
  if (v.isValiError(cause)) error(400, 'Check the reading filters or identifier.');
  if (cause instanceof AppError || cause instanceof DomainError) error(cause.status, cause.message);
  if (cause instanceof ProviderHttpError) {
    if (cause.status === 404) error(404, 'Reading work not found.');
    const failure = providerApiError(cause);
    if (failure.headers) event.setHeaders(failure.headers);
    error(failure.status, failure.body.error);
  }
  throw cause;
}
async function requireReading(event: ServerLoadEvent, kind: ReadingKind | 'reading') {
  requireEnabledCategory(await getConfig(), kind);
  if (!event.locals.user) error(401, 'Sign in to browse reading.');
  event.depends('coast:tracking');
  event.depends('coast:reading');
  event.depends('coast:providers');
  return event.locals.user;
}
export function readingDetailLoad(kind: ReadingKind, remote = false) {
  return async (event: ServerLoadEvent): Promise<ReadingDetailData> => {
    try {
      const user = await requireReading(event, remote ? 'reading' : kind);
      const id = remote ? event.params.externalId ?? '' : event.params.id ?? '';
      if (remote) {
        const storedId = await readingStoredWorkId(kind, id);
        if (storedId) redirect(303, `/media/${storedId}`);
        const item = await readingProviderDetails(kind, id);
        return { kind: item.kind, remote, item: { ...item, id: item.externalId }, progress: null, relationships: { favourite: false, watchlist: false, collected: false }, rating: null };
      }
      const detail = await readingDetails(user.id, id);
      if (detail.item.kind !== kind) error(404, 'Reading work not found.');
      return { ...detail, kind, remote };
    } catch (cause) { routeError(cause, event); }
  };
}
