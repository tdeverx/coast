import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { listProviders } from '$lib/providers/instances.server';
import { musicLibrary } from '$lib/music/service.server';
import { musicBrowseSchema } from '$lib/providers/jellyfin/music.server';
import { logDiagnostic, classifyFailure } from '$lib/server/diagnostics';
import type { MusicPage } from '$lib/music/model';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) error(401, 'Sign in to browse music.');
  const page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 42949673)
    error(400, 'Choose a positive music page number.');
  const options = v.safeParse(musicBrowseSchema, {
    kind: url.searchParams.get('kind') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    offset: (page - 1) * 50,
  });
  if (!options.success) error(400, 'Choose valid music filters.');
  const sources = (await listProviders(locals.user.id))
    .filter(
      (provider) => provider.provider === 'jellyfin' && provider.connection?.status === 'connected'
    )
    .map((provider) => ({ id: provider.connection!.id, name: provider.name }));
  const connectionId = url.searchParams.get('connection') ?? sources[0]?.id ?? '';
  if (connectionId && !sources.some((source) => source.id === connectionId))
    error(404, 'This music source is unavailable.');
  let result: MusicPage = { items: [], total: 0, nextOffset: null };
  let failure = '';
  if (connectionId) {
    try {
      result = await musicLibrary(locals.user.id, connectionId, options.output);
    } catch (cause) {
      failure = 'Music could not be loaded. Please try again.';
      await logDiagnostic('error', 'application.failed', {
        failure: classifyFailure(cause),
      });
    }
  }
  return {
    ...result,
    sources,
    connectionId,
    failure,
    page,
    pages: Math.max(page, Math.ceil(result.total / 50)),
    filters: { kind: options.output.kind, search: options.output.search ?? '' },
  };
};
