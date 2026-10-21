const dev=import.meta.env.DEV;
import {progressExperimentData} from '#lib/server/queries/progress-experiment.js';
import {progressExperimentParameters} from '#lib/progress-experiment.js';
import {recentLibraryData} from '#lib/server/queries/recent-library.js';
import { requestedPageInterval } from '#lib/server/queries/pagination.js';
import { getFeatureConfig, requireFeature } from '#lib/server/features.js';
import { readJsonBody as readBody } from '#lib/server/security/request-body.js';
import {databaseReady} from '#lib/server/readiness.js';
import { ProviderHttpError } from '#lib/server/security/provider-fetch.js';
import { providerApiError } from '#lib/server/security/provider-api-error.js';
import { provisioningAuthority } from '#lib/providers/jellyfin/provisioning.server.js';
import { createShare,listShares,revokeShare } from '#lib/sharing/service.server.js';
import { planningData,createPlan,cancelPlan,completePlan } from '#lib/experiments/planning.server.js';
import { dynamicFeed } from '#lib/recommendations/feed.server.js';
import { recommendationRows } from '#lib/recommendations/query.server.js';
import {playbackBackground} from '#lib/media/artwork.js';
import { uuid, text } from './context.server';
import * as synced from '#lib/playback/synced/service.server.js';
import { createInvite, listInvites, revokeInvite } from '#lib/server/auth/onboarding.js';
import { isPublicReadPath } from '#lib/social/public.server.js';
import { profileAvatarChoices, providerProfileAvatar } from '#lib/core/profile/avatars.server.js';
import { avatarRequestLimit, streamAvatar } from '#lib/core/profile/avatar-storage.server.js';
import * as social from '#lib/social/service.server.js';
import { activityFeed, workSocial,reactionSummary } from '#lib/social/queries.server.js';
import { friendInsights, friendDiscovery } from '#lib/social/insights.server.js';
import { requireVisible } from '#lib/social/privacy.server.js';
import { previewProjection, approveProjection, reviewProjection } from '#lib/collection/projection.server.js';
import { previewSourceChange } from '#lib/collection/source-changes.server.js';
import { musicQueue, savedMusicQueue, savedMusicQueuePage } from '#lib/music/queue.server.js';
import { collectionData, collectionParameters, workActionData, workActionLists, workCards } from '#lib/collection/query.server.js';
import { missingDemand, adminDemand } from '#lib/collection/demand.server.js';
import { musicHistory } from '#lib/music/history.server.js';
import {musicChildren} from '#lib/music/details.server.js';
import { logMusic } from '#lib/music/persistence.server.js';
import { logDiagnostic, classifyFailure } from '#lib/server/diagnostics/index.js';
import { discoveryContent, discoveryParameters } from '#lib/server/queries/discovery.js';
import { libraryContent } from '#lib/server/queries/library-content.js';
import { sequenceSourceSchema } from '#lib/media/sequence.js';
import { isHeroTitle } from '#lib/media/hero.js';
import { mediaViewsForIds, sequenceNextView } from '#lib/server/queries/media.js';
import { profileUser } from '#lib/server/queries/profile-user.js';
import { progressData } from '#lib/server/queries/progress.js';
import { progressParameters } from '#lib/progress.js';
import { listsData } from '#lib/server/queries/lists.js';
import { profileSectionData, profileInsightsData } from '#lib/server/queries/profile.js';
import { fallbackArtwork } from '#lib/providers/tmdb/fallback.server.js';
import { streamTmdbArtwork } from '#lib/providers/tmdb/artwork.server.js';
import { isHttpError, type RequestHandler } from '@sveltejs/kit';
import * as v from 'valibot';
import { getDb, getSql } from '#lib/server/db/index.js';
import { requireUser, requireAdmin } from '#lib/server/auth/index.js';
import { works } from '#lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireEnabledCategory } from '#lib/server/experimental.js';
import { getConfig } from '#lib/server/config.js';
import { AppError } from '#lib/server/security/errors.js';
import { DomainError } from '#lib/core/errors.js';
import { ProviderActionError } from '#lib/providers/contracts.js';
import { trackWithExports } from '#lib/sync/changes.server.js';
import { updateJellyfinReconciliation } from '#lib/providers/jellyfin/connection.server.js';
import { playbackDetails, streamPlayback, streamTrailer } from '#lib/playback/service.server.js';
import { streamArtwork } from '#lib/providers/artwork.server.js';
import { handleUpNext } from './up-next.server';
import { handleGames } from './games.server';
import { handleReading } from './reading.server';
import { handleGamePlaythroughs } from './game-playthroughs.server';
import { handleSession } from './session.server';
import { handleProfile } from './profile.server';
import { handleContinue } from './continue.server';
import { handleRewatch } from './rewatch.server';
import { handleTracking } from './tracking.server';
import { handleRatings } from './ratings.server';
import { handleMedia } from './media.server';
import { handleLists } from './lists.server';
import { handleProviders } from './providers.server';
import { handleRequests } from './requests.server';
import { handlePlayback } from './playback.server';
import { handleNotifications } from './notifications.server';
import { handleConflicts } from './conflicts.server';
import { handleQueue } from './queue.server';
import { handleSettings } from './settings.server';
import { handleAdmin } from './admin.server';

export const handler: RequestHandler = async (event) => {
  const { request, url, locals } = event;
  const path = (event.params.path ?? '').split('/');
  const method = request.method;
  try {
    if (path[0] === 'health' && method === 'GET') {
      const ready=await databaseReady();
      return Response.json({status:ready?'healthy':'unavailable'}, {status:ready?200:503, headers:{'Cache-Control':'no-store'}});
    }
    if(path[0]==='profile'&&path[1]==='avatar'&&path.length===4&&method==='GET')
      return await streamAvatar(uuid(path[2]),path[3],locals.user?.id??null);
    if(!locals.user && method==='GET' && isPublicReadPath(url.pathname,'public-read-only') && isPublicReadPath(url.pathname,(await getConfig()).siteAccess)) {
      if(path[0]==='artwork'&&path[1]==='tmdb')return streamTmdbArtwork(path[2],path[3],request);
      if(path[0]==='profile' && ['section','activity'].includes(path[1]) && url.searchParams.has('username')) {
        const owner=await profileUser(url.searchParams.get('username')!);
        const section=path[1]==='activity'?'activity':v.parse(v.picklist(['favourites','insights']),url.searchParams.get('section'));
        if(section!=='favourites')await requireVisible(owner.id,null,section,'screen');
        const options={view:section==='activity'?'history':section==='favourites'?'favourites':'overview',page:Number(url.searchParams.get('page')??1),period:url.searchParams.get('period')??'all',kind:url.searchParams.get('kind')??'all'};
        if(section==='insights')return Response.json(await profileInsightsData(owner.id,options,new Date(),null));
        return Response.json(await profileSectionData(owner.id,options,new Date(),null));
      }
    }
    const user = requireUser(locals.user),
      uid = user.id;
    const subjectId =
      method === 'GET' &&
      ['progress', 'profile', 'collection'].includes(path[0]) &&
      url.searchParams.has('username')
        ? (await profileUser(url.searchParams.get('username')!)).id
        : uid;
    if(path[0]==='admin' && path[1]==='invites') {
      if(path.length===3&&path[2]==='libraries'&&method==='GET'){requireAdmin(user);const context=await provisioningAuthority(uid,uuid(url.searchParams.get('connectionId')??''));return Response.json(await context.adapter.virtualFolders());}
      if(method==='GET')return Response.json(await listInvites(user));
      if(method==='POST')return Response.json(await createInvite(user,await readBody(request)));
      if(method==='DELETE'&&path[2]){await revokeInvite(user,uuid(path[2]));return Response.json({revoked:true});}
    }
    if(path[0]==='sharing') {
      if(path.length===1&&method==='GET')return Response.json(await listShares(user));
      if(path.length===1&&method==='POST')return Response.json(await createShare(user,await readBody(request)));
      if(path.length===2&&method==='DELETE'){await revokeShare(user,path[1]);return Response.json({revoked:true});}
      if(path.length===2&&path[1]==='sources'&&method==='GET'){await requireFeature(uid,'sharing');const workId=uuid(url.searchParams.get('workId')??'');return Response.json(await getSql()`select distinct c.id,i.name from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id where a.user_id=${uid} and a.media_id=${workId} and a.state='available' and c.status='connected' and i.enabled and exists(select 1 from works where id=${workId}::uuid and coast_category_enabled(${uid}::uuid,category))`);}
    }
    if(path[0]==='planning'){if(method==='POST'&&path.length===3&&path[2]==='complete')return Response.json(await completePlan(uid,path[1]));if(path.length===1&&method==='GET')return Response.json(await planningData(uid,url));if(path.length===1&&method==='POST')return Response.json(await createPlan(uid,await readBody(request)));if(method==='DELETE'&&path.length===2)return Response.json(await cancelPlan(uid,path[1]));}
    if(path[0]==='experiments'&&path.length===2&&method==='GET')return Response.json(await (path[1]==='feed'?dynamicFeed(uid,url):recommendationRows(uid,path[1],url)));
    if(path[0]==='synced') {
      if(path.length===1&&method==='GET'){
        const rooms=await synced.listRooms(uid),hosts=await social.friends(uid,1,'accepted',[...new Set(rooms.filter(room=>room.hostId!==uid).map(room=>room.hostId))]);
        const cards=await workCards(uid,uid,[...new Set(rooms.flatMap(room=>room.mediaId?[room.mediaId]:[]))]);
        const details=await playbackDetails(cards);
        return Response.json(rooms.map(room=>{const friend=hosts.find(host=>host.userId===room.hostId),card=cards.find(card=>('workId' in card?card.workId??card.id:card.id)===room.mediaId);return {...room,backgroundArtwork:room.mediaId&&card?playbackBackground(card):undefined,playingItem:card?{...card,captionSubtitle:details.get(card.id)}:null,nowPlaying:room.mediaId?card?.title??'Unknown title':null,friend:friend??null};}));
      }
      if(path.length===1&&method==='POST')return Response.json(await synced.createRoom(uid,await readBody(request)));
      const id=uuid(path[1]);
      if(path.length===2&&method==='GET')return Response.json(await synced.roomState(uid,id));
      if(path[2]==='media'&&method==='GET'){const room=await synced.roomState(uid,id);const cards=room.mediaId?await workCards(uid,uid,[room.mediaId]):[],card=cards[0];const details=await playbackDetails(cards);return Response.json(card?{...card,captionSubtitle:details.get(card.id)}:null);}
      if(method==='POST') {
        const body=await readBody(request);
        if(path[2]==='heartbeat')return Response.json(await synced.roomState(uid,id,body));
        if(path[2]==='join')return Response.json(await synced.joinRoom(uid,id,body));
        if(path[2]==='invite')return Response.json(await synced.inviteParticipant(uid,id,body));
        if(path[2]==='command')return Response.json(await synced.commandRoom(uid,id,body));
        if(path[2]==='decline')return Response.json(await synced.declineInvitation(uid,id));
        if(path[2]==='leave')return Response.json(await synced.leaveRoom(uid,id));
      }
    }
    if(path[0]==='profile'&&path[1]==='avatars'&&method==='GET')return path[2]?await providerProfileAvatar(uid,uuid(path[2]),request):Response.json(await profileAvatarChoices(uid));
    if(path[0]==='social') {
      const action=path[1], id=path[2], page=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(100000)),Number(url.searchParams.get('page')??1));
      if(method==='GET') {
        if(action==='friends'){
          const roster=await social.friends(uid,page,v.parse(v.picklist(['all','accepted','pending']),url.searchParams.get('state')??'all'));
          const cards=await workCards(uid,uid,[...new Set(roster.flatMap(friend=>friend.backgroundWorkId?[friend.backgroundWorkId]:[]))]);
          return Response.json(roster.map(friend=>{const card=cards.find(card=>('workId' in card?card.workId??card.id:card.id)===friend.backgroundWorkId);return {...friend,backgroundArtwork:card?.backdrop||card?.poster};}));
        }
        if(action==='feed')return Response.json(await activityFeed(uid,Object.fromEntries(url.searchParams)));
        if(action==='popular'){
          const category=v.parse(v.picklist(['all','screen','game','music','reading']),url.searchParams.get('category')??'screen');
          const ranked=await friendDiscovery(uid,category),cards=await workCards(uid,uid,ranked.map(row=>row.workId));
          return Response.json({items:ranked.flatMap(row=>{const item=cards.find(card=>card.id===row.workId);return item?[{...item,captionSubtitle:`${row.friends} ${row.friends===1?'friend':'friends'}`}]:[];}),hasMore:false,next:null});
        }
        if(action==='reactions')return Response.json(await reactionSummary(uid,v.parse(v.picklist(['work','activity']),url.searchParams.get('targetKind')),(url.searchParams.get('ids')??'').split(',').filter(Boolean)));
        if(action==='works'&&path.length===2)return Response.json(await workSocial(uid,(url.searchParams.get('ids')??'').split(',').filter(Boolean)));
        if(action==='recommendations')return Response.json(await social.recommendations(uid,page,url.searchParams.get('available')==='true'));
        if(action==='insights')return Response.json(url.searchParams.has('friendId')?await friendInsights(uid,uuid(url.searchParams.get('friendId'))):await friendDiscovery(uid));
        if(action==='checkins'){
          const live=await (await import('#lib/social/presence.server.js')).presence(uid);
          const cards=await workCards(uid,uid,live.map((item:{workId:string})=>item.workId));
          return Response.json(live.map((item:{workId:string;category:string})=>{const card=cards.find(card=>('workId' in card?card.workId??card.id:card.id)===item.workId);return {...item,artwork:card?.backdrop||card?.poster};}));
        }
      } else if(method==='POST') {
        const input=await readBody(request);
        if(action==='friends')return Response.json(id?await social.changeFriend(uid,uuid(id),input):await social.requestFriend(uid,input));
        if(action==='reactions')return Response.json(await social.react(uid,input));
        if(action==='recommendations')return Response.json(id?await social.respondRecommendation(uid,uuid(id),input):await social.recommend(uid,input));
        if(action==='checkins')return Response.json(id?await (await import('#lib/social/presence.server.js')).cancelCheckin(uid,uuid(id)):await (await import('#lib/social/presence.server.js')).startCheckin(uid,input));
      }
      throw new AppError(404,'Social action not found.');
    }
    // Collection, Progress and mixed favourites enforce actual category privacy in their read models.
    if(subjectId!==uid && !['collection','progress'].includes(path[0]) && !(path[0]==='profile'&&path[1]==='section'&&url.searchParams.get('section')==='favourites'))
      await requireVisible(subjectId,uid,path[1]==='activity'?'activity':'insights','screen');
    if(path[0]==='music' && path[2]==='children' && path.length===3 && method==='GET')return Response.json(await musicChildren(uid,path[1],url,request.signal));
    if(path[0]==='music' && path[2]==='history' && path.length===3 && method==='GET')return Response.json(await musicHistory(uid,uuid(path[1]),Number(url.searchParams.get('page')??1)));
    if(path[0]==='music' && path[2]==='queue' && method==='GET') return Response.json(await musicQueue(uid,uuid(path[1])));
    if(path[0]==='music' && path[1]==='queue' && path[2]==='picker' && path.length===3 && method==='GET')return Response.json(await savedMusicQueuePage(uid,Number(url.searchParams.get('page')??1)));
    if(path[0]==='music' && path[1]==='queue' && path.length===2 && method==='GET')return Response.json(await savedMusicQueue(uid,url.searchParams.has('listId')?uuid(url.searchParams.get('listId')):undefined));
    if (path[0] === 'collection' && path.length === 1 && method === 'GET') return Response.json(await collectionData(uid,collectionParameters(url),url.searchParams.get('username')??undefined,requestedPageInterval(Number(url.searchParams.get('page')??1),url.searchParams.get('firstPage')),request.signal));
    if (path[0] === 'collection' && path[1] && (path.length === 2 || path.length === 3 && path[2] === 'lists') && method === 'GET') {
      const [work]=await getDb().select().from(works).where(eq(works.id,uuid(path[1])));if(!work)throw new AppError(404,'This work was not found.');requireEnabledCategory(await getFeatureConfig(uid),work.category);
      if (path[2] === 'lists') return Response.json(await workActionLists(uid, uuid(path[1]), Number(url.searchParams.get('page') ?? 1), url.searchParams.get('reading') === 'true'));
      return Response.json(await workActionData(uid,uuid(path[1]),url.searchParams.has('playthrough')?uuid(url.searchParams.get('playthrough')):undefined));
    }
    if (path[0] === 'missing' && method === 'GET') return Response.json(await missingDemand(uid,url));
    if (path[0] === 'admin' && path[1] === 'demand' && method === 'GET') { requireAdmin(user); return Response.json(await adminDemand(url)); }
    if(path[0]==='providers'&&path[2]==='source-preview'&&method==='GET')return Response.json(await previewSourceChange(uid,uuid(path[1]),'connection'));
    if(path[0]==='providers'&&path[2]==='instance-source-preview'&&method==='GET'){requireAdmin(user);return Response.json(await previewSourceChange(uid,uuid(path[1]),'instance'));}
    if (path[0] === 'heroes' && path.length === 1 && method === 'GET') {
      const ids = v.parse(
        v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.maxLength(60)),
        (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
      );
      return Response.json((await mediaViewsForIds(uid, ids)).filter(isHeroTitle));
    }
    if (path[0] === 'sequence' && path.length === 1 && method === 'GET') {
      const source = v.parse(sequenceSourceSchema, {
        kind: url.searchParams.get('kind'),
        id: url.searchParams.get('id'),
      });
      return Response.json({
        next: await sequenceNextView(
          uid,
          source,
          url.searchParams.get('after') ?? undefined,
          url.searchParams.get('from') ?? undefined
        ),
      });
    }
    if(path[0]==='discover' && path.length===1 && method==='GET')return Response.json(await discoveryContent(uid,discoveryParameters(url)));
    if (path[0] === 'library' && path.length === 1 && method === 'GET')
      return Response.json(await libraryContent(uid, url,request.signal));
    if(path[0]==='library'&&path[1]==='recent'&&path.length===2&&method==='GET')
      return Response.json(await recentLibraryData(uid,{kind:url.searchParams.get('kind')??undefined,page:url.searchParams.has('page')?Number(url.searchParams.get('page')):undefined,preview:url.searchParams.get('preview')==='true'},request.signal));
    if (dev && path[0] === 'progress' && path[1] === 'experiment' && path.length === 2 && method === 'GET') {
      return Response.json(await progressExperimentData(subjectId,progressExperimentParameters(url),{preview:url.searchParams.get('preview')==='true',signal:request.signal,viewerId:uid}));
    }
    if (path[0] === 'progress' && path.length === 1 && method === 'GET')
      return Response.json(await progressData(subjectId, progressParameters(url), uid));
    if (path[0] === 'lists' && path[1] === 'content' && path.length === 2 && method === 'GET')
      return Response.json(
        await listsData(uid, {
          view: url.searchParams.get('view') ?? 'watchlist',
          scope: url.searchParams.get('scope') ?? 'all',
          filter: url.searchParams.get('filter') ?? 'to-watch',
          kind: url.searchParams.get('kind') ?? 'all',
          page: Number(url.searchParams.get('page') ?? 1),
        })
      );
    if (path[0] === 'playback' && path[2] === 'stream' && method === 'GET')
      return await streamPlayback(uid, uuid(path[1]), request);
    if (path[0] === 'trailer' && method === 'GET')
      return await streamTrailer(uid, uuid(path[1]), request);
    if (path[0] === 'artwork' && path[1] === 'tmdb' && path.length === 4 && method === 'GET')
      return streamTmdbArtwork(text(path[2]), text(path[3]), request);
    if (path[0] === 'artwork' && path[1] === 'fallback' && path.length === 4 && method === 'GET') {
      await requireFeature(uid,'screen');
      return fallbackArtwork(uuid(path[2]), text(path[3]));
    }
    if (path[0] === 'artwork' && method === 'GET')
      return streamArtwork(uid, uuid(path[1]), text(path[2]), text(path[3]), request);
    const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await readBody(request, path[0]==='profile'&&path.length===1&&method==='POST'?avatarRequestLimit:1_048_576) : {};
    const relationshipWork=path[0]==='collection'&&path.length===2?path[1]:['tracking','ratings','up-next','lists'].includes(path[0])?body.mediaId:undefined;
    if(relationshipWork){const [work]=await getDb().select().from(works).where(eq(works.id,uuid(relationshipWork)));if(!work)throw new AppError(404,'This work was not found.');requireEnabledCategory(await getFeatureConfig(uid),work.category);}
    if(path[0]==='providers' && path[2]==='reconciliation' && method==='POST') return Response.json(await updateJellyfinReconciliation(uid,uuid(path[1]),body));
    if(path[0]==='providers'&&path[2]==='collection-preview'&&method==='POST')return Response.json(await previewProjection(uid,uuid(path[1]),body));
    if(path[0]==='providers'&&path[2]==='collection-approve'&&method==='POST')return Response.json(await approveProjection(uid,uuid(path[1]),body));
    if(path[0]==='providers'&&path[2]==='collection-review'&&method==='POST')return Response.json(await reviewProjection(uid,uuid(path[1]),body));
    if(path[0]==='collection' && path.length===2 && method==='POST') {
      const data=v.parse(v.object({collected:v.boolean()}),body);
      return Response.json(await trackWithExports(uid,{mediaId:uuid(path[1]),action:'collect',value:data.collected}));
    }
    if(path[0]==='music' && path[1] && path[2]==='log' && method==='POST') return Response.json(await logMusic(uid,uuid(path[1]),body));

    const context = { path, method, url, user, uid, subjectId, body, request, locals };
    for (const dispatch of [handleUpNext, handleGames, handleReading, handleGamePlaythroughs, handleSession, handleProfile, handleContinue, handleRewatch, handleTracking, handleRatings, handleMedia, handleLists, handleProviders, handleRequests, handlePlayback, handleNotifications, handleConflicts, handleQueue, handleSettings, handleAdmin]) {
      const response = await dispatch(context);
      if (response) return response;
    }
    throw new AppError(404, 'Action not found.');
  } catch (error) {
    // Closing or replacing a player cancels its relay request. This is not an outage.
    if (request.signal.aborted && classifyFailure(error) === 'aborted')
      return new Response(null, { status: 499 });
    if (v.isValiError(error))
      return Response.json(
        { error: error.issues[0]?.message ?? 'Check the supplied values.', code: 'invalid_input' },
        { status: 400 }
      );
    if (error instanceof AppError || error instanceof DomainError)
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    if (isHttpError(error))
      return Response.json({ error: error.body.message, code: 'request_failed' }, { status: error.status });
    if (error instanceof ProviderActionError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.code === 'permission' ? 403 : 400 }
      );
    if(error instanceof ProviderHttpError){
      const failure=providerApiError(error);
      return Response.json(failure.body,{status:failure.status,headers:failure.headers});
    }
    void logDiagnostic('error', path[0] === 'playback' ? 'playback.failed' : 'application.failed', { failure: classifyFailure(error) });
    return Response.json(
      {
        code: 'service_unavailable',
        error:
          path[0] === 'playback'
            ? 'Playback could not start. Please try again.'
            : 'This action could not be completed. Please try again.',
      },
      { status: 503 }
    );
  }
};
