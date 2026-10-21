import {and,eq,sql} from 'drizzle-orm';
import * as v from 'valibot';
import {getDb} from '#lib/server/db/index.js';
import {readingGroups,readingGroupMembers,readingWorks,workIdentifiers,readingProgress} from '#lib/server/db/schema.js';
import {requireEnabledCategory} from '#lib/server/experimental.js';
import {getFeatureConfig} from '#lib/server/features.js';
import {AppError} from '#lib/server/security/errors.js';
import {readingWork,readingProviderCards} from './query.server';
import {readingGroupIssues,readingProviderDetails,readingEditions} from '#lib/providers/reading.server.js';
import {importReading} from '#lib/catalogue/reading.server.js';
import {pageNumberSchema} from '#lib/server/queries/pagination.js';

async function groupsForReading(userId:string,workId:string){
 const item=await readingWork(userId,workId),db=getDb();
 const lookup=()=>db.select({group:readingGroups})
  .from(readingGroups).innerJoin(readingGroupMembers,eq(readingGroupMembers.groupId,readingGroups.id))
  .where(eq(readingGroupMembers.workId,workId)).orderBy(readingGroups.title,readingGroups.id).limit(20).then(rows=>rows.map(row=>row.group));
 let groups=await lookup();
 // Existing saved issues predate container metadata. Resolve just the requested
 // issue through the normal bounded metadata cache, never infer from its title.
 if(!groups.length&&item.kind==='comic'){
  const [identity]=await db.select({id:workIdentifiers.externalId}).from(workIdentifiers)
   .where(and(eq(workIdentifiers.workId,workId),eq(workIdentifiers.provider,'comic-vine'))).limit(1);
  if(identity){await importReading(await readingProviderDetails('comic',identity.id));groups=await lookup();}
 }
 return groups;
}
/** Unpack the verified run directly into the issue page's normal lazy Shelf. */
export async function readingIssuesForWork(userId:string,workId:string,requested=1){
 const page=v.parse(pageNumberSchema,requested),groups=await groupsForReading(userId,workId);
 const group=groups.find(group=>group.provider==='comic-vine');
 if(!group)return {items:[],page:1,pages:1,total:0,title:'Issues'};
 return {...await issuesForGroup(userId,group,page),title:group.title,href:`/media/reading-collection/${group.id}`};
}
async function issuesForGroup(userId:string,group:typeof readingGroups.$inferSelect,page:number){
 requireEnabledCategory(await getFeatureConfig(userId),group.kind);
 const result=await readingGroupIssues(group.externalId,page);
 return {group,...result,
  items:await readingProviderCards(userId,result.items),pages:Math.max(1,Math.min(1000,Math.ceil(result.total/10)))};
}

export async function readingGroupData(userId:string,id:string,requested=1){
 v.parse(v.pipe(v.string(),v.uuid()),id);const page=v.parse(pageNumberSchema,requested);
 const [group]=await getDb().select().from(readingGroups).where(eq(readingGroups.id,id));
 if(!group)throw new AppError(404,'Reading collection not found.','not_found');
 return issuesForGroup(userId,group,page);
}
/** Root details stay local; provider issue pages are owned by the lazy Issues shelf. */
export async function readingGroupDetail(userId:string,id:string){
 v.parse(v.pipe(v.string(),v.uuid()),id);
 const [group]=await getDb().select().from(readingGroups).where(eq(readingGroups.id,id));
 if(!group)throw new AppError(404,'Reading collection not found.','not_found');
 requireEnabledCategory(await getFeatureConfig(userId),group.kind);
 const [cover]=await getDb().select({url:readingWorks.coverUrl}).from(readingGroupMembers)
  .innerJoin(readingWorks,eq(readingWorks.id,readingGroupMembers.workId))
  .where(and(eq(readingGroupMembers.groupId,id),eq(readingWorks.kind,group.kind))).orderBy(readingWorks.id).limit(1);
 return {group,cover:cover?.url??null,statistics:await readingGroupStatistics(userId,id)};
}
export async function editionsForReading(userId:string,workId:string,requested=1){
 const item=await readingWork(userId,workId),page=v.parse(pageNumberSchema,requested);
 const [identity]=await getDb().select({id:workIdentifiers.externalId}).from(workIdentifiers)
  .where(and(eq(workIdentifiers.workId,workId),eq(workIdentifiers.provider,'openlibrary'))).limit(1);
 if(!identity)return {items:[],page:1,pages:1,total:0};
 const result=await readingEditions(identity.id,page);
 return {...result,items:result.items.map(edition=>({id:`edition:${edition.externalId}`,kind:item.kind,title:edition.title,
  href:edition.sourceUrl,poster:edition.coverUrl,captionSubtitle:[edition.published,...edition.publishers].filter(Boolean).join(' · ')}))};
}
/** These are locally known issues, not an assumed complete provider run. */
export async function readingGroupStatistics(userId:string,id:string){
 const [group]=await getDb().select().from(readingGroups).where(eq(readingGroups.id,id));
 if(!group)throw new AppError(404,'Reading collection not found.','not_found');
 requireEnabledCategory(await getFeatureConfig(userId),group.kind);
 const [result]=await getDb().select({issues:sql<number>`count(*)::int`,
  completed:sql<number>`count(*) filter(where ${readingProgress.state}='completed')::int`,
  reading:sql<number>`count(*) filter(where ${readingProgress.state}='reading')::int`,
  available:sql<number>`count(*) filter(where exists(select 1 from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id where a.media_id=${readingGroupMembers.workId} and a.user_id=${userId}::uuid and a.state='available' and c.status='connected' and i.enabled))::int`,
 }).from(readingGroupMembers).leftJoin(readingProgress,and(eq(readingProgress.workId,readingGroupMembers.workId),eq(readingProgress.userId,userId))).where(eq(readingGroupMembers.groupId,id));
 return result;
}
