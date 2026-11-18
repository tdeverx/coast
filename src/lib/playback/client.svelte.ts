import { PlaybackSavePending } from '#lib/playback/stop.js';
import { browserDiagnostic } from '#lib/ui/diagnostics.js';
import { ApiError, api, capturePlaybackApi } from '#lib/ui/client.js';
import { feedbackForViewer } from '#lib/ui/action-feedback.svelte.js';
import { consumeSubtitle, pendingSubtitle } from './subtitle-selection.svelte';
import type { PlaybackView } from '#lib/ui/types.js';

export const player = $state({
  session: null as PlaybackView | null,
  audioQueue: [] as {id:string;title:string;availability:string}[],
  audioIndex: -1,
  role: 'idle' as 'idle' | 'playback' | 'postplay',
  paused: true,
  controlsVisible: true,
  browsing: false,
  subtitlePrompt: false,
  continuationId: '',
  muted: true,
  loading: false,
  preparationMediaType: 'video' as 'audio' | 'video',
  preparationStartedAt: 0,
});
export const heroPlayer = $state({
  outcome: 'idle' as 'idle'|'ended'|'failed',
  generation: 0,
  crop: null as import('./crop').VideoCrop|null,
  id: '',
  url: '',
  visible: false,
  paused: false,
  ready: false,
  playing: false,
  muted: true,
});

type PlaybackController = {
  beginPlaybackGesture: (type:'audio'|'video') => void;
  stop: (cancelPreparing?: boolean) => Promise<void>;
  waitForStop: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  snapshot: () => {positionSeconds:number;buffering:boolean;unavailable?:boolean;subtitleIndex?:number};
  align: (state:{positionSeconds:number;paused:boolean;force?:boolean}) => void;
};
let controller: PlaybackController | undefined;
export function registerPlaybackController(next: PlaybackController) {
  controller = next;
  return () => {
    if (controller === next) controller = undefined;
  };
}
export function beginPlaybackGesture(type:'audio'|'video'){controller?.beginPlaybackGesture(type);}
let preparationRevision = 0;
let preparing: AbortController | undefined;
let releasePreparation:(()=>void)|undefined;
export function cancelPlaybackPreparation(){preparationRevision++;preparing?.abort();preparing=undefined;releasePreparation?.();releasePreparation=undefined;player.loading=false;}
export async function stopPlayback(){cancelPlaybackPreparation();await controller?.stop(false);}
export function playbackSnapshot(){return controller?.snapshot();}
export function alignPlayback(state:{positionSeconds:number;paused:boolean;force?:boolean}){controller?.align(state);}
export function pausePlayback() {
  controller?.pause();
}
export function setPlaybackMuted(muted: boolean) {
  if (!muted) heroPlayer.muted = true;
  player.muted = muted;
}
export function setHeroMuted(muted: boolean) {
  if (!muted) player.muted = true;
  heroPlayer.muted = muted;
}
export async function playMedia(
  mediaId: string,
  options: {
    mediaType?: 'audio' | 'video';
    sourceId?: string;
    fallbackSessionId?: string;
    reconfigureSessionId?: string;
    edition?: string;
    editionName?:string;
    expectedDuration?: number;
    fromStart?: boolean;
    retry?: boolean;
    subtitleIndex?: number;
    subtitleSourceId?: string;
    maxBitrate?: number;
    quality?: import('./quality').PlaybackQuality;
    continuationId?: string;
    sequence?: import('#lib/media/sequence.js').SequenceContext;
  } = {}
) {
  if (player.loading) return;
  const intent = preparationRevision;
  const {syncedPlayer,canControlPlayback,syncedCommand}=await import('./synced/client.svelte');
  if(player.loading||intent!==preparationRevision)return;
  const room=syncedPlayer.room;
  const previous = options.reconfigureSessionId ? player.session : null;
  if (options.reconfigureSessionId && (!previous || previous.id !== options.reconfigureSessionId || previous.shareId ||
      room || player.role !== 'playback' || previous.mediaId !== mediaId)) return;
  if(room&&!syncedPlayer.changing&&!canControlPlayback()){syncedPlayer.notice='Playback is controlled by the host.';return;}
  const syncSwitch=!!room&&!syncedPlayer.changing;
  if(syncSwitch)syncedPlayer.changing=true;
  const subtitle = options.mediaType !== 'audio' && options.subtitleIndex === undefined && !options.fallbackSessionId && !options.reconfigureSessionId
    ? pendingSubtitle(mediaId, options) : undefined;
  if (subtitle) options = { ...options, sourceId: subtitle.availabilityId, subtitleSourceId: subtitle.sourceId, subtitleIndex: subtitle.index };
  if (
    player.session?.mediaId === mediaId &&
    player.role === 'playback' &&
    JSON.stringify(options.sequence) === JSON.stringify(player.session.sequence) &&
    !options.fromStart &&
    !options.retry &&
    options.fallbackSessionId === undefined &&
    options.reconfigureSessionId === undefined &&
    options.sourceId === undefined &&
    options.edition === undefined &&
    options.editionName === undefined &&
    options.expectedDuration === undefined &&
    options.subtitleIndex === undefined &&
    options.maxBitrate === undefined &&
    options.quality === undefined
  ) {
    player.controlsVisible = true;
    if(syncSwitch)syncedPlayer.changing=false;
    await controller?.resume();
    return;
  }
  player.preparationMediaType=options.mediaType??'video';
  player.loading = true;
  const revision=++preparationRevision, abort=new AbortController(), request=capturePlaybackApi();
  preparing=abort;
  releasePreparation=()=>{if(syncSwitch&&syncedPlayer.room?.id===room?.id)syncedPlayer.changing=false;};
  const current=()=>revision===preparationRevision&&!abort.signal.aborted;
  player.preparationStartedAt = performance.now();
  browserDiagnostic('playback.start');
  try {
    if (!previous) {
      const {reader,closeReading}=await import('#lib/reading/client.svelte.js');if(reader.session)await closeReading();
      if(!current())return;
      if (player.session) await controller?.stop(false);
      if(!current())return;
      await controller?.waitForStop();
      if(!current())return;
    }
    const video = document.createElement('video');
    const videoCodecs = ['h264'];
    if (video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')) videoCodecs.push('hevc');
    if (video.canPlayType('video/webm; codecs="vp9"')) videoCodecs.push('vp9');
    if (video.canPlayType('video/mp4; codecs="av01.0.05M.08"')) videoCodecs.push('av1');
    const audioCodecs = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];
    if (video.canPlayType('audio/mp4; codecs="ac-3"')) audioCodecs.push('ac3');
    if (video.canPlayType('audio/mp4; codecs="ec-3"')) audioCodecs.push('eac3');
    const { retry: _retry, ...requestOptions } = options;
    const reconfigurePosition = previous ? controller?.snapshot().positionSeconds : undefined;
    const session = await request<PlaybackView>('playback', {
      mediaId,
      ...requestOptions,
      reconfigurePosition,
      browser: {
        containers: ['mp4', 'm4v', 'webm', 'mp3', 'flac', 'ogg', 'm4a', 'aac', 'wav'],
        videoCodecs,
        audioCodecs,
        nativeHls: !!video.canPlayType('application/vnd.apple.mpegurl'),
        hlsJs: typeof MediaSource !== 'undefined',
        maxBitrate: options.maxBitrate,
      },
    },'POST',{signal:abort.signal});
    if(!current() || previous && player.session?.id !== previous.id){await request(`playback/${session.id}/progress`,{event:'stop',positionSeconds:session.startSeconds,durationSeconds:session.durationSeconds}).catch(()=>{});return;}
    if (previous) {
      const atSwitch = controller?.snapshot();
      const start = atSwitch?.positionSeconds ?? session.startSeconds;
      const end = session.durationSeconds > 0 ? Math.max(0, session.durationSeconds - 0.1) : Infinity;
      const currentTrack = previous.subtitles?.find(track => track.index === atSwitch?.subtitleIndex);
      const matching = options.edition === undefined
        ? session.subtitles?.find(track => track.index === atSwitch?.subtitleIndex)
        : currentTrack && session.subtitles?.find(track => track.language === currentTrack.language && track.label === currentTrack.label);
      player.session = {
        ...session, handoff: true, startPaused: player.paused, startSeconds: Math.min(start, end),
        initialCrop: options.edition === undefined ? previous.initialCrop : session.initialCrop,
        defaultSubtitleIndex: atSwitch?.subtitleIndex === -1 ? null : matching?.index ?? session.defaultSubtitleIndex,
      };
      player.subtitlePrompt = false;
      return;
    }
    player.session = session;
    if (subtitle) consumeSubtitle(subtitle);
    player.continuationId = options.continuationId ?? '';
    player.subtitlePrompt = session.subtitlePrompt;
    player.role = 'playback';
    player.paused = true;
    player.browsing = false;
    player.controlsVisible = true;
    setPlaybackMuted(false);
    if(syncSwitch)await syncedCommand('item',{playbackId:session.id,queueIndex:Math.max(0,player.audioIndex),...(session.mediaType==='audio'?{queue:player.audioQueue.map(item=>item.id)}:{})});
  } catch (error) {
    if(!current())return;
    if(syncSwitch&&player.session)await controller?.stop();
    // HTTP outcomes have a server request event and a detailed preparation result.
    if (!(error instanceof ApiError) && !(error instanceof PlaybackSavePending)) browserDiagnostic('playback.failed', {
      stage: 'player', mediaType: player.preparationMediaType, failure: error instanceof TypeError ? 'network' : 'unexpected',
    });
    throw error;
  } finally {
    if(current()){preparing=undefined;player.loading = false;releasePreparation?.();releasePreparation=undefined;}
  }
}
export function presentTrailer(
  id: string,
  url: string,
  crop: import('./crop').VideoCrop|null = null
) {
  heroPlayer.id = id;
  heroPlayer.url = url;
  heroPlayer.crop = crop;
  heroPlayer.playing = false;
  heroPlayer.ready = false;
  heroPlayer.paused = false;
  heroPlayer.outcome = 'idle';
  heroPlayer.generation++;
  heroPlayer.visible = true;
}

type MusicQueue = { items: { id: string; title: string; availability: string }[]; continueId: string | null };

async function prepareMusicQueue(path: string, continuing = false, shuffle = false) {
  const intent = preparationRevision;
  await controller?.waitForStop();
  if (intent !== preparationRevision) return;
  const result = await api<MusicQueue>(path, undefined, 'GET');
  if (intent !== preparationRevision) return;
  if (shuffle) {
    const items = [...result.items];
    for (let index = items.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [items[index], items[other]] = [items[other], items[index]];
    }
    return playMusicQueue({ items, continueId: null });
  }
  return playMusicQueue(result, continuing);
}

export function playMusic(workId: string, continuing = false, shuffle = false) {
  return prepareMusicQueue(`music/${workId}/queue`, continuing, shuffle);
}
export function playMusicArtist(workId: string, shuffle = false) {
  return prepareMusicQueue(`music/artists/${workId}/queue`, false, shuffle);
}
export async function playMusicQueue(result:MusicQueue,continuing=false){
  const intent=preparationRevision;
  const {syncedPlayer,canControlPlayback,canEditPartyQueue}=await import('./synced/client.svelte');
  if(intent!==preparationRevision)return;
  if(syncedPlayer.room&&!canControlPlayback()){syncedPlayer.notice='Playback is controlled by the host.';return;}
  if(syncedPlayer.room&&!canEditPartyQueue()){syncedPlayer.notice='Only the host can replace this queue.';return;}
  player.audioQueue=result.items;player.audioIndex=continuing?Math.max(0,result.items.findIndex(item=>item.id===result.continueId))-1:-1;
  return advanceMusic(1,continuing,true);
}
export async function playSavedMusicQueue(){
  const intent=preparationRevision;
  await controller?.waitForStop();
  if(intent!==preparationRevision)return;
  const result=await api<Parameters<typeof playMusicQueue>[0]>('music/queue',undefined,'GET');
  if(intent!==preparationRevision)return;
  return playMusicQueue(result);
}
export async function advanceMusic(direction:1|-1=1,continuing=false,replacingQueue=false){
  const notifyAction=feedbackForViewer().notify;
  const intent=preparationRevision;
  const {syncedPlayer,canControlPlayback}=await import('./synced/client.svelte');
  if(intent!==preparationRevision)return;
  if(syncedPlayer.room&&!canControlPlayback())return;
  if(syncedPlayer.room&&!replacingQueue)player.audioQueue=syncedPlayer.room.queueItems;
  let index=player.audioIndex+direction;
  const skipped:string[]=[];
  while(index>=0&&index<player.audioQueue.length){
    const entry=player.audioQueue[index];player.audioIndex=index;
    if(entry.availability==='available'){
      try{
        await playMedia(entry.id,{mediaType:'audio',fromStart:!continuing});
        if(skipped.length)notifyAction(`Skipped unavailable tracks: ${skipped.join(', ')}`);
        return;
      }catch(cause){if(cause instanceof PlaybackSavePending)throw cause;skipped.push(entry.title);}
    }else skipped.push(entry.title);
    index+=direction;
  }
  await controller?.stop();
  notifyAction(skipped.length?`No playable tracks remain. Skipped: ${skipped.join(', ')}`:'Queue finished.');
}
