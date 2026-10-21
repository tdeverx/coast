import type {JellyfinAdapter} from '#lib/providers/jellyfin/adapter.server.js';
import type {PlaybackSource} from '#lib/providers/contracts.js';
import {companionFrameCrop} from './crop';

/** Optional metadata uses the same authenticated provider transport as the selected video. */
export async function providerVideoCrop(adapter:Pick<JellyfinAdapter,'mediaCrop'>,itemId:string,source:PlaybackSource,signal?:AbortSignal){
  const frame=source.streams.find(stream=>stream.type==='Video');
  if(!frame?.width||!frame.height)return null;
  try{
    const deadline=AbortSignal.timeout(22000);
    const crop=await adapter.mediaCrop(itemId,signal?AbortSignal.any([signal,deadline]):deadline);
    signal?.throwIfAborted();
    return companionFrameCrop(crop,frame.width,frame.height);
  }catch{signal?.throwIfAborted();return null;}
}
