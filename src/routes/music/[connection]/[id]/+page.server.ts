import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { musicDetails, musicLibrary } from '$lib/music/service.server';
import { jellyfinMusicIdSchema } from '$lib/providers/jellyfin/music.server';
import { logDiagnostic, classifyFailure } from '$lib/server/diagnostics';
import type { MusicPage } from '$lib/music/model';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({locals, params, url, depends}) => {
  depends('coast:tracking');

  if (!locals.user) error(401, 'Sign in to browse music.');
  if (
    !v.safeParse(v.pipe(v.string(), v.uuid()), params.connection).success ||
    !v.safeParse(jellyfinMusicIdSchema, params.id).success
  )
    error(400, 'Choose a valid music item.');
  const page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 42949673)
    error(400, 'Choose a positive music page number.');
  const detail = await musicDetails(locals.user.id, params.connection, params.id).catch(
    async (cause) => {
      await logDiagnostic('error', 'application.failed', {
        failure: classifyFailure(cause),
      });
      error(503, 'This music item is unavailable. Return to Music and try again.');
    }
  );
  let children: MusicPage = { items: [], total: 0, nextOffset: null };
  let failure = '';
  if (detail.item.kind !== 'track') {
    try {
      children = await musicLibrary(locals.user.id, params.connection, {
        kind: detail.item.kind === 'artist' ? 'album' : 'track',
        ...(detail.item.kind === 'artist'
          ? { artistId: detail.item.id }
          : { albumId: detail.item.id }),
        offset: (page - 1) * 50,
      });
    } catch (cause) {
      failure = 'Music could not be loaded. Please try again.';
      await logDiagnostic('error', 'application.failed', {
        failure: classifyFailure(cause),
      });
    }
  }
  return {
    ...detail,
    children,
    failure,
    page,
    pages: Math.max(page, Math.ceil(children.total / 50)),
  };
};
