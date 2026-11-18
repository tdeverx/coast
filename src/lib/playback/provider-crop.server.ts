import type {JellyfinAdapter} from '#lib/providers/jellyfin/adapter.server.js';
import type {PlaybackSource} from '#lib/providers/contracts.js';
import { classifyFailure, logDiagnostic } from '#lib/server/diagnostics/index.js';
import {companionFrameCrop} from './crop';

/** Optional metadata uses the same authenticated provider transport as the selected video. */
export async function providerVideoCrop(adapter:Pick<JellyfinAdapter,'mediaCrop'>,itemId:string,source:PlaybackSource,signal?:AbortSignal){
  const frame=source.streams.find(stream=>stream.type==='Video');
  const started = performance.now();
  const deadline = AbortSignal.timeout(22000);
  try{
    const crop=await adapter.mediaCrop(itemId,signal?AbortSignal.any([signal,deadline]):deadline);
    signal?.throwIfAborted();
    const durationMs = performance.now() - started;
    void logDiagnostic(durationMs >= 1000 ? 'info' : 'debug', 'playback.operation', {
      stage: 'crop', provider: 'jellyfin', durationMs,
    });
    return frame?.width && frame.height ? companionFrameCrop(crop,frame.width,frame.height) : crop;
  }catch(error){
    signal?.throwIfAborted();
    void logDiagnostic('warn', 'playback.failed', {
      stage: 'crop', provider: 'jellyfin', failure: classifyFailure(deadline.aborted ? deadline.reason : error),
      durationMs: performance.now() - started,
    });
    return null;
  }
}
