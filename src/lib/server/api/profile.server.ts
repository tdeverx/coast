import { profileSectionData, profileInsightsData } from '#lib/server/queries/profile.js';
import { updateProfile } from '#lib/core/profile/service.server.js';
import { loadProfileDetails, loadProfileRow } from '#lib/profile/details.server.js';
import { mediaDetailTarget } from '#lib/media/detail-target.js';
import { AppError } from '#lib/server/security/errors.js';
import { withReadCancellation } from '#lib/server/db/read-cancellation.js';
import { tasteDimensions, tasteMedia } from '#lib/social/taste-profile.js';

import * as v from 'valibot';
import { type ApiContext } from './context.server';

export async function handleProfile(context: ApiContext): Promise<Response | undefined> {
 const { uid, subjectId, path, method, url, body } = context;
 let result: unknown;
 if (path[0] === 'profile' && path[1] === 'presentation' && path.length === 2 && method === 'GET') {
      const target = mediaDetailTarget(url.searchParams.get('href') ?? '', url);
      if (target?.kind !== 'profile') throw new AppError(400, 'Choose a valid profile link.');
      const destination = new URL(target.href, url);
      const row = await loadProfileRow(target.username, uid, destination, context.request.signal);
      if (row) return Response.json({ kind: 'row', data: row });
      const { activity, ...data } = await loadProfileDetails(target.username, uid, destination, context.request.signal);
      const stats = await activity;
      context.request.signal.throwIfAborted();
      result = { kind: 'profile', data: { ...data, activity: stats } };
    } else if (path[0] === 'profile' &&
      path[1] === 'activity' &&
      path.length === 2 &&
      method === 'GET') {
      result = await profileSectionData(
        subjectId,
        {
          view: 'history',
          page: Number(url.searchParams.get('page') ?? 1),
          period: url.searchParams.get('period') ?? 'all',
          query: url.searchParams.get('query') ?? '',
          activityKind: url.searchParams.get('activityKind') ?? 'all',
          repeats: url.searchParams.get('repeats') === 'true',
          genre: url.searchParams.get('genre') ?? undefined,
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
        },
        new Date(),
        uid
      );
    } else if (path[0] === 'profile' &&
      path[1] === 'section' &&
      path.length === 2 &&
      method === 'GET') {
      const section = v.parse(
        v.picklist(['favourites', 'insights']),
        url.searchParams.get('section')
      );
      const read = section === 'insights' ? profileInsightsData : profileSectionData;
      result = await read(
        subjectId,
        {
          scope: url.searchParams.get('scope') ?? 'all',
          page: Number(url.searchParams.get('page') ?? 1),
          view: section === 'favourites' ? 'favourites' : 'overview',
          kind: url.searchParams.get('kind') ?? 'all',
          period: url.searchParams.get('period') ?? 'all',
        },
        new Date(),
        uid
      );
 } else if (path[0] === 'profile' && path[1] === 'taste-affinities' && path.length === 2 && method === 'GET') {
      const medium = v.parse(v.picklist(tasteMedia.map(({value})=>value)),url.searchParams.get('medium'));
      const dimension = v.parse(v.picklist(tasteDimensions),url.searchParams.get('dimension'));
      const page = v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(20)),Number(url.searchParams.get('page')??1));
      const {personalTasteAffinities}=await import('#lib/social/taste-cache.server.js');
      return Response.json(await withReadCancellation(context.request.signal,()=>personalTasteAffinities(uid,medium,dimension,page)));
 } else if (path[0] === 'profile' && path[1] === 'taste-match' && path.length === 2 && method === 'GET') {
      const workId = v.parse(v.pipe(v.string(), v.uuid()), url.searchParams.get('workId'));
      const { titleTaste } = await import('#lib/social/taste-cache.server.js');
      return Response.json({ match: await withReadCancellation(context.request.signal, () => titleTaste(uid, workId)) });
 } else if (path[0] === 'profile' && path.length === 1 && method === 'POST') result = await updateProfile(uid, body); else return undefined;
 return Response.json(result ?? { ok: true });
}
