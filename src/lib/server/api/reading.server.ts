import { json } from '@sveltejs/kit';
import { addReading } from '$lib/application/reading.server';
import { updateReading } from '$lib/core/reading/service.server';
import { readingDetails, readingHistoryData } from '$lib/reading/query.server';
import { AppError } from '$lib/server/security/errors';
import {groupsForReading,editionsForReading,readingGroupData} from '$lib/reading/groups.server';
import { uuid, type ApiContext } from './context.server';
import { touchReading, prepareReading, moveReading, closeReading, streamReading, readingSources, readingConnections, linkedReadingSources, matchingReading } from '$lib/reading/sessions.server';

export async function handleReading({ uid, path, method, body, url, request }: ApiContext): Promise<Response | undefined> {
  if (path[0] !== 'reading') return;
  if(path[1]==='collections'&&path.length===3&&method==='GET')return json(await readingGroupData(uid,uuid(path[2]),Number(url.searchParams.get('page')??1)));
  if(path[1]==='sessions'&&path.length===4){
    const id=uuid(path[2]);
    if(path[3]==='file'&&['GET','HEAD'].includes(method))return streamReading(uid,id,request);
    if(path[3]==='location'&&method==='POST')return json(await moveReading(uid,id,body));
    if(path[3]==='heartbeat'&&method==='POST')return json(await touchReading(uid,id));
    if(path[3]==='close'&&method==='POST')return json(await closeReading(uid,id));
  }
  if (path.length === 2 && path[1] === 'import' && method === 'POST') {
    return json(await addReading(uid, body));
  }
  if (path.length === 2 && method === 'GET') return json(await readingDetails(uid, uuid(path[1])));
  if (path.length === 3 && path[2] === 'progress' && method === 'POST')
    return json(await updateReading(uid, uuid(path[1]), body));
  if(path.length===3){
    const id=uuid(path[1]);
    if(path[2]==='matching'&&method==='POST')return json(await matchingReading(uid,id,String(body.edition??'')));
    if(path[2]==='session'&&method==='POST')return json(await prepareReading(uid,id,body,request.signal));
    if(path[2]==='connections'&&method==='GET')return json(await readingConnections(uid,id));
    if(path[2]==='linked'&&method==='GET')return json(await linkedReadingSources(uid,id));
    if(path[2]==='groups'&&method==='GET')return json(await groupsForReading(uid,id));
    if(path[2]==='editions'&&method==='GET')return json(await editionsForReading(uid,id,Number(url.searchParams.get('page')??1)));
    if(path[2]==='sources'&&method==='GET')return json(await readingSources(uid,id,uuid(url.searchParams.get('connectionId')),url.searchParams.get('q')??'',Number(url.searchParams.get('offset')??0),request.signal));
    if(path[2]==='history'&&method==='GET'){
      return json(await readingHistoryData(uid,id,Number(url.searchParams.get('page')??1)));
    }
  }
  throw new AppError(404, 'Action not found.');
}
