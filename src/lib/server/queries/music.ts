import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { listProviders } from '#lib/providers/instances.server.js';
import { musicLibrary } from '#lib/music/service.server.js';
import { musicBrowseSchema } from '#lib/providers/jellyfin/music.server.js';
import { musicCard } from '#lib/music/presentation.js';
import { mapConcurrent } from '#lib/server/utils/async.js';
import { logDiagnostic, classifyFailure } from '#lib/server/diagnostics/index.js';
import { pageNumberSchema, requestedPageInterval } from './pagination';
import { pageInterval, type PageWindow } from '#lib/page-window.js';
import { AppError } from '#lib/server/security/errors.js';
import { requireFeature } from '#lib/server/features.js';

/** Page each connected library independently; identities and artwork stay connection-scoped. */
export async function musicBrowseData(userId: string, url: URL,signal?:AbortSignal) {
  signal?.throwIfAborted();
  const requestedPage = v.safeParse(pageNumberSchema, Number(url.searchParams.get('page') ?? 1));
  if (!requestedPage.success) error(400, 'Choose a positive music page number.');
  const interval = requestedPageInterval(requestedPage.output, url.searchParams.get('firstPage'));
  const options = v.safeParse(musicBrowseSchema, {
    sort:url.searchParams.get('sort')??'default',
    kind: url.searchParams.get('kind') ?? 'all',
    availableOnly: url.searchParams.get('scope') === 'available',
    search: url.searchParams.get('search') ?? undefined,
    offset: (requestedPage.output - 1) * 50,
  });
  if (!options.success) error(400, 'Choose valid music filters.');
  const browseOptions = options.output;
  const providers = await listProviders(userId);
  const sources = providers
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
        },signal);
        return {
          items: result.items.map((item) => musicCard(item, source.id)),
          total: result.total,
          failure: '',
        };
      } catch (cause) {
        signal?.throwIfAborted();
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
  const finalPages = Math.max(page, ...results.map(result => Math.ceil(result.total / 50)));
  let items = results.flatMap(result => result.items), range: PageWindow | undefined;
  if (interval) {
    const bounds = pageInterval(finalPages, page, interval.firstPage);
    const counts: number[] = [], retained: typeof items = [];
    let incomplete=results.some(result=>!!result.failure);
    for (let number = bounds.firstPage; number <= page&&!incomplete; number++) {
      signal?.throwIfAborted();
      const current = number === page ? results : await browse(number);
      if (current.some((result,index) => result.failure || result.total !== results[index].total)) {
        incomplete=true;break;
      }
      const cards = current.flatMap(result => result.items);
      retained.push(...cards); counts.push(cards.length);
    }
    // Remote reads never hold a database transaction. Fence the final publication
    // against account replacement/withdrawal, including a newly connected source.
    signal?.throwIfAborted();
    await requireFeature(userId,'music');
    const finalProviders = await listProviders(userId);
    const census = (values: typeof providers) => values.filter(provider => provider.provider === 'jellyfin'
      && provider.enabled && provider.connection?.status === 'connected'
      && (!connectionId || provider.connection.id === connectionId))
      .map(provider => `${provider.connection!.id}:${provider.connection!.accountGeneration}`);
    const before = census(providers), after = census(finalProviders);
    if (before.some(identity => !after.includes(identity)))
      throw new AppError(403, 'A music account changed. Reload this library.', 'source_changed');
    if (before.length!==after.length)
      throw new AppError(502, 'The music sources changed. Retry this range.', 'incomplete_page_range');
    if(incomplete)
      throw new AppError(502, 'The music library changed or could not be loaded. Retry this range.', 'incomplete_page_range');
    signal?.throwIfAborted();
    items = retained; range = {...bounds,counts};
  }
  return {
    items,
    ...(range ? {range} : {}),
    total: results.reduce((sum, result) => sum + result.total, 0),
    sources,
    connectionId,
    failure: results
      .map((result) => result.failure)
      .filter(Boolean)
      .join(' '),
    page,
    pages: finalPages,
    filters: { kind: options.output.kind, search: options.output.search ?? '', scope: options.output.availableOnly ? 'available' as const : 'all' as const },
  };
}
