import { searchIgdb, igdbDetails, importIgdbGame } from '$lib/providers/igdb/service.server';
import { logDiagnostic, classifyFailure } from '$lib/server/diagnostics';
import { libraryContent } from '$lib/server/queries/library-content';
import * as games from '$lib/core/games/service';
import { removeHistory } from '$lib/sync/history-removal';
import { changeContinue, wholeWorkId } from '$lib/core/tracking/continue';
import { mediaActionData, mediaHistory, mediaActivity } from '$lib/server/queries/media-actions';
import { sequenceSourceSchema } from '$lib/media/sequence';
import { restartPlaylist } from '$lib/core/lists/sequence';
import { isHeroTitle } from '$lib/media/hero';
import { mediaViewsForIds, sequenceNextView } from '$lib/server/queries/media';
import { setRewatch } from '$lib/core/tracking/rewatch';
import { profileUser } from '$lib/server/queries/profile-user';
import { progressData } from '$lib/server/queries/progress';
import { progressParameters } from '$lib/progress';
import { setUpNext } from '$lib/core/lists/up-next';
import { listsData } from '$lib/server/queries/lists';
import { profileData, profileActivity } from '$lib/server/queries/profile';
import { updateProfile } from '$lib/core/profile/service';
import { fallbackArtwork } from '$lib/providers/tmdb/fallback.server';
import { streamTmdbArtwork } from '$lib/providers/tmdb/artwork.server';
import { json, type RequestHandler } from '@sveltejs/kit';
import * as v from 'valibot';
import { eq } from 'drizzle-orm';
import { getDb, getSql } from '$lib/server/db';
import { providerInstances } from '$lib/server/db/schema';
import {
  requireUser,
  requireAdmin,
  createUser,
  deleteUser,
  updatePassword,
  updateUserSettings,
  resetUserSettings,
} from '$lib/server/auth';
import { updateConfig } from '$lib/server/config';
import { AppError } from '$lib/server/security/errors';
import { DomainError } from '$lib/core/errors';
import { ProviderActionError } from '$lib/providers/contracts';
import { trackingInputSchema, bulkTrackingInputSchema } from '$lib/core/tracking/service';
import { trackWithExports, bulkTrackWithExports, rateWithExports } from '$lib/sync/changes';
import * as lists from '$lib/core/lists/service';
import { addLocalSeasonEpisodes, createLocalMedia } from '$lib/core/media/service';
import {
  getMetadataEditor,
  getPresentationEditor,
  saveMetadataOverrides,
  savePresentationPreference,
  resetPresentationPreference,
} from '$lib/catalogue/overrides/service';
import { detailsData } from '$lib/server/queries/media';
import { userLists } from '$lib/server/queries/lists';
import { refreshMedia } from '$lib/catalogue/service';
import { listProviders, configureInstance } from '$lib/providers/instances.server';
import { connectJellyfin, updateJellyfinPlaybackImport } from '$lib/providers/jellyfin/connection.server';
import { startTraktDevice, finishTraktDevice, updateSyncPreferences } from '$lib/providers/trakt/connection.server';
import { disconnectProvider } from '$lib/providers/connections.server';
import { updateProviderSchedule, runProviderJob } from '$lib/providers/maintenance.server';
import { requestOptions, requestMedia, manageRequest } from '$lib/providers/seerr/requests.server';
import { musicLibrary, musicDetails } from '$lib/music/service.server';
import { streamMusicArtwork } from '$lib/music/artwork.server';
import { libraryScanProgress } from '$lib/sync/jellyfin';
import { queueTraktListChange, deleteListWithExports } from '$lib/sync/trakt-lists';
import { listActions, cancelAction, retryAction } from '$lib/server/queue';
import {
  inbox,
  markNotification,
  broadcast,
  systemHealth,
} from '$lib/server/notifications';
import {
  startPlayback,
  progressPlayback,
  streamPlayback,
  getTrailer,
  streamTrailer,
  recordPlaybackError,
} from '$lib/playback/server';
import { getPendingConflicts, resolveConflict } from '$lib/sync/conflicts';
import { streamArtwork } from '$lib/providers/artwork.server';

const uuid = (value: unknown) => v.parse(v.pipe(v.string(), v.uuid()), value);
const text = (value: unknown) => v.parse(v.pipe(v.string(), v.maxLength(1000)), value);
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AppError(415, 'Send an application/json request.');
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 1_048_576) {
      await reader.cancel();
      throw new AppError(413, 'This request is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (Array.isArray(value)) throw new Error('Expected a JSON object.');
    return v.parse(v.record(v.string(), v.unknown()), value);
  } catch {
    throw new AppError(400, 'The request must contain valid JSON.');
  }
}
const handler: RequestHandler = async (event) => {
  const { request, url, locals } = event;
  const path = (event.params.path ?? '').split('/');
  const method = request.method;
  try {
    if (path[0] === 'health' && method === 'GET') {
      await getSql()`select 1`;
      return json({ status: 'healthy' });
    }
    const user = requireUser(locals.user),
      uid = user.id;
    const subjectId =
      method === 'GET' &&
      ['progress', 'profile'].includes(path[0]) &&
      url.searchParams.has('username')
        ? (await profileUser(url.searchParams.get('username')!)).id
        : uid;
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
    const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await readBody(request) : {};
    let result: unknown;
    if (path[0] === 'up-next' && path.length === 1 && method === 'POST') {
      await setUpNext(uid, body);
      result = { ok: true };
    } else if (path[0] === 'games') {
      if (path.length === 3 && path[1] === 'igdb' && path[2] === 'search' && method === 'GET')
        result = await searchIgdb(uuid(url.searchParams.get('instanceId')), url.searchParams.get('q') ?? '', Number(url.searchParams.get('page') ?? 1));
      else if (path.length === 3 && path[1] === 'igdb' && method === 'GET')
        result = await igdbDetails(uuid(url.searchParams.get('instanceId')), path[2]);
      else if (path.length === 2 && path[1] === 'import' && method === 'POST')
        result = await importIgdbGame(body);
      else if (path.length === 1 && method === 'GET')
        result = await games.listGames(url.searchParams.get('q') ?? '', Number(url.searchParams.get('page') ?? 1));
      else if (path.length === 1 && method === 'POST') result = await games.createGame(body);
      else if (path.length === 2 && method === 'GET') result = await games.gameDetails(uid, uuid(path[1]));
      else if (path.length === 3 && path[2] === 'playthroughs' && method === 'POST')
        result = await games.createPlaythrough(uid, uuid(path[1]), body);
      else throw new AppError(404, 'Action not found.');
    } else if (path[0] === 'game-playthroughs') {
      if (path.length === 2 && method === 'GET')
        result = await games.playthroughDetails(uid, uuid(path[1]), Number(url.searchParams.get('page') ?? 1));
      else if (path.length === 2 && method === 'PATCH') result = await games.updatePlaythrough(uid, uuid(path[1]), body);
      else if (path.length === 3 && path[2] === 'sessions' && method === 'POST')
        result = await games.logGameSession(uid, uuid(path[1]), body);
      else throw new AppError(404, 'Action not found.');
    } else if (path[0] === 'session' && method === 'GET') result = { user, expiresAt: locals.expiresAt };
    else if (
      path[0] === 'profile' &&
      path[1] === 'activity' &&
      path.length === 2 &&
      method === 'GET'
    ) {
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
    } else if (
      path[0] === 'profile' &&
      path[1] === 'section' &&
      path.length === 2 &&
      method === 'GET'
    ) {
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
              activity: await profileActivity(subjectId, new Date(), data.filters.period),
            };
    } else if (path[0] === 'profile' && path.length === 1 && method === 'POST')
      result = await updateProfile(uid, body);
    else if (path[0] === 'continue' && path.length === 1 && method === 'POST')
      result = await changeContinue(uid, body);
    else if (path[0] === 'rewatch' && path.length === 1 && method === 'POST')
      result = await setRewatch(uid, {
        ...body,
        mediaId: await wholeWorkId(getDb(), uuid(body.mediaId)),
      });
    else if (path[0] === 'tracking' && method === 'POST') {
      const clean = {
        ...body,
        mediaId: uuid(body.mediaId),
        source: 'coast',
        sourceEventId: undefined,
      };
      result =
        path[1] === 'bulk'
          ? await bulkTrackWithExports(uid, v.parse(bulkTrackingInputSchema, clean))
          : await trackWithExports(uid, v.parse(trackingInputSchema, clean));
    } else if (path[0] === 'ratings' && method === 'POST')
      result = await rateWithExports(uid, body as Parameters<typeof rateWithExports>[1]);
    else if (path[0] === 'media') {
      if (path.length === 1 && method === 'POST') result = await createLocalMedia(uid, body);
      else if (path.length === 2 && method === 'GET')
        result = await detailsData(uid, uuid(path[1]));
      else if (path[2] === 'actions' && method === 'GET')
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
    } else if (path[0] === 'lists') {
      if (path.length === 1 && method === 'GET') result = { lists: await userLists(uid) };
      else if (path[1] === 'summaries' && path.length === 2 && method === 'GET')
        result = { lists: await lists.getLists(uid) };
      else if (path.length === 1 && method === 'POST')
        result = await lists.createList(uid, body as Parameters<typeof lists.createList>[1]);
      else if (path.length === 2 && method === 'PATCH')
        result = await lists.updateList(
          uid,
          uuid(path[1]),
          body as Parameters<typeof lists.updateList>[2]
        );
      else if (path.length === 2 && method === 'DELETE')
        result = await deleteListWithExports(uid, uuid(path[1]));
      else if (path[2] === 'playback' && method === 'POST') {
        const list = await lists.getList(uid, uuid(path[1]));
        if (!list.playbackStartedAt || body.restart === true) await restartPlaylist(uid, list.id);
        result = { ok: true };
      } else if (path[2] === 'items' && method === 'POST')
        result = await lists.addListItem(
          uid,
          uuid(path[1]),
          uuid(body.mediaId),
          body.restorePosition as number | undefined
        );
      else if (path[2] === 'items' && method === 'DELETE')
        result = await lists.removeListItem(uid, uuid(path[1]), uuid(body.entryId));
      else if (path[2] === 'order' && method === 'POST')
        result = await lists.reorderList(
          uid,
          uuid(path[1]),
          v.parse(v.array(v.pipe(v.string(), v.uuid())), body.ids)
        );
      else if (path[2] === 'move' && method === 'POST')
        result = await lists.moveListItem(uid, uuid(path[1]), body);
      else throw new AppError(404, 'Action not found.');
      if (method !== 'GET' && !(path.length === 2 && method === 'DELETE')) {
        const listId = path.length === 1 ? (result as { id?: string })?.id : path[1];
        if (listId)
          await queueTraktListChange(uid, listId).catch(async () => {
            void logDiagnostic('error', 'job.failed', { failure: 'unexpected' });
          });
      }
    } else if (path[0] === 'providers') {
      if (path.length === 1 && method === 'GET') result = await listProviders(uid);
      else if (path.length === 1 && method === 'POST') {
        requireAdmin(user);
        result = await configureInstance(uid, body);
      } else if (path[1] === 'jellyfin' && method === 'POST')
        result = await connectJellyfin(
          uid,
          v.parse(
            v.object({
              instanceId: v.pipe(v.string(), v.uuid()),
              username: v.string(),
              password: v.string(),
            }),
            body
          )
        );
      else if (path[1] === 'trakt' && path[2] === 'start' && method === 'POST')
        result = await startTraktDevice(uid, uuid(body.instanceId));
      else if (path[1] === 'trakt' && path[2] === 'finish' && method === 'POST')
        result = await finishTraktDevice(uid, uuid(body.instanceId));
      else if (path[2] === 'music' && path.length === 5 && path[4] === 'artwork' && method === 'GET')
        return await streamMusicArtwork(uid, uuid(path[1]), path[3], request);
      else if (path[2] === 'music' && path.length === 3 && method === 'GET')
        result = await musicLibrary(uid, uuid(path[1]), {
          kind: url.searchParams.get('kind') ?? undefined,
          offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
          limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
          search: url.searchParams.get('search') ?? undefined,
          artistId: url.searchParams.get('artistId') ?? undefined,
          albumId: url.searchParams.get('albumId') ?? undefined,
        });
      else if (path[2] === 'music' && path.length === 4 && method === 'GET')
        result = await musicDetails(uid, uuid(path[1]), path[3]);
      else if (path[2] === 'disconnect' && method === 'POST')
        result = await disconnectProvider(uid, uuid(path[1]));
      else if (path[2] === 'scan' && method === 'GET')
        result = await libraryScanProgress(uid, uuid(path[1]));
      else if (path[2] === 'schedule' && method === 'POST') {
        requireAdmin(user);
        result = await updateProviderSchedule(uid, uuid(path[1]), body);
      } else if (path[2] === 'run-job' && method === 'POST') {
        requireAdmin(user);
        result = await runProviderJob(uid, uuid(path[1]));
      } else if (path[2] === 'playback-import' && method === 'POST')
        result = await updateJellyfinPlaybackImport(uid, uuid(path[1]), body);
      else if (path[2] === 'sync' && method === 'POST')
        result = await updateSyncPreferences(uid, uuid(path[1]), body);
      else if (['disable', 'enable'].includes(path[2]) && method === 'POST') {
        requireAdmin(user);
        result = await getDb()
          .update(providerInstances)
          .set({ enabled: path[2] === 'enable' })
          .where(eq(providerInstances.id, uuid(path[1])));
      } else throw new AppError(404, 'Action not found.');
    } else if (path[0] === 'requests') {
      if (path[1] === 'options' && method === 'GET') {
        const options = await requestOptions(uid, uuid(url.searchParams.get('mediaId')));
        result = {
          destinations: options.map((d) => ({
            id: d.instanceId,
            name: d.name,
            variants: d.variants,
          })),
        };
      } else if (path.length === 1 && method === 'POST')
        result = await requestMedia(uid, {
          ...body,
          addToWatchlist: body.watchlist !== false,
        });
      else if (path.length === 2 && method === 'POST')
        result = await manageRequest(
          uid,
          uuid(path[1]),
          v.parse(v.picklist(['cancel', 'approve', 'decline']), body.action)
        );
      else throw new AppError(404, 'Action not found.');
    } else if (path[0] === 'playback') {
      if (path.length === 1 && method === 'POST') result = await startPlayback(uid, body);
      else if (path[2] === 'progress' && method === 'POST')
        result = await progressPlayback(uid, uuid(path[1]), body);
      else if (path[2] === 'error' && method === 'POST')
        result = await recordPlaybackError(uid, uuid(path[1]), body.code);
      else throw new AppError(404, 'Action not found.');
    } else if (path[0] === 'notifications') {
      if (path.length === 1 && method === 'GET') result = await inbox(user);
      else if (path[1] === 'broadcast' && method === 'POST') result = await broadcast(user, body);
      else if (method === 'POST')
        result = await markNotification(
          user,
          uuid(path[1]),
          v.parse(v.picklist(['read', 'dismiss']), body.action)
        );
      else throw new AppError(404, 'Action not found.');
    } else if (path[0] === 'conflicts') {
      if (path.length === 1 && method === 'GET') result = await getPendingConflicts(uid);
      else if (path.length === 2 && method === 'POST')
        result = await resolveConflict(
          uid,
          uuid(path[1]),
          v.parse(v.picklist(['accepted', 'ignored']), body.decision)
        );
      else throw new AppError(404, 'Action not found.');
    } else if (path[0] === 'queue') {
      if (path.length === 1 && method === 'GET') result = await listActions(user);
      else if (path[2] === 'cancel' && method === 'POST')
        result = await cancelAction(user, uuid(path[1]));
      else if (path[2] === 'retry' && method === 'POST')
        result = await retryAction(user, uuid(path[1]));
      else throw new AppError(404, 'Action not found.');
    } else if (path[0] === 'settings') {
      if (path.length === 1 && method === 'POST') result = await updateUserSettings(user, body);
      else if (path[1] === 'reset' && method === 'POST') result = await resetUserSettings(user);
      else if (path[1] === 'password' && method === 'POST')
        result = await updatePassword(user, text(body.currentPassword), body.password);
      else if (path[1] === 'system' && method === 'POST') result = await updateConfig(user, body);
      else throw new AppError(404, 'Action not found.');
    } else if (path[0] === 'admin') {
      requireAdmin(user);
      if (path[1] === 'users' && path.length === 2 && method === 'POST')
        result = await createUser(user, body);
      else if (path[1] === 'users' && path.length === 3 && method === 'DELETE')
        result = await deleteUser(user, uuid(path[2]));
      else if (path[1] === 'health' && method === 'GET') result = await systemHealth(user);
      else throw new AppError(404, 'Action not found.');
    } else throw new AppError(404, 'Action not found.');
    return json(result ?? { ok: true });
  } catch (error) {
    if (v.isValiError(error))
      return json(
        { error: error.issues[0]?.message ?? 'Check the supplied values.' },
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
        error:
          path[0] === 'playback'
            ? 'Playback could not start. Please try again.'
            : 'This action could not be completed. Please try again.',
      },
      { status: 503 }
    );
  }
};
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
