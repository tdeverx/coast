import { readingDetails } from '$lib/reading/query.server';
import { getDb } from '$lib/server/db';
import { readingWorks } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { removeHistory } from '$lib/sync/history-removal.server';
import { mediaActionData, mediaHistory, mediaActivity } from '$lib/server/queries/media-actions';
import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { AppError } from '$lib/server/security/errors';
import { addLocalSeasonEpisodes } from '$lib/core/media/service.server';
import { getMetadataEditor, getPresentationEditor, saveMetadataOverrides, savePresentationPreference, resetPresentationPreference } from '$lib/catalogue/overrides/service.server';
import { loadMediaDetails } from '$lib/application/media-details.server';
import { detailsData } from '$lib/server/queries/media';
import { refreshMedia } from '$lib/catalogue/service.server';
import { getTrailer } from '$lib/playback/service.server';
import { uuid, type ApiContext } from './context.server';

export async function handleMedia(context: ApiContext): Promise<Response | undefined> {
 const { user, uid, path, method, url, body } = context;
 let result: unknown;
 if (path[0] === 'media') {
      if (path.length === 2 && method === 'GET') {
        const id = uuid(path[1]);
        const [reading] = await getDb().select({kind:readingWorks.kind}).from(readingWorks).where(eq(readingWorks.id,id));
        if (reading) return json({reading:{...await readingDetails(uid,id),kind:reading.kind,remote:false}});
        result = url.searchParams.get('enhance') === 'true'
          ? await (await loadMediaDetails(uid, uuid(path[1]))).enhancement
          : await detailsData(uid, id);
      } else if (path[2] === 'actions' && method === 'GET')
        result = await mediaActionData(uid, uuid(path[1]));
      else if (path[2] === 'activity' && method === 'GET')
        result = await mediaActivity(uid, uuid(path[1]), Number(url.searchParams.get('page') ?? 1));
      else if (path[2] === 'history' && method === 'DELETE')
        result = await removeHistory(uid, uuid(path[1]), body);
      else if (path[2] === 'history' && method === 'GET')
        result = await mediaHistory(uid, uuid(path[1]), Number(url.searchParams.get('page') ?? 1));
      else if (path[2] === 'trailer' && method === 'GET')
        result = { url: await getTrailer(uid, uuid(path[1])) };
      else if (path[2] === 'refresh' && method === 'POST')
        result = await refreshMedia(uuid(path[1]), (user.settings.region as string) || 'GB');
      else if (path[2] === 'episodes' && method === 'POST')
        result = await addLocalSeasonEpisodes(
          uid,
          uuid(path[1]),
          v.parse(v.number(), body.seasonNumber),
          v.parse(v.number(), body.episodeCount)
        );
      else if (path[2] === 'metadata' && method === 'GET')
        result = await getMetadataEditor(uid, uuid(path[1]));
      else if (path[2] === 'metadata' && method === 'POST')
        result = await saveMetadataOverrides(
          uid,
          uuid(path[1]),
          body as Parameters<typeof saveMetadataOverrides>[2]
        );
      else if (path[2] === 'presentation' && method === 'GET')
        result = await getPresentationEditor(uid, uuid(path[1]));
      else if (path[2] === 'presentation' && method === 'POST')
        result = await savePresentationPreference(uid, uuid(path[1]), body);
      else if (path[2] === 'presentation' && method === 'DELETE')
        result = await resetPresentationPreference(uid, uuid(path[1]));
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return json(result ?? { ok: true });
}
