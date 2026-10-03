import { readJsonBody as readBody } from '$lib/server/security/request-body';
import { provisioningAuthority } from '$lib/providers/jellyfin/provisioning.server';
import { createShare,listShares,revokeShare } from '$lib/sharing/service.server';
import { planningData,createPlan,cancelPlan,completePlan } from '$lib/experiments/planning.server';
import { dynamicFeed } from '$lib/experiments/dynamic.server';
import { experimentalRows } from '$lib/experiments/recommendations.server';
import {playbackBackground} from '$lib/ui/artwork-priority';
import { uuid, text } from './context.server';
import * as synced from '$lib/playback/synced/service.server';
import { createInvite, listInvites, revokeInvite } from '$lib/server/auth/onboarding';
import { isPublicReadPath } from '$lib/social/public.server';
import { profileAvatarChoices, providerProfileAvatar } from '$lib/core/profile/avatars.server';
import { avatarRequestLimit, streamGifAvatar } from '$lib/core/profile/gif-avatar.server';
import * as social from '$lib/social/service.server';
import { activityFeed, workSocial, reactionSummary } from '$lib/social/queries.server';
import { friendInsights, friendDiscovery } from '$lib/social/insights.server';
import { requireVisible } from '$lib/social/privacy.server';
import { previewProjection, approveProjection, reviewProjection } from '$lib/collection/projection.server';
import { previewSourceChange } from '$lib/collection/source-changes.server';
import { musicQueue, savedMusicQueue } from '$lib/music/queue.server';
import { collectionData, collectionParameters, workActionData, workCards } from '$lib/collection/query.server';
import { missingDemand, adminDemand } from '$lib/collection/demand.server';
import { logMusic } from '$lib/music/persistence.server';
import { logDiagnostic, classifyFailure } from '$lib/server/diagnostics';
import { discoveryContent, discoveryParameters } from '$lib/server/queries/discovery';
import { libraryContent } from '$lib/server/queries/library-content';
import { sequenceSourceSchema } from '$lib/media/sequence';
import { isHeroTitle } from '$lib/media/hero';
import { mediaViewsForIds, sequenceNextView } from '$lib/server/queries/media';
import { profileUser } from '$lib/server/queries/profile-user';
import { progressData } from '$lib/server/queries/progress';
import { progressParameters } from '$lib/progress';
import { listsData } from '$lib/server/queries/lists';
import { profileData, profileActivity } from '$lib/server/queries/profile';
import { fallbackArtwork } from '$lib/providers/tmdb/fallback.server';
import { streamTmdbArtwork } from '$lib/providers/tmdb/artwork.server';
import { json, type RequestHandler } from '@sveltejs/kit';
import * as v from 'valibot';
import { getDb, getSql } from '$lib/server/db';
import { requireUser, requireAdmin } from '$lib/server/auth';
import { works } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireEnabledCategory } from '$lib/server/experimental';
import { getConfig } from '$lib/server/config';
import { AppError } from '$lib/server/security/errors';
import { DomainError } from '$lib/core/errors';
import { ProviderActionError } from '$lib/providers/contracts';
import { trackWithExports } from '$lib/sync/changes';
import { updateJellyfinReconciliation } from '$lib/providers/jellyfin/connection.server';
import { playbackDetails, streamPlayback, streamTrailer } from '$lib/playback/server';
import { streamArtwork } from '$lib/providers/artwork.server';
import { handleUpNext } from './up-next.server';
import { handleGames } from './games.server';
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
      await getSql()`select 1`;
      return json({ status: 'healthy' });
    }
    if(path[0]==='profile'&&path[1]==='avatar'&&path.length===4&&method==='GET')
      return await streamGifAvatar(uuid(path[2]),path[3],locals.user?.id??null);
    if(!locals.user && method==='GET' && isPublicReadPath(url.pathname,'public-read-only') && isPublicReadPath(url.pathname,(await getConfig()).siteAccess)) {
      if(path[0]==='artwork'&&path[1]==='tmdb')return streamTmdbArtwork(path[2],path[3],request);
      if(path[0]==='profile' && ['section','activity'].includes(path[1]) && url.searchParams.has('username')) {
        const owner=await profileUser(url.searchParams.get('username')!);
        const section=path[1]==='activity'?'activity':v.parse(v.picklist(['favourites','insights']),url.searchParams.get('section'));
        await requireVisible(owner.id,null,section,'screen');
        const data=await profileData(owner.id,{view:section==='activity'?'history':section==='favourites'?'favourites':'overview',page:Number(url.searchParams.get('page')??1),period:url.searchParams.get('period')??'all',kind:url.searchParams.get('kind')??'all'},new Date(),null);
        return json(section==='activity'?{items:data.history,page:data.page,pages:data.pages,total:data.total}:section==='favourites'?{favourites:data.favourites,page:data.page,pages:data.pages,total:data.total}:{totals:data.totals,activity:await profileActivity(owner.id,new Date(),data.filters.period,null)});
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
      if(path.length===3&&path[2]==='libraries'&&method==='GET'){requireAdmin(user);const context=await provisioningAuthority(uid,uuid(url.searchParams.get('connectionId')??''));return json(await context.adapter.virtualFolders());}
      if(method==='GET')return json(await listInvites(user));
      if(method==='POST')return json(await createInvite(user,await readBody(request)));
      if(method==='DELETE'&&path[2]){await revokeInvite(user,uuid(path[2]));return json({revoked:true});}
    }
    if(path[0]==='sharing') {
      if(path.length===1&&method==='GET')return json(await listShares(user));
      if(path.length===1&&method==='POST')return json(await createShare(user,await readBody(request)));
      if(path.length===2&&method==='DELETE'){await revokeShare(user,path[1]);return json({revoked:true});}
      if(path.length===2&&path[1]==='sources'&&method==='GET'){const workId=uuid(url.searchParams.get('workId')??'');return json(await getSql()`select distinct c.id,i.name from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id where a.user_id=${uid} and a.media_id=${workId} and a.state='available' and c.status='connected' and i.enabled`);}
    }
    if(path[0]==='planning'){if(method==='POST'&&path.length===3&&path[2]==='complete')return json(await completePlan(uid,path[1]));if(path.length===1&&method==='GET')return json(await planningData(uid,url));if(path.length===1&&method==='POST')return json(await createPlan(uid,await readBody(request)));if(method==='DELETE'&&path.length===2)return json(await cancelPlan(uid,path[1]));}
    if(path[0]==='experiments'&&path.length===2&&method==='GET')return json(await (path[1]==='feed'?dynamicFeed(uid,url):experimentalRows(uid,path[1],url)));
    if(path[0]==='synced') {
      if(path.length===1&&method==='GET'){
        const rooms=await synced.listRooms(uid),hosts=await social.friends(uid,1,'accepted',[...new Set(rooms.filter(room=>room.hostId!==uid).map(room=>room.hostId))]);
        const cards=await workCards(uid,uid,[...new Set(rooms.flatMap(room=>room.mediaId?[room.mediaId]:[]))]);
        const details=await playbackDetails(cards);
        return json(rooms.map(room=>{const friend=hosts.find(host=>host.userId===room.hostId),card=cards.find(card=>('workId' in card?card.workId??card.id:card.id)===room.mediaId);return {...room,backgroundArtwork:room.mediaId&&card?playbackBackground(card):undefined,playingItem:card?{...card,captionSubtitle:details.get(card.id)}:null,nowPlaying:room.mediaId?card?.title??'Unknown title':null,friend:friend??null};}));
      }
      if(path.length===1&&method==='POST')return json(await synced.createRoom(uid,await readBody(request)));
      const id=uuid(path[1]);
      if(path.length===2&&method==='GET')return json(await synced.roomState(uid,id));
      if(path[2]==='media'&&method==='GET'){const room=await synced.roomState(uid,id);const cards=room.mediaId?await workCards(uid,uid,[room.mediaId]):[],card=cards[0];const details=await playbackDetails(cards);return json(card?{...card,captionSubtitle:details.get(card.id)}:null);}
      if(method==='POST') {
        const body=await readBody(request);
        if(path[2]==='heartbeat')return json(await synced.roomState(uid,id,body));
        if(path[2]==='join')return json(await synced.joinRoom(uid,id,body));
        if(path[2]==='invite')return json(await synced.inviteParticipant(uid,id,body));
        if(path[2]==='command')return json(await synced.commandRoom(uid,id,body));
        if(path[2]==='decline')return json(await synced.declineInvitation(uid,id));
        if(path[2]==='leave')return json(await synced.leaveRoom(uid,id));
      }
    }
    if(path[0]==='profile'&&path[1]==='avatars'&&method==='GET')return path[2]?await providerProfileAvatar(uid,uuid(path[2]),request):json(await profileAvatarChoices(uid));
    if(path[0]==='social') {
      const action=path[1], id=path[2], page=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(100000)),Number(url.searchParams.get('page')??1));
      if(method==='GET') {
        if(action==='friends'){
          const roster=await social.friends(uid,page,v.parse(v.picklist(['all','accepted','pending']),url.searchParams.get('state')??'all'));
          const cards=await workCards(uid,uid,[...new Set(roster.flatMap(friend=>friend.backgroundWorkId?[friend.backgroundWorkId]:[]))]);
          return json(roster.map(friend=>{const card=cards.find(card=>('workId' in card?card.workId??card.id:card.id)===friend.backgroundWorkId);return {...friend,backgroundArtwork:card?.backdrop||card?.poster};}));
        }
        if(action==='feed')return json(await activityFeed(uid,Object.fromEntries(url.searchParams)));
        if(action==='popular'){
          const category=v.parse(v.picklist(['all','screen','game','music']),url.searchParams.get('category')??'screen');
          const ranked=await friendDiscovery(uid,category),cards=await workCards(uid,uid,ranked.map(row=>row.workId));
          return json({items:ranked.flatMap(row=>{const item=cards.find(card=>card.id===row.workId);return item?[{...item,captionSubtitle:`${row.friends} ${row.friends===1?'friend':'friends'}`}]:[];}),hasMore:false,next:null});
        }
        if(action==='reactions')return json(await reactionSummary(uid,v.parse(v.picklist(['work','activity']),url.searchParams.get('targetKind')),(url.searchParams.get('ids')??'').split(',').filter(Boolean)));
        if(action==='works')return json(await workSocial(uid,(url.searchParams.get('ids')??'').split(',').filter(Boolean)));
        if(action==='recommendations')return json(await social.recommendations(uid,page,url.searchParams.get('available')==='true'));
        if(action==='insights')return json(url.searchParams.has('friendId')?await friendInsights(uid,uuid(url.searchParams.get('friendId'))):await friendDiscovery(uid));
        if(action==='checkins'){
          const live=await (await import('$lib/social/presence.server')).presence(uid);
          const cards=await workCards(uid,uid,live.map((item:{workId:string})=>item.workId));
          return json(live.map((item:{workId:string})=>{const card=cards.find(card=>('workId' in card?card.workId??card.id:card.id)===item.workId);return {...item,category:card?.kind==='game'?'game':['album','track'].includes(card?.kind??'')?'music':'screen',artwork:card?.backdrop||card?.poster};}));
        }
      } else if(method==='POST') {
        const input=await readBody(request);
        if(action==='friends')return json(id?await social.changeFriend(uid,uuid(id),input):await social.requestFriend(uid,input));
        if(action==='reactions')return json(await social.react(uid,input));
        if(action==='recommendations')return json(id?await social.respondRecommendation(uid,uuid(id),input):await social.recommend(uid,input));
        if(action==='checkins')return json(id?await (await import('$lib/social/presence.server')).cancelCheckin(uid,uuid(id)):await (await import('$lib/social/presence.server')).startCheckin(uid,input));
      }
      throw new AppError(404,'Social action not found.');
    }
    if(subjectId!==uid && path[0]!=='collection')await requireVisible(subjectId,uid,path[0]==='collection'?'collection':path[0]==='progress'?(url.searchParams.get('view')==='watchlist'?'collection':url.searchParams.get('view')==='favourites'?'favourites':'progress'):path[1]==='activity'?'activity':url.searchParams.get('section')==='favourites'?'favourites':'insights','screen');
    if(path[0]==='music' && path[2]==='queue' && method==='GET') return json(await musicQueue(uid,uuid(path[1])));
    if(path[0]==='music' && path[1]==='queue' && method==='GET')return json(await savedMusicQueue(uid,url.searchParams.has('listId')?uuid(url.searchParams.get('listId')):undefined));
    if (path[0] === 'collection' && path.length === 1 && method === 'GET') return json(await collectionData(uid,collectionParameters(url),url.searchParams.get('username')??undefined));
    if (path[0] === 'collection' && path[1] && path.length === 2 && method === 'GET') {
      const [work]=await getDb().select().from(works).where(eq(works.id,uuid(path[1])));if(work)requireEnabledCategory(await getConfig(),work.category);
      return json(await workActionData(uid,uuid(path[1])));
    }
    if (path[0] === 'missing' && method === 'GET') return json(await missingDemand(uid,url));
    if (path[0] === 'admin' && path[1] === 'demand' && method === 'GET') { requireAdmin(user); return json(await adminDemand(url)); }
    if(path[0]==='providers'&&path[2]==='source-preview'&&method==='GET')return json(await previewSourceChange(uid,uuid(path[1]),'connection'));
    if(path[0]==='providers'&&path[2]==='instance-source-preview'&&method==='GET'){requireAdmin(user);return json(await previewSourceChange(uid,uuid(path[1]),'instance'));}
    if (path[0] === 'heroes' && path.length === 1 && method === 'GET') {
      const ids = v.parse(
        v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.maxLength(60)),
        (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
      );
      return json((await mediaViewsForIds(uid, ids)).filter(isHeroTitle));
    }
    if (path[0] === 'sequence' && path.length === 1 && method === 'GET') {
      const source = v.parse(sequenceSourceSchema, {
        kind: url.searchParams.get('kind'),
        id: url.searchParams.get('id'),
      });
      return json({
        next: await sequenceNextView(
          uid,
          source,
          url.searchParams.get('after') ?? undefined,
          url.searchParams.get('from') ?? undefined
        ),
      });
    }
    if(path[0]==='discover' && path.length===1 && method==='GET')return json(await discoveryContent(uid,discoveryParameters(url)));
    if (path[0] === 'library' && path.length === 1 && method === 'GET')
      return json(await libraryContent(uid, url));
    if (path[0] === 'progress' && path.length === 1 && method === 'GET')
      return json(await progressData(subjectId, progressParameters(url), uid));
    if (path[0] === 'lists' && path[1] === 'content' && path.length === 2 && method === 'GET')
      return json(
        await listsData(uid, {
          view: url.searchParams.get('view') ?? 'watchlist',
          scope: url.searchParams.get('scope') ?? 'all',
          filter: url.searchParams.get('filter') ?? 'to-watch',
          kind: url.searchParams.get('kind') ?? 'all',
          page: Number(url.searchParams.get('page') ?? 1),
        })
      );
    if (path[0] === 'playback' && path[2] === 'stream' && method === 'GET')
      return streamPlayback(uid, uuid(path[1]), request);
    if (path[0] === 'trailer' && method === 'GET')
      return streamTrailer(uid, uuid(path[1]), request);
    if (path[0] === 'artwork' && path[1] === 'tmdb' && path.length === 4 && method === 'GET')
      return streamTmdbArtwork(text(path[2]), text(path[3]), request);
    if (path[0] === 'artwork' && path[1] === 'fallback' && path.length === 4 && method === 'GET')
      return fallbackArtwork(uuid(path[2]), text(path[3]));
    if (path[0] === 'artwork' && method === 'GET')
      return streamArtwork(uid, uuid(path[1]), text(path[2]), text(path[3]), request);
    const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await readBody(request, path[0]==='profile'&&path.length===1&&method==='POST'?avatarRequestLimit:1_048_576) : {};
    const relationshipWork=path[0]==='collection'&&path.length===2?path[1]:['tracking','ratings','up-next','lists'].includes(path[0])?body.mediaId:undefined;
    if(relationshipWork){const [work]=await getDb().select().from(works).where(eq(works.id,uuid(relationshipWork)));if(work)requireEnabledCategory(await getConfig(),work.category);}
    if(path[0]==='providers' && path[2]==='reconciliation' && method==='POST') return json(await updateJellyfinReconciliation(uid,uuid(path[1]),body));
    if(path[0]==='providers'&&path[2]==='collection-preview'&&method==='POST')return json(await previewProjection(uid,uuid(path[1]),body));
    if(path[0]==='providers'&&path[2]==='collection-approve'&&method==='POST')return json(await approveProjection(uid,uuid(path[1]),body));
    if(path[0]==='providers'&&path[2]==='collection-review'&&method==='POST')return json(await reviewProjection(uid,uuid(path[1]),body));
    if(path[0]==='collection' && path.length===2 && method==='POST') {
      const data=v.parse(v.object({collected:v.boolean()}),body);
      return json(await trackWithExports(uid,{mediaId:uuid(path[1]),action:'collect',value:data.collected}));
    }
    if(path[0]==='music' && path[1] && path[2]==='log' && method==='POST') return json(await logMusic(uid,uuid(path[1]),body));

    const context = { path, method, url, user, uid, subjectId, body, request, locals };
    for (const dispatch of [handleUpNext, handleGames, handleGamePlaythroughs, handleSession, handleProfile, handleContinue, handleRewatch, handleTracking, handleRatings, handleMedia, handleLists, handleProviders, handleRequests, handlePlayback, handleNotifications, handleConflicts, handleQueue, handleSettings, handleAdmin]) {
      const response = await dispatch(context);
      if (response) return response;
    }
    throw new AppError(404, 'Action not found.');
  } catch (error) {
    if (v.isValiError(error))
      return json(
        { error: error.issues[0]?.message ?? 'Check the supplied values.', code: 'invalid_input' },
        { status: 400 }
      );
    if (error instanceof AppError || error instanceof DomainError)
      return json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof ProviderActionError)
      return json(
        { error: error.message, code: error.code },
        { status: error.code === 'permission' ? 403 : 400 }
      );
    void logDiagnostic('error', path[0] === 'playback' ? 'playback.failed' : 'application.failed', { failure: classifyFailure(error) });
    return json(
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
