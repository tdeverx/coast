import {and,eq} from 'drizzle-orm';
import {getDb} from '$lib/server/db';
import {workEditions,readingWorks} from '$lib/server/db/schema';
import {getConfig} from '$lib/server/config';
import {bookFormat,type JellyfinBook} from '$lib/providers/jellyfin/reading.server';
import {readingProviderDetails,readingWorkForEdition} from '$lib/providers/reading.server';
import {importReading} from '$lib/catalogue/reading.server';
import {observeReadingFile} from '$lib/catalogue/reading-files.server';
import {sourceEdition} from '$lib/reading/sessions.server';
import {readingReferenceSchema,type ReadingKind} from '$lib/reading/model';
import * as v from 'valibot';
type Context=Awaited<ReturnType<typeof import('$lib/providers/jellyfin/connection.server').getJellyfin>>;
/** Exact plugin identifiers or the user's explicit file link; never a title/filename guess. */
export async function importJellyfinReading(context:Context,books:JellyfinBook[],options:{access:boolean;scanId?:string;checkpoint?:(processed:number)=>Promise<void>}){
 const config=await getConfig();let imported=0;
 async function importBook(book:JellyfinBook):Promise<number>{
  if(!bookFormat(book))return 0;
  const [edition]=await getDb().select({work:readingWorks}).from(workEditions).innerJoin(readingWorks,eq(readingWorks.id,workEditions.workId)).where(and(eq(workEditions.instanceId,context.instance.id),eq(workEditions.externalId,book.Id)));
  let work=edition?.work;
  if(!work){
   const ids=Object.fromEntries(Object.entries(book.ProviderIds).map(([key,value])=>[key.toLowerCase(),value]));
   const comic=ids.comicvine,openlibrary=ids.openlibrary?.replace(/^\/(?:works|books)\//,'');
   let kind:ReadingKind|undefined,externalId:string|undefined;
   if(comic&&/^4000-[1-9][0-9]{0,14}$/.test(comic)&&config.experimentalComics){kind='comic';externalId=comic;}
   else if(config.experimentalBooks){
    if(openlibrary&&/^OL[1-9][0-9]{0,19}W$/.test(openlibrary))externalId=openlibrary;
    else {const id=openlibrary&&/^OL[1-9][0-9]{0,19}M$/.test(openlibrary)?openlibrary:ids.isbn?.replace(/[ -]/g,'').toUpperCase();if(id&&/^(?:OL[1-9][0-9]{0,19}M|[0-9]{9}[0-9X]|[0-9]{13})$/.test(id))externalId=await readingWorkForEdition(id)??undefined;}
    if(externalId)kind='book';
   }
   if(!kind||!externalId||!v.safeParse(readingReferenceSchema,{kind,externalId}).success)return 0;
   const [saved]=await getDb().select().from(readingWorks).where(and(eq(readingWorks.kind,kind),eq(readingWorks.externalId,externalId)));
   work=saved??await importReading(await readingProviderDetails(kind,externalId));
  }
  if(work.kind==='book'&&!config.experimentalBooks||work.kind==='comic'&&!config.experimentalComics)return 0;
  await observeReadingFile({userId:context.connection.userId,connectionId:context.connection.id,instanceId:context.instance.id,generation:context.connection.accountGeneration,workId:work.id,book,edition:sourceEdition(context.instance.serverIdentity??context.instance.id,book),access:options.access,scanId:options.scanId});return 1;
 }
 for(const [index,book] of books.entries()){imported+=await importBook(book);await options.checkpoint?.(index+1);}
 return imported;
}
