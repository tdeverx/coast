import { searchIgdb, igdbDetails, importIgdbGame } from '$lib/providers/igdb/service.server';
import * as games from '$lib/core/games/service';
import { json } from '@sveltejs/kit';
import { AppError } from '$lib/server/security/errors';
import { uuid, type ApiContext } from './context.server';

export async function handleGames(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, url, body } = context;
 let result: unknown;
 if (path[0] === 'games') {
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
    } else return undefined;
 return json(result ?? { ok: true });
}
