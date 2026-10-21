import { getFeatureConfig } from '#lib/server/features.js';
import {readingHistoryData} from '#lib/reading/query.server.js';
import { categoryEnabled } from '#lib/experimental.js';
import { openApi } from './openapi';
import { publicMutation } from './mutations.server';
import { listWebhooks } from './webhooks.server';
import { type RequestHandler } from '@sveltejs/kit';
import * as v from 'valibot';
import { enabledCategories } from '#lib/server/experimental.js';
import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { AppError } from '#lib/server/security/errors.js';
import { DomainError } from '#lib/core/errors.js';
import { logDiagnostic,classifyFailure } from '#lib/server/diagnostics/index.js';
import { authenticateApiToken } from './tokens.server';
import { publicProgress } from './progress.server';
import { publicWork,publicPage } from './response';
import { collectionSummaries,collectionParameters,workSummaries } from '#lib/collection/query.server.js';
import { publicLibrary } from './library.server';
import { progressData } from '#lib/server/queries/progress.js';
import { progressParameters } from '#lib/progress.js';
import { pagination,PAGE_SIZE } from '#lib/server/queries/pagination.js';
import type { ApiScope } from '#lib/public-api.js';

const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const apiPageSchema=v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10000));
const publicApiResponse:RequestHandler=async event=>{
 const {request,url}=event;
 try {
  const read=request.method==='GET'||request.method==='HEAD';
  if(read&&event.params.path==='openapi.json')return Response.json(openApi,{headers});
  const user=await authenticateApiToken(request);
  const path=(event.params.path??'').split('/');
  if(!read){const result=await publicMutation(user,request,url,path);return Response.json(result.response,{status:result.status,headers:{...headers,'idempotency-replayed':String(result.replayed)}});}
  if(path.join('/')==='webhooks'){
   if(!user.scopes.includes('webhooks:manage'))throw new AppError(403,'This endpoint requires webhooks:manage.','insufficient_scope');
   for(const [key] of url.searchParams)if(key!=='page'||url.searchParams.getAll(key).length!==1)throw new AppError(400,'Unsupported subscription parameters.','invalid_input');
   const page=v.parse(apiPageSchema,Number(url.searchParams.get('page')??1));
   const result=await listWebhooks(user.id,page);
   return Response.json(publicPage(result.items,result,url),{headers});
  }
  if(path.length===3&&path[0]==='reading'&&path[2]==='history'){
   if(!user.scopes.includes('progress:read'))throw new AppError(403,'This endpoint requires progress:read.','insufficient_scope');
   for(const [key] of url.searchParams)if(key!=='page'||url.searchParams.getAll(key).length!==1)throw new AppError(400,'Unsupported history parameters.','invalid_input');
   const result=await readingHistoryData(user.id,v.parse(v.pipe(v.string(),v.uuid()),path[1]),v.parse(apiPageSchema,Number(url.searchParams.get('page')??1)));return Response.json(publicPage(result.items,result,url),{headers});
  }
  const allowed:Record<string,ApiScope>={catalogue:'catalogue:read',collection:'collection:read',library:'library:read',progress:'progress:read'};
  if(path.length===1&&path[0]==='me'){
   if(url.searchParams.size)throw new AppError(400,'This endpoint does not accept query parameters.','invalid_input');
   return Response.json({id:user.id,username:user.username,scopes:user.scopes},{headers});
  }
  const scope=allowed[path[0]];
  if(!scope||path.length>2||path.length===2&&path[0]!=='catalogue')throw new AppError(404,'Endpoint not found.','not_found');
  if(!user.scopes.includes(scope))throw new AppError(403,`This endpoint requires ${scope}.`,'insufficient_scope');
  // No cross-profile reads, UI preview queries or unexpected provider side effects.
  const parameters:Record<string,string[]>={catalogue:['page','category','kind'],collection:['page','level','category','kind','relationship','activity','availability','source'],library:['page','category','kind','source'],progress:['page','view','category','kind','scope']};
  for(const [key] of url.searchParams)if(!parameters[path[0]].includes(key)||url.searchParams.getAll(key).length!==1)throw new AppError(400,`Unsupported or repeated parameter: ${key}.`,'invalid_input');
  const page=v.parse(apiPageSchema,Number(url.searchParams.get('page')??1));
  if(path[0]==='catalogue') {
   if(path[1]) {
    const id=v.parse(v.pipe(v.string(),v.uuid()),path[1]);
    const item=(await workSummaries(user.id,user.id,[id]))[0];
    if(!item)throw new AppError(404,'Work not found.','not_found');
    if(!categoryEnabled(await getFeatureConfig(user.id),item.kind==='game'?'game':item.kind==='book'||item.kind==='comic'?item.kind:['album','track'].includes(item.kind)?'music':'screen'))throw new AppError(404,'Work not found.','not_found');
    return Response.json(publicWork(item),{headers});
   }
   const category=v.parse(v.picklist(['all','screen','game','music','book','comic']),url.searchParams.get('category')??'all');
   const kind=v.parse(v.picklist(['all','movie','show','season','episode','collection','game','album','track','book','comic']),url.searchParams.get('kind')??'all');
   const config=await getFeatureConfig(user.id);
   const where=sql`(${category}='all' or category=${category}) and (${kind}='all' or kind=${kind}) and ${enabledCategories(sql`category`,config)}`;
   const [count]=await getDb().execute<{total:number}>(sql`select count(*)::int as total from works where ${where}`);
   const paging=pagination(count.total,page);
   const rows=await getDb().execute<{id:string}>(sql`select id from works where ${where} order by id limit ${PAGE_SIZE} offset ${(paging.page-1)*PAGE_SIZE}`);
   const cards=await workSummaries(user.id,user.id,Array.from(rows).map(row=>row.id));
   return Response.json(publicPage(cards.map(item=>publicWork(item)),{...paging,total:count.total},url),{headers});
  }
  if(path[0]==='collection') {
   const result=await collectionSummaries(user.id,collectionParameters(url));
   const assessments=new Map(result.assessments.map(item=>[item.id,item]));
   return Response.json(publicPage(result.items.map(item=>{const dto=publicWork(item);const assessment=assessments.get(dto.id);return {...dto,availability:assessment?.availability??'unknown',stale:assessment?.stale??true,reasons:assessment?.reasons??[]};}),result,url),{headers});
  }
  if(path[0]==='library') {
   const result=await publicLibrary(user.id,url);
   return Response.json(publicPage(result.items.map(item=>publicWork(item)),result,url),{headers});
  }
  const result=await progressData(user.id,progressParameters(url),user.id);
  return Response.json(publicPage(await publicProgress(user.id,result.items),result,url),{headers});
 }catch(cause) {
  const invalid=v.isValiError(cause),known=cause instanceof AppError||cause instanceof DomainError;
  const status=invalid?400:known?cause.status:503;
  if(!invalid&&!known)void logDiagnostic('error','application.failed',{failure:classifyFailure(cause)});
  return Response.json({error:{code:invalid?'invalid_input':known?cause.code:'service_unavailable',message:invalid?'Check the supplied parameters.':known?cause.message:'This request could not be completed.'}},{status,headers:{...headers,...(status===401?{'www-authenticate':'Bearer realm="Coast"'}:{}),...(status===429?{'retry-after':'60'}:{})}});
 }
};

export const publicApiHandler:RequestHandler=async event=>{
 const response=await publicApiResponse(event);
 return event.request.method==='HEAD'?new Response(null,{status:response.status,statusText:response.statusText,headers:response.headers}):response;
};
