import { browserDiagnostic } from '$lib/ui/diagnostics';
import { api } from '$lib/ui/client';
import { notifyAction } from '$lib/ui/action-feedback.svelte';
import type { PlaybackView } from '$lib/ui/types';

export const player = $state({
  session: null as PlaybackView | null,
  audioQueue: [] as {id:string;title:string;availability:string}[],
  audioIndex: -1,
  audioNotice: '',
  role: 'idle' as 'idle' | 'playback' | 'postplay',
  paused: true,
  controlsVisible: true,
  subtitlePrompt: false,
  continuationId: '',
  muted: true,
  loading: false,
  preparationStartedAt: 0,
});
export const heroPlayer = $state({
  id: '',
  url: '',
  rect: null as { top: number; left: number; width: number; height: number } | null,
  visible: false,
  paused: false,
  ready: false,
  playing: false,
  muted: true,
});

type PlaybackController = {
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
};
let controller: PlaybackController | undefined;
export function registerPlaybackController(next: PlaybackController) {
  controller = next;
  return () => {
    if (controller === next) controller = undefined;
  };
}
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
    edition?: string;
    fromStart?: boolean;
    subtitleIndex?: number;
    maxBitrate?: number;
    continuationId?: string;
    sequence?: import('$lib/media/sequence').SequenceContext;
  } = {}
) {
  if (player.loading) return;
  if (
    player.session?.mediaId === mediaId &&
    player.role === 'playback' &&
    JSON.stringify(options.sequence) === JSON.stringify(player.session.sequence) &&
    !options.fromStart &&
    options.sourceId === undefined &&
    options.edition === undefined &&
    options.subtitleIndex === undefined &&
    options.maxBitrate === undefined
  ) {
    player.controlsVisible = true;
    await controller?.resume();
    return;
  }
  player.loading = true;
  player.preparationStartedAt = performance.now();
  browserDiagnostic('playback.start');
  try {
    if (player.session) await controller?.stop();
    const video = document.createElement('video');
    const videoCodecs = ['h264'];
    if (video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')) videoCodecs.push('hevc');
    if (video.canPlayType('video/webm; codecs="vp9"')) videoCodecs.push('vp9');
    if (video.canPlayType('video/mp4; codecs="av01.0.05M.08"')) videoCodecs.push('av1');
    const session = await api<PlaybackView>('playback', {
      mediaId,
      ...options,
      browser: {
        containers: ['mp4', 'm4v', 'webm', 'mp3', 'flac', 'ogg', 'm4a', 'aac', 'wav'],
        videoCodecs,
        audioCodecs: ['aac', 'mp3', 'opus', 'vorbis', 'flac'],
        nativeHls: !!video.canPlayType('application/vnd.apple.mpegurl'),
        hlsJs: typeof MediaSource !== 'undefined',
        maxBitrate: options.maxBitrate,
      },
    });
    player.session = session;
    player.continuationId = options.continuationId ?? '';
    player.subtitlePrompt = session.subtitlePrompt;
    player.role = 'playback';
    player.paused = true;
    player.controlsVisible = true;
    setPlaybackMuted(false);
  } catch (error) {
    browserDiagnostic('playback.failed', { failure: 'unexpected' });
    throw error;
  } finally {
    player.loading = false;
  }
}
export function presentTrailer(
  id: string,
  url: string,
  rect: { top: number; left: number; width: number; height: number }
) {
  heroPlayer.rect = rect;
  if (heroPlayer.id !== id || heroPlayer.url !== url) {
    heroPlayer.id = id;
    heroPlayer.url = url;
    heroPlayer.playing = false;
    heroPlayer.ready = false;
    heroPlayer.paused = false;
    heroPlayer.muted = true;
  }
  heroPlayer.visible = true;
}

export async function playMusic(workId:string,continuing=false){
  const result=await api<{items:{id:string;title:string;availability:string}[];continueId:string|null}>(`music/${workId}/queue`,undefined,'GET');
  return playMusicQueue(result,continuing);
}
export async function playMusicQueue(result:{items:{id:string;title:string;availability:string}[];continueId:string|null},continuing=false){
  player.audioQueue=result.items;player.audioIndex=continuing?Math.max(0,result.items.findIndex(item=>item.id===result.continueId))-1:-1;player.audioNotice='';
  return advanceMusic(1,continuing);
}
export async function playSavedMusicQueue(){return playMusicQueue(await api('music/queue',undefined,'GET'));}
export async function advanceMusic(direction:1|-1=1,continuing=false){
  let index=player.audioIndex+direction;
  const skipped:string[]=[];
  while(index>=0&&index<player.audioQueue.length){
    const entry=player.audioQueue[index];player.audioIndex=index;
    if(entry.availability==='available'){
      try{await playMedia(entry.id,{mediaType:'audio',fromStart:!continuing});player.audioNotice=skipped.length?`Skipped unavailable tracks: ${skipped.join(', ')}`:'';if(player.audioNotice)notifyAction(player.audioNotice);return;}catch{skipped.push(entry.title);}
    }else skipped.push(entry.title);
    index+=direction;
  }
  await controller?.stop();player.audioNotice=skipped.length?`No playable tracks remain. Skipped: ${skipped.join(', ')}`:'Queue finished.';
  if(skipped.length)notifyAction(player.audioNotice);
}
