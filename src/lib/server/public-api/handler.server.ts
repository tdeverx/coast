import { json,type RequestHandler } from '@sveltejs/kit';
import * as v from 'valibot';
import { getSql } from '$lib/server/db';
import { getConfig } from '$lib/server/config';
import { AppError } from '$lib/server/security/errors';
import { DomainError } from '$lib/core/errors';
import { logDiagnostic,classifyFailure } from '$lib/server/diagnostics';
import { authenticateApiToken } from './tokens.server';
import { publicProgress } from './progress.server';
import { publicWork,publicPage } from './response';
import { collectionData,collectionParameters,workCards } from '$lib/collection/query.server';
import { publicLibrary } from './library.server';
import { progressData } from '$lib/server/queries/progress';
import { progressParameters } from '$lib/progress';
import { pagination,PAGE_SIZE } from '$lib/server/queries/pagination';
import type { ApiScope } from '$lib/public-api';

const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
export const publicApiHandler:RequestHandler=async event=>{
 const {request,url}=event;
 try {
  if(request.method!=='GET')return json({error:{code:'method_not_allowed',message:'This API is read-only.'}},{status:405,headers:{...headers,allow:'GET'}});
  const user=await authenticateApiToken(request);
  const path=(event.params.path??'').split('/');
  const allowed:Record<string,ApiScope>={catalogue:'catalogue:read',collection:'collection:read',library:'library:read',progress:'progress:read'};
  if(path.length===1&&path[0]==='me'){
   if(url.searchParams.size)throw new AppError(400,'This endpoint does not accept query parameters.','invalid_input');
   return json({id:user.id,username:user.username,scopes:user.scopes},{headers});
  }
  const scope=allowed[path[0]];
  if(!scope||path.length>2||path.length===2&&path[0]!=='catalogue')throw new AppError(404,'Endpoint not found.','not_found');
  if(!user.scopes.includes(scope))throw new AppError(403,`This endpoint requires ${scope}.`,'insufficient_scope');
  // No cross-profile reads, UI preview queries or unexpected provider side effects.
  const parameters:Record<string,string[]>={catalogue:['page','category','kind'],collection:['page','level','category','kind','relationship','activity','availability','source'],library:['page','category','kind','source'],progress:['page','view','category','kind','scope']};
  for(const [key] of url.searchParams)if(!parameters[path[0]].includes(key)||url.searchParams.getAll(key).length!==1)throw new AppError(400,`Unsupported or repeated parameter: ${key}.`,'invalid_input');
  const page=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10000)),Number(url.searchParams.get('page')??1));
  if(path[0]==='catalogue') {
   if(path[1]) {
    const id=v.parse(v.pipe(v.string(),v.uuid()),path[1]);
    const item=(await workCards(user.id,user.id,[id]))[0];
    if(!item)throw new AppError(404,'Work not found.','not_found');
    if(item.kind!=='movie'&&item.kind!=='show'&&item.kind!=='season'&&item.kind!=='episode'&&item.kind!=='collection'&&!(await getConfig()).experimentalFeatures)throw new AppError(404,'Work not found.','not_found');
    return json(publicWork(item),{headers});
   }
   const category=v.parse(v.picklist(['all','screen','game','music']),url.searchParams.get('category')??'all');
   const kind=v.parse(v.picklist(['all','movie','show','season','episode','collection','game','album','track']),url.searchParams.get('kind')??'all');
   const experimental=(await getConfig()).experimentalFeatures;
   const [count]=await getSql()`select count(*)::int as total from works where category in ('screen','game','music') and (${category}='all' or category=${category}) and (${kind}='all' or kind=${kind}) and (${experimental} or category='screen')`;
   const paging=pagination(count.total,page);
   const rows=await getSql()`select id from works where category in ('screen','game','music') and (${category}='all' or category=${category}) and (${kind}='all' or kind=${kind}) and (${experimental} or category='screen') order by id limit ${PAGE_SIZE} offset ${(paging.page-1)*PAGE_SIZE}`;
   const cards=await workCards(user.id,user.id,rows.map((row:{id:string})=>row.id));
   return json(publicPage(cards.map(item=>publicWork(item)),{...paging,total:count.total},url),{headers});
  }
  if(path[0]==='collection') {
   const result=await collectionData(user.id,collectionParameters(url));
   const assessments=new Map(result.assessments.map(item=>[item.id,item]));
   return json(publicPage(result.items.map(item=>{const dto=publicWork(item);const assessment=assessments.get(dto.id);return {...dto,availability:assessment?.availability??'unknown',stale:assessment?.stale??true,reasons:assessment?.reasons??[]};}),result,url),{headers});
  }
  if(path[0]==='library') {
   const result=await publicLibrary(user.id,url);
   return json(publicPage(result.items.map(item=>publicWork(item)),result,url),{headers});
  }
  const result=await progressData(user.id,progressParameters(url),user.id);
  return json(publicPage(await publicProgress(user.id,result.items),result,url),{headers});
 }catch(cause) {
  const invalid=v.isValiError(cause),known=cause instanceof AppError||cause instanceof DomainError;
  const status=invalid?400:known?cause.status:503;
  if(!invalid&&!known)void logDiagnostic('error','application.failed',{failure:classifyFailure(cause)});
  return json({error:{code:invalid?'invalid_input':known?cause.code:'service_unavailable',message:invalid?'Check the supplied parameters.':known?cause.message:'This request could not be completed.'}},{status,headers:{...headers,...(status===401?{'www-authenticate':'Bearer realm="Coast"'}:{}),...(status===429?{'retry-after':'60'}:{})}});
 }
};
