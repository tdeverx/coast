import { api, message, refreshAfterChange } from '$lib/ui/client';
import { readingFormat, sameReadingLocation, type ReadingLocation, type ReadingSessionView } from './model';
export const reader = $state({session:null as ReadingSessionView|null,file:null as File|null,visible:false,loading:false,rendering:false,syncing:false,unsaved:false,error:'',location:null as ReadingLocation|null});
let move:((location:ReadingLocation)=>Promise<void>)|null=null;
let generation=0, opening:AbortController|null=null;
function cancelOpening(){generation++;opening?.abort();opening=null;reader.loading=false;}
export function setReadingNavigator(navigate:typeof move){move=navigate;}
export async function alignReading(location:ReadingLocation|null){
 if(!location||sameReadingLocation(location,reader.location))return;
 if(move)await move(location);else await recordReading(location);
}
let sharedPosition:{sessionId:string;roomId:string;location:ReadingLocation}|null=null,publishing:Promise<void>|null=null;
/** Serialize shared locations too: an older revision retry must not undo a newer page turn. */
export function publishReading(roomId:string,location:ReadingLocation){
 const session=reader.session;if(!session)return;
 sharedPosition={sessionId:session.id,roomId,location};reader.syncing=true;
 if(!publishing)publishing=(async()=>{
  try{
   const {syncedPlayer,canControlPlayback,syncedCommand}=await import('$lib/playback/synced/client.svelte');
   while(sharedPosition){const next=sharedPosition;sharedPosition=null;
    if(reader.session?.id===next.sessionId&&syncedPlayer.room?.id===next.roomId&&syncedPlayer.room.mediaId===reader.session.workId&&syncedPlayer.room.edition===reader.session.edition&&canControlPlayback())await syncedCommand('location',{location:next.location});
   }
  }finally{publishing=null;reader.syncing=false;}
 })();
}
async function retireSession(session:ReadingSessionView){await api(`reading/sessions/${session.id}/close`,{}).catch(()=>{});}
function install(session:ReadingSessionView,file:File|null){reader.session=session;reader.file=file;reader.location=session.location;reader.visible=true;reader.unsaved=false;reader.error='';}
export async function openReading(workId:string,input:{file:File}|{connectionId:string;externalId:string}){
 cancelOpening();const epoch=generation,abort=new AbortController();opening=abort;reader.loading=true;if(!reader.unsaved)reader.error='';
 const current=()=>epoch===generation&&!abort.signal.aborted;
 let prepared:ReadingSessionView|undefined,installed=false;
 try{
  let body;
  if('file' in input){
   const format=readingFormat(input.file.name);if(!format)throw new Error('Choose a PDF, EPUB or CBZ file.');
   if(input.file.size>128*1024**2)throw new Error('Local reading files must be smaller than 128 MB.');
   const {readingFileIdentity}=await import('./reader/file-identity');
   if(!current())return;
   body={source:'local',format,edition:await readingFileIdentity(input.file,abort.signal)};
  }else body={source:'jellyfin',...input};
  if(!current())return;
  const session=prepared=await api<ReadingSessionView>(`reading/${workId}/session`,body,'POST',{signal:abort.signal});
  if(!current())return;
  // Keep the old party source alive until the replacement has been handed over.
  if(reader.location&&!await recordReading(reader.location))throw new Error(reader.error);
  if(!current())return;
  const {stopPlayback}=await import('$lib/playback/client.svelte');
  if(!current())return;
  await stopPlayback();if(!current())return;
  const {syncedPlayer,canControlPlayback,syncedCommand}=await import('$lib/playback/synced/client.svelte');
  if(!current())return;
  if(syncedPlayer.room&&!syncedPlayer.joining&&!syncedPlayer.changing&&canControlPlayback())await syncedCommand('item',{readingSessionId:session.id});
  if(!current())return;
  if(reader.session)await closeReading(false);
  if(!current())return;
  install(session,'file' in input?input.file:null);installed=true;
 }catch(cause){if(current()){reader.error=message(cause);throw cause;}}
 finally{if(prepared&&!installed)await retireSession(prepared);if(current()){opening=null;reader.loading=false;}}
}
export async function attachReading(session:ReadingSessionView){
 cancelOpening();const epoch=generation;
 let installed=false;
 try{
  if(reader.session)await closeReading(false);
  if(epoch!==generation)return;
  const {stopPlayback}=await import('$lib/playback/client.svelte');
  if(epoch!==generation)return;
  await stopPlayback();if(epoch!==generation)return;
  install(session,null);installed=true;
 }finally{if(!installed)await retireSession(session);}
}
export async function closeReading(cancelPendingOpening=true){
 if(cancelPendingOpening)cancelOpening();
 const session=reader.session;
 if(!session)return;
 const flushed=reader.location?await recordReading(reader.location):await writing;
 if(flushed===false){reader.visible=true;throw new Error(reader.error);}
 if(reader.session?.id!==session.id)return;
 reader.visible=false;reader.session=null;reader.file=null;reader.location=null;reader.unsaved=false;move=null;
 await retireSession(session);await refreshAfterChange('reading');
}
type BookmarkSnapshot={id:string;location:ReadingLocation};
let writing:Promise<boolean>|null=null,pending:BookmarkSnapshot|null=null,acknowledged:BookmarkSnapshot|null=null,saveError='';
/** One writer retains its newest failed bookmark for a page turn, close or explicit retry. */
export function recordReading(location:ReadingLocation):Promise<boolean>{
 const session=reader.session;if(!session)return Promise.resolve(true);
 reader.location=location;session.location=location;
 if(!writing&&acknowledged?.id===session.id&&sameReadingLocation(acknowledged.location,location)){
  pending=null;reader.unsaved=false;if(reader.error===saveError)reader.error='';saveError='';return Promise.resolve(true);
 }
 pending={id:session.id,location};reader.unsaved=true;
 if(!writing)writing=(async()=>{
  try{
   while(pending){const next=pending;pending=null;
    if(acknowledged?.id===next.id&&sameReadingLocation(acknowledged.location,next.location))continue;
    try{await api(`reading/sessions/${next.id}/location`,next.location);acknowledged=next;}
    catch(cause){if(acknowledged?.id===next.id)acknowledged=null;pending=pending??next;if(reader.session?.id===next.id){saveError=`Bookmark could not be saved. ${message(cause)}`;reader.error=saveError;reader.unsaved=true;}return false;}
   }
   reader.unsaved=false;if(reader.error===saveError)reader.error='';saveError='';return true;
  }finally{writing=null;}
 })();
 return writing;
}
export async function retryReadingSave(){if(reader.location)await recordReading(reader.location);}
