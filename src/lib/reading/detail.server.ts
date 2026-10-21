import {requireFeature} from '#lib/server/features.js';
import {and,eq,sql,desc,asc} from 'drizzle-orm';
import * as v from 'valibot';
import {getDb,getSql} from '#lib/server/db/index.js';
import {readingWorks,workIdentifiers} from '#lib/server/db/schema.js';
import {pageNumberSchema,pagination,PAGE_SIZE} from '#lib/server/queries/pagination.js';
import {readingProviderDetails} from '#lib/providers/reading.server.js';
import {readingWork,readingCards} from './query.server';
import type {ReadingCredit} from './model';

/** Reuse the bounded metadata cache only after the Credits row becomes visible. */
export async function readingCredits(userId:string,id:string):Promise<ReadingCredit[]>{
 const item=await readingWork(userId,id);
 if(item.kind!=='comic')return item.authors.map(name=>({name,role:'Author'}));
 const [identity]=await getDb().select({id:workIdentifiers.externalId}).from(workIdentifiers)
  .where(and(eq(workIdentifiers.workId,id),eq(workIdentifiers.provider,'comic-vine'))).limit(1);
 if(!identity)return item.authors.map(name=>({name,role:'Author'}));
 const credits=(await readingProviderDetails(item.kind,identity.id)).credits??item.authors.map(name=>({name,role:'Writer'}));
 return [...new Map(credits.map(person=>[JSON.stringify([person.name,person.role]),person])).values()];
}

/** Related works are ranked and paged in SQL; hydrate just the requested card page. */
export async function relatedReading(userId:string,id:string,requested=1){
 const item=await readingWork(userId,id),page=v.parse(pageNumberSchema,requested),db=getDb();
 const authorNames=sql`array[${sql.join(item.authors.map(name=>sql`${name}`),sql`, `)}]::text[]`;
 const subjectNames=sql`array[${sql.join(item.subjects.map(name=>sql`${name}`),sql`, `)}]::text[]`;
 const authors=sql`(select count(*) from unnest(${readingWorks.authors}) a where a=any(${authorNames}))`;
 const subjects=sql`(select count(*) from unnest(${readingWorks.subjects}) s where s=any(${subjectNames}))`;
 const where=and(eq(readingWorks.kind,item.kind),sql`${readingWorks.id}<>${id}::uuid`,sql`(${readingWorks.authors} && ${authorNames} or ${readingWorks.subjects} && ${subjectNames})`);
 const [totals]=await db.select({total:sql<number>`count(*)::int`}).from(readingWorks).where(where);
 const paging=pagination(totals.total,page);
 const rows=await db.select().from(readingWorks).where(where).orderBy(desc(sql`${authors}*4+${subjects}`),asc(readingWorks.title),asc(readingWorks.id)).limit(PAGE_SIZE).offset((paging.page-1)*PAGE_SIZE);
 return {...paging,total:totals.total,items:await readingCards(userId,userId,rows)};
}

/** Visibility is evaluated separately for ratings and progress using the actual book/comic kind. */
export async function readingCommunity(userId:string,id:string){
 await requireFeature(userId,'social');
 const item=await readingWork(userId,id),db=getSql();
 const [result]=await db`select
  (select count(*)::int from ratings r join users u on u.id=r.user_id where r.media_id=${id}::uuid and not u.disabled and coast_feature_enabled(u.id,'social') and social_visible(u.id,${userId}::uuid,'ratings',${item.kind})) as rated,
  (select avg(r.value)::float from ratings r join users u on u.id=r.user_id where r.media_id=${id}::uuid and not u.disabled and coast_feature_enabled(u.id,'social') and social_visible(u.id,${userId}::uuid,'ratings',${item.kind})) as rating,
  (select count(*)::int from reading_progress p join users u on u.id=p.user_id where p.work_id=${id}::uuid and p.state='completed' and not u.disabled and coast_feature_enabled(u.id,'social') and social_visible(u.id,${userId}::uuid,'progress',${item.kind})) as completed,
  (select count(*)::int from reading_progress p join users u on u.id=p.user_id where p.work_id=${id}::uuid and p.state='reading' and not u.disabled and coast_feature_enabled(u.id,'social') and social_visible(u.id,${userId}::uuid,'progress',${item.kind})) as reading`;
 return {rated:Number(result.rated),rating:result.rating===null?null:Number(result.rating),completed:Number(result.completed),reading:Number(result.reading)};
}
