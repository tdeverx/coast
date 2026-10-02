import { profileData, profileActivity } from '$lib/server/queries/profile';
import { updateProfile } from '$lib/core/profile/service';
import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { type ApiContext } from './context.server';

export async function handleProfile(context: ApiContext): Promise<Response | undefined> {
 const { uid, subjectId, path, method, url, body } = context;
 let result: unknown;
 if (path[0] === 'profile' &&
      path[1] === 'activity' &&
      path.length === 2 &&
      method === 'GET') {
      const data = await profileData(
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
      result = { items: data.history, page: data.page, pages: data.pages, total: data.total };
    } else if (path[0] === 'profile' &&
      path[1] === 'section' &&
      path.length === 2 &&
      method === 'GET') {
      const section = v.parse(
        v.picklist(['favourites', 'insights']),
        url.searchParams.get('section')
      );
      const data = await profileData(
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
      result =
        section === 'favourites'
          ? { favourites: data.favourites, page: data.page, pages: data.pages, total: data.total }
          : {
              totals: data.totals,
              activity: await profileActivity(subjectId, new Date(), data.filters.period,uid),
            };
    } else if (path[0] === 'profile' && path.length === 1 && method === 'POST') result = await updateProfile(uid, body); else return undefined;
 return json(result ?? { ok: true });
}
