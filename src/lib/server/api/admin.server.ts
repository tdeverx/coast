
import { requireAdmin, createUser, deleteUser, updateUser } from '#lib/server/auth/index.js';
import { AppError } from '#lib/server/security/errors.js';
import { systemHealth } from '#lib/server/notifications/index.js';
import { uuid, type ApiContext } from './context.server';
import { listBenchmarks, startBenchmark } from '#lib/benchmarks/service.server.js';

export async function handleAdmin(context: ApiContext): Promise<Response | undefined> {
 const { user, path, method, body, url } = context;
 let result: unknown;
 if (path[0] === 'admin') {
      requireAdmin(user);
      if(path[1]==='featured-hero'&&path.length===2&&method==='POST')
        result=await (await import('#lib/application/featured-hero.server.js')).updateFeaturedHero(user,body);
      else if (path[1] === 'users' && path.length === 2 && method === 'POST')
        result = await createUser(user, body);
      else if (path[1] === 'users' && path.length === 3 && method === 'DELETE')
        result = await deleteUser(user, uuid(path[2]));
      else if (path[1] === 'users' && path.length === 3 && method === 'PATCH')
        result = await updateUser(user, uuid(path[2]), body);
      else if(path[1]==='taste-refresh'&&path.length===2&&method==='POST')result=await (await import('#lib/social/taste-cache.server.js')).runTasteRefresh();
      else if(path[1]==='taste-schedule'&&path.length===2&&method==='POST')result=await (await import('#lib/social/taste-cache.server.js')).updateTasteSchedule(body);
      else if (path[1] === 'health' && method === 'GET') result = await systemHealth(user);
      else if (path[1] === 'benchmarks' && path.length === 2 && method === 'GET') result = await listBenchmarks(user,Number(url.searchParams.get('page'))||1);
      else if (path[1] === 'benchmarks' && path.length === 2 && method === 'POST') result = await startBenchmark(user);
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return Response.json(result ?? { ok: true });
}
