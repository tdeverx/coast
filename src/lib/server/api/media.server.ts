import { requireFeature } from '#lib/server/features.js';
import { readingDetails } from '#lib/reading/query.server.js';
import { getDb } from '#lib/server/db/index.js';
import { readingWorks } from '#lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { removeHistory } from '#lib/sync/history-removal.server.js';
import { mediaActionData, mediaHistory, mediaActivity } from '#lib/server/queries/media-actions.js';

import * as v from 'valibot';
import { AppError } from '#lib/server/security/errors.js';
import { addLocalSeasonEpisodes } from '#lib/core/media/service.server.js';
import { getMetadataEditor, getPresentationEditor, saveMetadataOverrides, savePresentationPreference, resetPresentationPreference } from '#lib/catalogue/overrides/service.server.js';
import { loadMediaDetails } from '#lib/application/media-details.server.js';
import { mediaViews,mediaViewsForIds, nextPlayable, detailsData } from '#lib/server/queries/media.js';
import { refreshMedia } from '#lib/catalogue/service.server.js';
import { getTrailer } from '#lib/playback/service.server.js';
import { uuid, type ApiContext } from './context.server';
import {mediaDetailData} from '#lib/application/work-details.server.js';
import { showNext } from '#lib/server/queries/show-next.js';

export async function handleMedia(context: ApiContext): Promise<Response | undefined> {
 const { user, uid, path, method, url, body } = context;
 let result: unknown;
 if (path[0] === 'media') {
      if(path.length===2&&path[1]==='details'&&method==='GET'){
        const href=v.parse(v.pipe(v.string(),v.minLength(1),v.maxLength(2048)),url.searchParams.get('href'));
        return Response.json(await mediaDetailData(uid,href,context.request.signal,url.searchParams.get('enhance')==='true'));
      }
      if(path.length===3&&path[2]==='edition'&&method==='GET'){
        const editionName=v.parse(v.pipe(v.string(),v.minLength(1),v.maxLength(500)),url.searchParams.get('name'));
        const [item]=await mediaViews(uid,{ids:[uuid(path[1])],editionName});
        if(!item)throw new AppError(404,'This title was not found.');
        return Response.json(item);
      }
      if (path.length === 2 && method === 'GET') {
        const id = uuid(path[1]);
        const [reading] = await getDb().select({kind:readingWorks.kind}).from(readingWorks).where(eq(readingWorks.id,id));
        if (reading) return Response.json({reading:{...await readingDetails(uid,id),kind:reading.kind,remote:false}});
        result = url.searchParams.get('enhance') === 'true'
          ? await (await loadMediaDetails(uid, uuid(path[1]), context.request.signal)).enhancement
          : await detailsData(uid, id);
      } else if (path[2] === 'playable' && path.length === 3 && method === 'GET') {
        const [item] = await mediaViewsForIds(uid, [uuid(path[1])]);
        if (!item) throw new AppError(404, 'This title was not found.');
        result = { next: item.available ? await nextPlayable(uid, item) : null };
      } else if (path[2] === 'next' && path.length === 3 && method === 'GET')
        result = await showNext(uid, uuid(path[1]), url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined, url.searchParams.get('available') === 'true', url.searchParams.get('specials') === 'true');
      else if (path[2] === 'actions' && method === 'GET')
        result = await mediaActionData(uid, uuid(path[1]));
      else if (path[2] === 'activity' && method === 'GET')
        result = await mediaActivity(uid, uuid(path[1]), Number(url.searchParams.get('page') ?? 1));
      else if (path[2] === 'history' && method === 'DELETE')
        result = await removeHistory(uid, uuid(path[1]), body);
      else if (path[2] === 'history' && method === 'GET')
        result = await mediaHistory(uid, uuid(path[1]), Number(url.searchParams.get('page') ?? 1));
      else if (path[2] === 'trailer' && method === 'GET')
        result = await getTrailer(uid, uuid(path[1]),context.request.signal);
      else if (path[2] === 'refresh' && method === 'POST') {
        await requireFeature(uid,'screen');
        result = await refreshMedia(uuid(path[1]), (user.settings.region as string) || 'GB');
      }
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
 return Response.json(result ?? { ok: true });
}
