import { profileSectionData, profileInsightsData } from '#lib/server/queries/profile.js';
import { updateProfile } from '#lib/core/profile/service.server.js';
import { loadProfileDetails, loadProfileRow } from '#lib/profile/details.server.js';
import { mediaDetailTarget } from '#lib/media/detail-target.js';
import { AppError } from '#lib/server/security/errors.js';
import { withReadCancellation } from '#lib/server/db/read-cancellation.js';
import { requireFeature } from '#lib/server/features.js';
import { maxTasteBatchSize, type CardTasteResponse } from '#lib/social/card-taste.js';
import { tasteDimensions, tasteMedia } from '#lib/social/taste-profile.js';
import type { TasteScoreMode } from '#lib/social/taste-cache.server.js';

import * as v from 'valibot';
import { uuid, type ApiContext } from './context.server';

const cardTasteIds = v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.minLength(1), v.maxLength(maxTasteBatchSize));

async function cardTasteConfig(uid:string) {
 const config=await requireFeature(uid,'personalisation');
 if (!config.experimentalCardTasteScores)
   throw new AppError(403, 'Taste scores on cards are disabled.', 'feature_disabled');
 return config;
}

async function cardTasteResponse({ uid, url, request }: ApiContext) {
 const ids = v.parse(cardTasteIds, url.searchParams.get('ids')?.split(','));
 return withReadCancellation(request.signal, async () => {
   const config = await cardTasteConfig(uid);
   const {selectedItemMatches}=await import('#lib/social/taste-personal-match.server.js');
   const matches=await selectedItemMatches(uid,ids,false,config);
   const scores:CardTasteResponse['scores']={};
   const pending:string[]=[];
   for(const [id,match] of matches) {
     if(match.score!==null)scores[id]=match.score;
     if(match.pending)pending.push(id);
   }
   return Response.json({ scores, ...(pending.length ? {pending} : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
 });
}

/** Always score against the signed-in viewer, including when inspecting someone else's profile. */
export async function itemTasteResponse({ uid, url, request }: ApiContext, mode: TasteScoreMode = 'published'): Promise<Response> {
 const workId = uuid(url.searchParams.get('workId'));
 const match = await withReadCancellation(request.signal, async () => {
   if (url.searchParams.has('group')) {
     const group = v.parse(v.picklist(['collection', 'reading-group']), url.searchParams.get('group'));
     const { collectionTaste } = await import('#lib/social/collection-taste.server.js');
     return collectionTaste(uid, workId, group, mode);
   }
   const inspect=mode==='recalculate' || url.searchParams.get('breakdown')==='true';
   if (inspect && mode==='published') await cardTasteConfig(uid);
   const {selectedItemMatches}=await import('#lib/social/taste-personal-match.server.js');
   return (await selectedItemMatches(uid,[workId],inspect)).get(workId.toLowerCase())??null;
 });
 return Response.json({ match }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function handleProfile(context: ApiContext): Promise<Response | undefined> {
 const { uid, subjectId, path, method, url, body } = context;
 let result: unknown;
 if(path[0]==='profile' && path[1]==='taste-signals' && path.length===2 && method==='GET') {
   const medium=v.parse(v.picklist(tasteMedia.map(item=>item.value)),url.searchParams.get('medium'));
   const dimension=v.parse(v.picklist([...tasteDimensions,'creators']),url.searchParams.get('dimension')??'genres');
   const page=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(100000)),Number(url.searchParams.get('page')??1));
   const {personalSignalPage}=await import('#lib/social/taste-personal-display.server.js');
   return Response.json(await withReadCancellation(context.request.signal,()=>personalSignalPage(uid,medium,dimension,page)),{headers:{'Cache-Control':'private, no-store'}});
 }
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
 } else if (path[0] === 'profile' && path[1] === 'taste-match' && path.length === 2 && method === 'GET') {
      return itemTasteResponse(context);
 } else if (path[0] === 'profile' && path[1] === 'card-taste' && path.length === 2 && method === 'GET') {
      return cardTasteResponse(context);
 } else if (path[0] === 'profile' && path.length === 1 && method === 'POST') result = await updateProfile(uid, body); else return undefined;
 return Response.json(result ?? { ok: true });
}
