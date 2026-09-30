import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { listProviders } from '$lib/providers/instances.server';
import { musicLibrary } from '$lib/music/service.server';
import { musicBrowseSchema } from '$lib/providers/jellyfin/music.server';
import { musicCard } from '$lib/music/presentation';
import { mapConcurrent } from '$lib/server/utils/async';
import { logDiagnostic, classifyFailure } from '$lib/server/diagnostics';
import { pageNumberSchema } from './pagination';

/** Page each connected library independently; identities and artwork stay connection-scoped. */
export async function musicBrowseData(userId: string, url: URL) {
  const requestedPage = v.safeParse(pageNumberSchema, Number(url.searchParams.get('page') ?? 1));
  if (!requestedPage.success) error(400, 'Choose a positive music page number.');
  const options = v.safeParse(musicBrowseSchema, {
    kind: url.searchParams.get('kind') ?? 'all',
    search: url.searchParams.get('search') ?? undefined,
    offset: (requestedPage.output - 1) * 50,
  });
  if (!options.success) error(400, 'Choose valid music filters.');
  const browseOptions = options.output;
  const sources = (await listProviders(userId))
    .filter(
      (provider) =>
        provider.provider === 'jellyfin' &&
        provider.enabled &&
        provider.connection?.status === 'connected'
    )
    .map((provider) => ({ id: provider.connection!.id, name: provider.name }));
  const connectionId = url.searchParams.get('connection') ?? '';
  if (connectionId && !sources.some((source) => source.id === connectionId))
    error(404, 'This music source is unavailable.');
  const selected = connectionId ? sources.filter((source) => source.id === connectionId) : sources;
  async function browse(page: number) {
    return mapConcurrent(selected, 4, async (source) => {
      try {
        const result = await musicLibrary(userId, source.id, {
          ...browseOptions,
          offset: (page - 1) * 50,
        });
        return {
          items: result.items.map((item) => musicCard(item, source.id)),
          total: result.total,
          failure: '',
        };
      } catch (cause) {
        await logDiagnostic('error', 'application.failed', { failure: classifyFailure(cause) });
        return {
          items: [],
          total: 0,
          failure: `Music from ${source.name} could not be loaded. Please try again.`,
        };
      }
    });
  }
  let results = await browse(requestedPage.output);
  const pages = Math.max(1, ...results.map((result) => Math.ceil(result.total / 50)));
  // Failed providers have an unknown last page. Preserve the requested page so retry can recover it.
  const page = results.some((result) => result.failure)
    ? requestedPage.output
    : Math.min(requestedPage.output, pages);
  if (page !== requestedPage.output) results = await browse(page);
  return {
    items: results.flatMap((result) => result.items),
    total: results.reduce((sum, result) => sum + result.total, 0),
    sources,
    connectionId,
    failure: results
      .map((result) => result.failure)
      .filter(Boolean)
      .join(' '),
    page,
    pages: Math.max(page, pages),
    filters: { kind: options.output.kind, search: options.output.search ?? '' },
  };
}
