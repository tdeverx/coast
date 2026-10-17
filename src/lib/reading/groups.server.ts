import {and,eq} from 'drizzle-orm';
import * as v from 'valibot';
import {getDb} from '$lib/server/db';
import {readingGroups,readingGroupMembers,workIdentifiers} from '$lib/server/db/schema';
import {requireEnabledCategory} from '$lib/server/experimental';
import {getFeatureConfig} from '$lib/server/features';
import {AppError} from '$lib/server/security/errors';
import {readingWork,readingProviderCards} from './query.server';
import {readingGroupIssues,readingProviderDetails,readingEditions} from '$lib/providers/reading.server';
import {importReading} from '$lib/catalogue/reading.server';
import {pageNumberSchema} from '$lib/server/queries/pagination';

export async function groupsForReading(userId:string,workId:string){
 const item=await readingWork(userId,workId),db=getDb();
 const lookup=()=>db.select({id:readingGroups.id,title:readingGroups.title,kind:readingGroups.kind})
  .from(readingGroups).innerJoin(readingGroupMembers,eq(readingGroupMembers.groupId,readingGroups.id))
  .where(eq(readingGroupMembers.workId,workId)).orderBy(readingGroups.title,readingGroups.id).limit(20);
 let groups=await lookup();
 // Existing saved issues predate container metadata. Resolve just the requested
 // issue through the normal bounded metadata cache, never infer from its title.
 if(!groups.length&&item.kind==='comic'){
  const [identity]=await db.select({id:workIdentifiers.externalId}).from(workIdentifiers)
   .where(and(eq(workIdentifiers.workId,workId),eq(workIdentifiers.provider,'comic-vine'))).limit(1);
  if(identity){await importReading(await readingProviderDetails('comic',identity.id));groups=await lookup();}
 }
 return {items:groups.map(group=>({id:`reading-group:${group.id}`,kind:'collection' as const,title:group.title,
  href:`/media/reading-collection/${group.id}`,poster:item.coverUrl,captionSubtitle:group.kind==='comic'?'Comic volume':'Book collection'})),page:1,pages:1,total:groups.length};
}
export async function readingGroupData(userId:string,id:string,requested=1){
 v.parse(v.pipe(v.string(),v.uuid()),id);const page=v.parse(pageNumberSchema,requested);
 const [group]=await getDb().select().from(readingGroups).where(eq(readingGroups.id,id));
 if(!group)throw new AppError(404,'Reading collection not found.','not_found');
 requireEnabledCategory(await getFeatureConfig(userId),group.kind);
 const result=await readingGroupIssues(group.externalId,page);
 return {group,...result,items:await readingProviderCards(userId,result.items),pages:Math.max(1,Math.min(1000,Math.ceil(result.total/10)))};
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
