
import * as v from 'valibot';
import { requireAdmin } from '#lib/server/auth/index.js';
import { AppError } from '#lib/server/security/errors.js';
import { listProviders, configureInstance } from '#lib/providers/instances.server.js';
import { setInstanceEnabled, deleteInstance } from '#lib/application/provider-sources.server.js';
import { connectJellyfin, updateJellyfinPlaybackImport } from '#lib/providers/jellyfin/connection.server.js';
import { startTraktDevice, finishTraktDevice, updateSyncPreferences } from '#lib/providers/trakt/connection.server.js';
import { disconnectProvider } from '#lib/application/provider-sources.server.js';
import { updateProviderSchedule, runProviderJob } from '#lib/providers/maintenance.server.js';
import { musicLibrary, musicDetails, setMusicFavourite } from '#lib/music/service.server.js';
import { streamMusicArtwork } from '#lib/music/artwork.server.js';
import { libraryScanProgress } from '#lib/sync/jellyfin.server.js';
import { uuid, type ApiContext } from './context.server';

export async function handleProviders(context: ApiContext): Promise<Response | undefined> {
 const { user, uid, path, method, request, url, body } = context;
 let result: unknown;
 if (path[0] === 'providers') {
      if(path.length===2&&path[1]==='streams'&&method==='GET')result=await (await import('#lib/application/streams.server.js')).activeStreams(user,{view:url.searchParams.get('view')??'now',before:url.searchParams.get('before')??undefined});
      else if(path.length===3&&path[1]==='streams'&&path[2]==='count'&&method==='GET')result=await (await import('#lib/application/streams.server.js')).streamCount(user);
      else if(path.length===3&&path[1]==='streams'&&path[2]==='refresh'&&method==='POST')result=await (await import('#lib/application/streams.server.js')).refreshStreams(user);
      else if (path.length === 1 && method === 'GET') result = await listProviders(uid);
      else if (path.length === 1 && method === 'POST') {
        requireAdmin(user);
        result = await configureInstance(uid, body);
      } else if (path.length === 2 && method === 'DELETE') {
        requireAdmin(user);
        result = await deleteInstance(uid, uuid(path[1]), typeof body.previewId === 'string' ? uuid(body.previewId) : undefined);
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
      else if (path[1] === 'steam' && path[2] === 'start' && method === 'POST')
        result = await (await import('#lib/providers/steam/connection.server.js')).startSteam(uid,uuid(body.instanceId),url.origin);
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
        },request.signal);
      else if (path[2] === 'music' && path.length === 4 && method === 'GET')
        result = await musicDetails(uid, uuid(path[1]), path[3],request.signal);
      else if (path[2] === 'music' && path.length === 5 && path[4] === 'favourite' && method === 'POST')
        result = await setMusicFavourite(uid, uuid(path[1]), path[3], body);
      else if (path[2] === 'disconnect' && method === 'POST')
        result = await disconnectProvider(uid, uuid(path[1]),typeof body.previewId==='string'?uuid(body.previewId):undefined);
      else if (path[2] === 'scan' && method === 'GET')
        result = await libraryScanProgress(uid, uuid(path[1]));
      else if (path[2] === 'schedule' && method === 'POST') {
        requireAdmin(user);
        result = await updateProviderSchedule(uid, uuid(path[1]), body);
      } else if (path[2] === 'run-job' && method === 'POST') {
        requireAdmin(user);
        result = await runProviderJob(uid, uuid(path[1]), v.parse(v.optional(v.picklist(['all','library','users','tracking','lists','live','streams','catalogue','metadata']), 'all'), body.task), v.parse(v.optional(v.string()), body.kind));
      } else if (path[2] === 'playback-import' && method === 'POST')
        result = await updateJellyfinPlaybackImport(uid, uuid(path[1]), body);
      else if (path[2] === 'live-read' && method === 'POST')
        result = await (await import('#lib/providers/connections.server.js')).updateLiveRead(uid,uuid(path[1]),body);
      else if (path[2] === 'steam-imports' && method === 'POST')
        result = await (await import('#lib/providers/steam/connection.server.js')).updateSteamImports(uid,uuid(path[1]),body);
      else if (path[2] === 'sync' && method === 'POST')
        result = await updateSyncPreferences(uid, uuid(path[1]), body);
      else if (['disable', 'enable'].includes(path[2]) && method === 'POST') {
        requireAdmin(user);
        result = await setInstanceEnabled(uid,uuid(path[1]),path[2]==='enable',typeof body.previewId==='string'?uuid(body.previewId):undefined);
      } else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return Response.json(result ?? { ok: true });
}
