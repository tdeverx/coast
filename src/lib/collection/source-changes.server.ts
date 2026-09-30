import { createHash } from 'node:crypto';
import { and,eq,inArray,sql } from 'drizzle-orm';
import { getDb,type Database } from '$lib/server/db';
import { providerConnections,providerInstances,users,collectionProjectionEntries } from '$lib/server/db/schema';
import { desiredProjection,projectionConfig } from './projection.server';
import { DomainError } from '$lib/core/errors';
import { notify } from '$lib/server/notifications';

type Transaction=Parameters<Parameters<Database['transaction']>[0]>[0];
export type SourceImpact={id:string;accounts:{username:string;connectionId:string;removals:{workId:string;title:string}[];unresolved:string[];uncertain:boolean}[]};
async function context(actorId:string,id:string,scope:'connection'|'instance'){
  const db=getDb();
  const sources=await db.select({connection:providerConnections,instance:providerInstances,username:users.username}).from(providerConnections)
    .innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).innerJoin(users,eq(users.id,providerConnections.userId))
    .where(and(eq(providerInstances.provider,'jellyfin'),scope==='instance'?eq(providerInstances.id,id):and(eq(providerConnections.id,id),eq(providerConnections.userId,actorId))));
  if(scope==='connection'&&!sources.length)throw new DomainError('Source not found.',404);
  const accountIds=[...new Set(sources.map(s=>s.connection.userId))];
  const accounts=accountIds.length?await db.select({connection:providerConnections,username:users.username}).from(providerConnections)
    .innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).innerJoin(users,eq(users.id,providerConnections.userId))
    .where(and(inArray(providerConnections.userId,accountIds),eq(providerConnections.status,'connected'),eq(providerInstances.provider,'trakt'),eq(providerInstances.enabled,true))):[];
  const affected=accounts.filter(({connection:c})=>{const config=projectionConfig(c.settings);return config.enabled&&(config.source==='server'||config.availableOnly)&&sources.some(s=>s.connection.userId===c.userId&&(config.scope==='dynamic'||config.sourceIds.includes(s.connection.id)));});
  const version=createHash('sha256').update(JSON.stringify({sources:sources.map(s=>[s.connection.id,s.connection.accountGeneration,s.connection.status,s.instance.enabled]),accounts:affected.map(a=>[a.connection.id,a.connection.accountGeneration,a.connection.settings.collectionProjectionVersion,projectionConfig(a.connection.settings)])})).digest('hex');
  return {sources,affected,version};
}
/** Preview uses local selection evidence. Remote cleanup always needs its own fresh Trakt preview. */
export async function previewSourceChange(actorId:string,id:string,scope:'connection'|'instance'):Promise<SourceImpact>{
  const {sources,affected,version}=await context(actorId,id,scope),accounts:SourceImpact['accounts']=[];
  for(const {connection,username} of affected){
    const config=projectionConfig(connection.settings),excluded=sources.filter(s=>s.connection.userId===connection.userId).map(s=>s.connection.id);
    const before=await desiredProjection(connection.userId,config),after=await desiredProjection(connection.userId,config,excluded);
    const evidence=await getDb().select().from(collectionProjectionEntries).where(eq(collectionProjectionEntries.accountId,connection.syncAccountId!));
    const removals=[...before.entries.values()].filter(e=>!after.entries.has(e.workId));
    accounts.push({username,connectionId:connection.id,removals:removals.map(({workId,title})=>({workId,title})),unresolved:after.unresolved,uncertain:before.blocked||after.blocked||evidence.some(e=>e.attribution==='uncertain'||e.conflict)});
  }
  const token={id:crypto.randomUUID(),version,actorId,createdAt:new Date().toISOString()};
  if(scope==='connection')await getDb().update(providerConnections).set({settings:sql`${providerConnections.settings} || jsonb_build_object('sourceChangePreview',${token}::jsonb)`}).where(eq(providerConnections.id,id));
  else await getDb().update(providerInstances).set({settings:sql`${providerInstances.settings} || jsonb_build_object('sourceChangePreview',${token}::jsonb)`}).where(eq(providerInstances.id,id));
  return {id:token.id,accounts};
}
export async function validateSourceChange(actorId:string,id:string,scope:'connection'|'instance',previewId?:string){
  const current=await context(actorId,id,scope);
  if(!current.affected.length)return current;
  const [row]=scope==='connection'?await getDb().select({settings:providerConnections.settings}).from(providerConnections).where(eq(providerConnections.id,id)):await getDb().select({settings:providerInstances.settings}).from(providerInstances).where(eq(providerInstances.id,id));
  const saved=row.settings.sourceChangePreview as {id:string;version:string;actorId:string;createdAt:string}|undefined;
  if(!saved||saved.id!==previewId||saved.version!==current.version||saved.actorId!==actorId||Date.now()-Date.parse(saved.createdAt)>3600000)throw new DomainError('Preview the Collection impact before changing this source.',409,'source_preview_required');
  return current;
}
export async function markSourceChange(tx:Transaction,sourceIds:string[],excluded:boolean){
  if(!sourceIds.length)return;
  await tx.update(providerConnections).set({settings:sql`(${providerConnections.settings}-'sourceChangePreview') || jsonb_build_object('collectionSourceExcluded',${excluded}::boolean)`}).where(inArray(providerConnections.id,sourceIds));
}
export async function notifySourceChange(sourceIds:string[]){
  if(!sourceIds.length)return;
  const rows=await getDb().select({userId:providerConnections.userId}).from(providerConnections).where(inArray(providerConnections.id,sourceIds));
  for(const userId of new Set(rows.map(r=>r.userId)))await notify({userId,kind:'sync',title:'Collection source selection changed',body:'Review Trakt Collection export in Settings. Existing remote entries remain until you approve cleanup.',sourceKey:`collection-source-review:${userId}`});
}
