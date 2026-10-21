import { error } from '@sveltejs/kit';
import {AppError} from '#lib/server/security/errors.js';
import * as v from 'valibot';
import { musicSourceDetailData } from '#lib/music/detail.server.js';
import { jellyfinMusicIdSchema } from '#lib/providers/jellyfin/music.server.js';
import { logDiagnostic, classifyFailure } from '#lib/server/diagnostics/index.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({locals, params, url, depends,request}) => {
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
  return await musicSourceDetailData(locals.user.id, params.connection, params.id,page,request.signal).catch(
    async (cause) => {
      request.signal.throwIfAborted();
      if(cause instanceof AppError)error(cause.status,cause.message);
      await logDiagnostic('error', 'application.failed', {
        failure: classifyFailure(cause),
      });
      error(503, 'This music item is unavailable. Return to Music and try again.');
    }
  );
};
