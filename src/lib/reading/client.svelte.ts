import { api, message, refreshAfterChange } from '$lib/ui/client';
import { readingFormat, sameReadingLocation, type ReadingLocation, type ReadingSessionView } from './model';
export const reader = $state({session:null as ReadingSessionView|null,file:null as File|null,visible:false,loading:false,rendering:false,syncing:false,error:'',location:null as ReadingLocation|null});
let move:((location:ReadingLocation)=>Promise<void>)|null=null;
let generation=0;
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
export async function openReading(workId:string,input:{file:File}|{connectionId:string;externalId:string}){
 const epoch=++generation;reader.loading=true;reader.error='';
 try{
  let body;
  if('file' in input){
   const format=readingFormat(input.file.name);if(!format)throw new Error('Choose a PDF, EPUB or CBZ file.');
   if(input.file.size>128*1024**2)throw new Error('Local reading files must be smaller than 128 MB.');
   const {readingFileIdentity}=await import('./reader/file-identity');
   body={source:'local',format,edition:await readingFileIdentity(input.file)};
  }else body={source:'jellyfin',...input};
  const session=await api<ReadingSessionView>(`reading/${workId}/session`,body);
  if(epoch!==generation){await api(`reading/sessions/${session.id}/close`,{});return;}
  if(reader.session)await closeReading(false);
  if(epoch!==generation){await api(`reading/sessions/${session.id}/close`,{});return;}
  reader.session=session;reader.file='file' in input?input.file:null;reader.location=session.location;reader.visible=true;
  const {stopPlayback}=await import('$lib/playback/client.svelte');await stopPlayback();
  const {syncedPlayer,canControlPlayback,syncedCommand}=await import('$lib/playback/synced/client.svelte');
  if(syncedPlayer.room&&!syncedPlayer.joining&&!syncedPlayer.changing&&canControlPlayback())await syncedCommand('item',{readingSessionId:session.id});
 }catch(cause){if(epoch===generation)reader.error=message(cause);throw cause;}finally{if(epoch===generation)reader.loading=false;}
}
export async function attachReading(session:ReadingSessionView){
 if(reader.session)await closeReading(false);
 reader.session=session;reader.file=null;reader.location=session.location;reader.visible=true;
 const {stopPlayback}=await import('$lib/playback/client.svelte');await stopPlayback();
}
export async function closeReading(cancelOpening=true){
 if(cancelOpening)generation++;
 const session=reader.session;
 const flushed=reader.location?recordReading(reader.location):writing;
 reader.visible=false;reader.session=null;reader.file=null;reader.location=null;move=null;
 if(session){await flushed;await api(`reading/sessions/${session.id}/close`,{}).catch(()=>{});await refreshAfterChange('reading');}
}
let writing:Promise<void>|null=null,pending:{id:string;location:ReadingLocation}|null=null;
/** One write at a time; fast page turns replace pending positions rather than race older writes. */
export function recordReading(location:ReadingLocation):Promise<void>{
 const session=reader.session;if(!session)return Promise.resolve();
 reader.location=location;session.location=location;pending={id:session.id,location};
 if(!writing)writing=(async()=>{
  try{while(pending){const next=pending;pending=null;try{await api(`reading/sessions/${next.id}/location`,next.location);}catch(cause){if(reader.session?.id===next.id)reader.error=message(cause);}}}
  finally{writing=null;}
 })();
 return writing;
}
