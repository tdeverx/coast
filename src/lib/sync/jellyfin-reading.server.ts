import {and,eq,sql} from 'drizzle-orm';
import {getDb} from '#lib/server/db/index.js';
import {workEditions,readingWorks,workIdentifiers} from '#lib/server/db/schema.js';
import {getFeatureConfig} from '#lib/server/features.js';
import type {JellyfinBook} from '#lib/providers/jellyfin/reading.server.js';
import {readingProviderDetails} from '#lib/providers/reading.server.js';
import {importReading} from '#lib/catalogue/reading.server.js';
import {observeReadingFile,readingFileReference} from '#lib/catalogue/reading-files.server.js';
import {sourceEdition} from '#lib/reading/sessions.server.js';
import {jellyfinItemKey} from '#lib/providers/jellyfin/paging.js';
import {AppError} from '#lib/server/security/errors.js';
import {DomainError} from '#lib/core/errors.js';
import {ProviderHttpError} from '#lib/server/security/provider-fetch.js';
import {logDiagnostic} from '#lib/server/diagnostics/index.js';
type Context=Awaited<ReturnType<typeof import('#lib/providers/jellyfin/connection.server.js').getJellyfin>>;
/** Exact plugin identifiers or the user's explicit file link; never a title/filename guess. */
export async function importJellyfinReading(context:Context,books:JellyfinBook[],options:{access:boolean;scanId?:string;expectedResetId?:string|null;checkpoint?:(processed:number)=>Promise<void>}){
 const config=await getFeatureConfig(options.access?context.connection.userId:null);let imported=0;
 async function importBook(book:JellyfinBook):Promise<number>{
  book={...book,Id:jellyfinItemKey(book.Id)};
  const reference=await readingFileReference(book);
  const [edition]=await getDb().select({work:readingWorks}).from(workEditions).innerJoin(readingWorks,eq(readingWorks.id,workEditions.workId)).where(and(eq(workEditions.instanceId,context.instance.id),sql`replace(lower(${workEditions.externalId}),'-','')=${book.Id}`));
  let work=edition?.work;
  if(!work){
   if(!reference)return 0;
   const {provider,externalId}=reference;
   const kind=provider==='comic-vine'?'comic':'book';
   if(kind==='comic'&&!config.experimentalComics)return 0;
   const [saved]=await getDb().select({work:readingWorks}).from(workIdentifiers)
     .innerJoin(readingWorks,eq(readingWorks.id,workIdentifiers.workId))
     .where(and(eq(workIdentifiers.provider,provider),eq(workIdentifiers.externalId,externalId)));
   work=saved?.work??await importReading(await readingProviderDetails(kind,externalId));
  }
  if(work.kind==='book'&&!config.experimentalBooks||work.kind==='comic'&&!config.experimentalComics)return 0;
  await observeReadingFile({userId:context.connection.userId,connectionId:context.connection.id,instanceId:context.instance.id,generation:context.connection.accountGeneration,workId:work.id,book,reference,edition:sourceEdition(context.instance.serverIdentity??context.instance.id,book),access:options.access,scanId:options.scanId,expectedResetId:options.expectedResetId});return 1;
 }
 for(const [index,book] of books.entries()){
  try{imported+=await importBook(book);}
  catch(cause){
   const missing=cause instanceof ProviderHttpError&&cause.status===404||cause instanceof AppError&&cause.status===404&&cause.code==='not_found';
   const conflict=(cause instanceof AppError||cause instanceof DomainError)&&['reading_identity_conflict','identity_conflict'].includes(cause.code);
   if(!missing&&!conflict)throw cause;
   await logDiagnostic('warn','application.failed',{operation:'library',stage:'item-import',provider:'jellyfin',code:conflict?'catalogue.identity-conflict':'provider.item-unavailable',count:1});
  }
  await options.checkpoint?.(index+1);
 }
 return imported;
}
