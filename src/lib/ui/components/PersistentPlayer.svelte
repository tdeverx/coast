<script lang="ts">
  import {page} from '$app/state';
  import {syncedPlayer,isSyncHost,canControlPlayback,canEditPartyQueue,syncedCommand,leaveSynced,joinSynced} from '#lib/playback/synced/client.svelte.js';
  import { browserDiagnostic } from '#lib/ui/diagnostics.js';
  import { sequencePath } from '#lib/media/sequence.js';
  import { onMount, untrack, tick } from 'svelte';
  import { refreshAfterChange } from '#lib/ui/client.js';
  import { advanceMusic, playSavedMusicQueue, playMedia, registerPlaybackController, setPlaybackMuted, cancelPlaybackPreparation } from '#lib/playback/client.svelte.js';
  import { useMenuPreview, menuCondition } from '#lib/ui/controls/menu-preview.js';
  import { usePlayback } from '#lib/playback/context.svelte.js';
  import { createSubtitleControls } from '#lib/playback/subtitle-controls.svelte.js';
  import { savePlaybackSnapshot, takePlaybackSnapshot } from '#lib/playback/persistence.js';
  import SubtitleMenu from './SubtitleMenu.svelte';
  import SubtitleSearchDialog from './SubtitleSearchDialog.svelte';
  import PlaybackQualityMenu from './PlaybackQualityMenu.svelte';
  import type { PlaybackQuality } from '#lib/playback/quality.js';
  import { bufferedAhead, streamHasStopped, playbackFailureMessage } from '#lib/playback/failures.js';
  import { actualPlayedDelta } from '#lib/playback/listening.js';
  import { noCrop, resolveFrameCrop, videoFitStyle } from '#lib/playback/crop.js';
  import { message, capturePlaybackApi } from '#lib/ui/client.js';
  import { createPlaybackReports } from '#lib/playback/reports.js';
  import { createPlaybackStop, PlaybackSavePending, type PlaybackSave } from '#lib/playback/stop.js';
  import { useClient, reportFailure, reportImportFailure } from '#lib/ui/client-context.js';
  import { feedbackForViewer, type Feedback } from '#lib/ui/action-feedback.svelte.js';
  import type { MediaView } from '#lib/ui/types.js';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
  import Icon from './Icon.svelte';

  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import PlaybackTimeline from './PlaybackTimeline.svelte';

  const { api, change } = useClient();

  const { player, preview } = usePlayback();
  const menuFixture = preview ? useMenuPreview() : undefined;

  let video = $state<HTMLVideoElement>(null!);
  let audio = $state<HTMLAudioElement>(null!);
  let host: HTMLDivElement;
  let current = $state(0),
    duration = $state(0),
    crop = $state(false),
    volume = $state(1),
    subtitle = $state(-1),
    error = $state(''),
    trackingNotice = $state('');
  let frame = $state({ width: 0, height: 0 }),
    bounds = $state({ width: 0, height: 0 }),
    next = $state<MediaView | null>(null),
    saved = $state(false),
    saving = $state(false);
  let lastReport = 0,
    startedSessionId = '',
    acknowledgedSessionId = '',
    hls: { destroy: () => void } | null = null,
    closed = false;
  const reports = createPlaybackReports();
  const stopNotice = Symbol('playback final save');
  let stopFeedback: Feedback | undefined;
  const stopSave = createPlaybackStop(state => {
    if (state === 'saving') stopFeedback?.pending('Saving playback progress…', stopNotice);
    else if (state === 'failed') stopFeedback?.failure('Playback progress could not be saved. Retry before starting another item.', () => stopSave.retry(), stopNotice);
    else {
      stopFeedback?.clear(stopNotice);
      stopFeedback = undefined;
    }
  });
  const stopOwner = $derived(page.data.user?.id);
  $effect(() => { const viewer = stopOwner; return () => { void viewer; stopSave.clear(); }; });
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let startupAttempt=$state(0),retryStartup:(()=>void)|undefined,startupImportError=$state('');
  let switchingVideo = $state<{ from?: string }>();
  let captionTrack: TextTrack | undefined;
  let captions = $state.raw<VTTCue[]>([]);
  let keyboardInteraction = false;
  let scrubbing = $state(false);
  const partyRoom=$derived(preview?null:syncedPlayer.room);
  const partyHost=$derived(!preview&&isSyncHost());
  const followingHost=$derived(preview && menuFixture ? !menuCondition('controlPlayback',true,preview,menuFixture) : !!partyRoom&&!canControlPlayback());
  const savedQueueRestriction=$derived(followingHost?'Playback is controlled by the host'
    :partyRoom&&!canEditPartyQueue()?'The host controls the party queue':undefined);
  const audioMode = $derived(player.session?.mediaType === 'audio');
  const sharedMode = $derived(!!player.session?.shareId);
  const media = $derived<HTMLMediaElement>(audioMode ? audio : video);
  let playedSeconds = 0, playedBeforeRefresh = 0, playedPosition = 0, playedAt = 0, wasPlaying = false, seeking = false;
  function coveredPlayback() {
    const ranges = media?.played;
    let covered = 0;
    if (ranges) for (let index = 0; index < ranges.length; index++)
      covered += ranges.end(index) - ranges.start(index);
    return covered;
  }
  function accountPlayed() {
    if (!audioMode || !media) return;
    const now = performance.now();
    if (playedAt) playedSeconds += actualPlayedDelta(playedPosition, media.currentTime, (now - playedAt) / 1000, wasPlaying, seeking);
    // Native played ranges exclude seek gaps, pauses and buffering, and retain the
    // endpoints that coarse timeupdate events can miss on a complete traversal.
    playedSeconds = Math.max(playedSeconds, playedBeforeRefresh + coveredPlayback());
    playedAt = now;
    playedPosition = media.currentTime;
    current = media.currentTime;
    wasPlaying = !media.paused && media.readyState >= 3;
  }
  function pause(remote=false) { if(preview){player.paused=true;return;} if(partyRoom&&!remote&&!syncedPlayer.changing){void syncedCommand('pause');return;} accountPlayed(); media?.pause(); }
  function waiting() { accountPlayed(); wasPlaying = false; tracePlayback('playback.waiting'); if (!streamFailure) streamInterrupted({ code: 2 }); else checkStreamFailure(); }
  function seekingStarted() { seeking = true; accountPlayed(); tracePlayback('playback.seek'); }
  function seekingEnded() { seeking = false; playedPosition = media.currentTime; playedAt = performance.now(); wasPlaying = !media.paused && media.readyState >= 3; }
  function paused() {
    if (switchingVideo) return;
    accountPlayed();
    player.paused = true;
    tracePlayback('playback.pause');
    if (active && !closed && player.role !== 'postplay') void report('pause');
  }
  const active = $derived(player.role === 'playback' || player.role === 'postplay');
  const src = $derived(player.subtitlePrompt ? undefined : player.session?.url);
  const bars = $derived(resolveFrameCrop(player.session?.initialCrop, frame.width, frame.height) ?? noCrop);
  const canCrop = $derived(Object.values(bars).some(edge => edge > 0));
  const videoStyle = $derived(
    videoFitStyle(frame.width, frame.height, bounds.width, bounds.height, bars, canCrop && crop)
  );
  const tracks = $derived((player.session?.subtitles ?? []).filter((track) => track.url));
  const subtitleSearch = $derived(!!player.session && !audioMode && !sharedMode &&
    (preview || !!page.data.user && !page.data.user.access?.libraryOnly));
  const qualityDisabled = $derived(!!switchingVideo || player.loading || !!partyRoom || player.role !== 'playback');
  const videoQuality = $derived(audioMode || sharedMode ? undefined : player.session?.quality);
  function mutePlayback(muted: boolean) {
    if (preview) player.muted = muted;
    else setPlaybackMuted(muted);
  }
  const subtitles = createSubtitleControls({
    endpoint: () => `playback/${player.session?.id}/subtitles`,
    owner: () => page.data.user?.id ?? '',
    added: async ({ tracks, index }) => {
      const session = player.session;
      if (!session) return;
      session.subtitles = tracks;
      subtitle = index;
      await tick();
      if (player.session?.id === session.id) applySubtitles();
    },
  });
  const editions = $derived(menuCondition('versions', true, preview, menuFixture) ? [
    ...new Set(player.session?.sources.map((source) => source.edition ?? '') ?? []),
  ] : []);
  const showQuality = $derived(!audioMode && (!!videoQuality || editions.length > 1));
  function seek(seconds: number,remote=false) {
    if (switchingVideo) return;
    if(partyRoom&&!remote){void syncedCommand('seek',{positionSeconds:seconds});return;}
    if (!media || !Number.isFinite(duration) || duration <= 0) return;
    accountPlayed();
    current = Math.max(0, Math.min(duration, seconds));
    if (audioMode) seeking = true;
    media.currentTime = current;
    revealControls();
    void report();
  }
  function toggleUi(){player.browsing=!player.browsing;revealControls();}
  function fullscreen() {
    if(preview)return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }
  function armIdle() {
    clearTimeout(idleTimer);
    if (preview || !active || audioMode || player.browsing || player.paused || player.role === 'postplay' || error || switchingVideo) return;
    idleTimer = setTimeout(() => {
      const focused =
        keyboardInteraction && document.activeElement?.closest('.playback-chrome, header');
      if (scrubbing || focused || document.querySelector('[popover]:popover-open, dialog[open]'))
        armIdle();
      else player.controlsVisible = false;
    }, 5000);
  }
  function revealControls(event?: Event) {
    if (event) keyboardInteraction = event.type === 'keydown';
    player.controlsVisible = true;
    armIdle();
  }
  $effect(() => {
    if (preview) return;
    active;
    player.paused;
    player.browsing;
    player.role;
    error;
    untrack(() => revealControls());
    return () => clearTimeout(idleTimer);
  });
  async function report(event = 'progress') {
    const send = captureReport(event);
    return send ? (await send()).saved : false;
  }
  function captureReport(event: string): (() => Promise<PlaybackSave>) | undefined {
    if (preview) return;
    const session = player.session;
    if (!session || !active) return;
    const started = startedSessionId === session.id;
    if (event !== 'stop' && (player.subtitlePrompt || !started)) return;
    accountPlayed();
    const payload = {
      positionSeconds: started ? current : session.startSeconds,
      durationSeconds: started && Number.isFinite(duration) ? duration : session.durationSeconds,
      event,
      paused: event === 'pause' || event === 'stop' || !!media?.paused,
      ...(session.measureSharePlayback ? { playedSeconds: coveredPlayback() } : audioMode ? { playedSeconds } : {}),
    };
    const request = capturePlaybackApi();
    // Coalesce queued positions without crossing lifecycle or session boundaries.
    let disabled = false;
    return async () => {
      const saved = await reports(session.id, event, async () => {
        try {
          if (started && event !== 'start' && acknowledgedSessionId !== session.id) {
            const acknowledgement=await request<{disabled?:boolean}>(`playback/${session.id}/progress`, {
              ...payload,
              event: 'start',
              paused: false,
            });
            if(acknowledgement?.disabled){disabled=true;if(player.session?.id===session.id){pause(true);void close(true,true);}return false;}
            acknowledgedSessionId = session.id;
          }
          const result=await request<{disabled?:boolean}>(`playback/${session.id}/progress`, payload);
          if(result?.disabled){disabled=true;if(player.session?.id===session.id){pause(true);void close(true,true);}return false;}
          if (player.session?.id === session.id) trackingNotice = '';
          if (event === 'start') acknowledgedSessionId = session.id;
          return true;
        } catch (e) {
          if (player.session?.id === session.id) trackingNotice = 'Tracking could not be saved yet. Playback can continue; Coast will retry the next report.';
          return false;
        }
      });
      return { saved, disabled };
    };
  }
  function playing() {
    lastMovement = performance.now();
    player.paused = false;
    if (!active || player.subtitlePrompt || !player.session || closed) return;
    // Ignore events from a source being replaced.
    if (media.getAttribute('src') !== player.session.url && !hls) return;
    startedSessionId = player.session.id;
    if (media.currentTime !== current) lastMovement = performance.now();
    current = media.currentTime;
    checkStreamFailure();
    duration = Number.isFinite(media.duration) ? media.duration : player.session?.durationSeconds ?? 0;
    if (audioMode) { playedPosition = media.currentTime; playedAt = performance.now(); wasPlaying = true; }
    lastReport = Date.now();
    void report('start');
    tracePlayback('playback.playing');
  }
  let lastTouchTap:{at:number;x:number;y:number}|null=null;
  let lastTouchAt=-Infinity;
  function toggleCrop(){
    if (player.role !== 'playback' || player.browsing || player.subtitlePrompt || switchingVideo || !canCrop) return;
    crop = !crop;
    revealControls();
  }
  function playerDoubleClick(){if(performance.now()-lastTouchAt>500)toggleCrop();}
  function cancelPlayerTap(){lastTouchTap=null;}
  function playerTap(event:PointerEvent){
    if(event.pointerType!=='touch'||!event.isPrimary||!active||audioMode)return;
    const now=performance.now();lastTouchAt=now;
    if(lastTouchTap&&now-lastTouchTap.at<=350&&Math.hypot(event.clientX-lastTouchTap.x,event.clientY-lastTouchTap.y)<=24){lastTouchTap=null;toggleCrop();}
    else lastTouchTap={at:now,x:event.clientX,y:event.clientY};
  }
  async function close(cancelPreparing: unknown = true, withdrawn=false) {
    if(preview){player.session=null;player.role='idle';player.paused=true;player.subtitlePrompt=false;return;}
    if(cancelPreparing!==false)cancelPlaybackPreparation();
    if (closed || !player.session) return;
    closed = true;
    switchingVideo = undefined;
    savePlaybackSnapshot();
    const shared=sharedMode,room=partyRoom,host=partyHost,changing=syncedPlayer.changing;
    pause(true);
    // Freeze the final payload and API authority before detaching the media.
    const send = withdrawn ? undefined : captureReport('stop');
    player.role = 'idle';
    player.paused = true;
    player.session = null;
    player.browsing = false;
    player.subtitlePrompt = false;
    error = '';
    trackingNotice = '';
    closed = false;
    const cleanup = room&&!changing&&syncedPlayer.room?.id===room.id
      ? host&&!withdrawn ? syncedCommand('stop') : leaveSynced(true)
      : Promise.resolve();
    if (send) {
      stopFeedback = feedbackForViewer();
      stopSave.start(async () => {
        await cleanup;
        const result = await send();
        if(result.saved&&!shared)void refreshAfterChange('tracking');
        return result;
      });
    } else {
      stopSave.clear();
      void cleanup;
    }
  }
  async function toggle() {
    if(preview){player.paused=!player.paused;return;}
    if (!media || switchingVideo) return;
    if(sharedMode&&media.ended&&player.session){await playMedia(player.session.mediaId,{fromStart:true});return;}
    if(partyRoom){if(!canControlPlayback()&&media.paused){try{await media.play();}catch(cause){syncedPlayer.notice=message(cause);}return;}await syncedCommand(player.paused?'play':'pause');return;}
    if (media.paused) {
      try {
        await media.play();
      } catch (e) {
        error = message(e);
      }
    } else pause();
  }
  let streamFailure: { status?: number; code?: number } | null = null;
  let failedSessionId = '';
  let lastMovement = 0;
  let failureTimer: ReturnType<typeof setInterval> | undefined;
  function clearStreamFailure() { streamFailure = null; clearInterval(failureTimer); failureTimer = undefined; }
  function checkStreamFailure() {
    if (!streamFailure || !media || media.ended || error) return;
    if (streamHasStopped({ buffered: bufferedAhead(media.buffered, media.currentTime), readyState: media.readyState, paused: media.paused, started: startedSessionId === player.session?.id, broken: !!media.error, stalledFor: performance.now() - lastMovement })) {
      const reason = streamFailure; clearStreamFailure(); void failure(reason);
    }
  }
  function streamInterrupted(reason: { status?: number; code?: number } = {}) {
    if (!streamFailure) lastMovement = performance.now();
    streamFailure = reason;
    if (!failureTimer) failureTimer = setInterval(checkStreamFailure, 1000);
  }
  function nativeFailure() {
    if (media?.error && [3,4].includes(media.error.code)) void failure({ code: media.error.code });
    else streamInterrupted({ code: media?.error?.code });
  }
  async function failure(reason: { status?: number; code?: number } = {}) {
    const session = player.session;
    if (preview || !src || !session || session.id === failedSessionId || player.role !== 'playback') return;
    if (switchingVideo?.from === session.id) return;
    switchingVideo = undefined;
    failedSessionId = session.id;
    clearStreamFailure();
    const code = reason.code ?? media?.error?.code;
    tracePlayback('playback.failed', { status: reason.status, code, failure: 'media', stage: 'player' });
    void change(`playback/${session.id}/error`, { code: code ?? 0 }).catch(() => {});
    if (session.canFallback && !player.loading && !audioMode && !partyRoom && !sharedMode) {
      const feedback = feedbackForViewer();
      try {
        await playMedia(session.mediaId, {
          fallbackSessionId: session.id,
          continuationId: player.continuationId,
          sequence: session.sequence,
        });
      } catch (cause) {
        if (!(cause instanceof PlaybackSavePending)) feedback.failure(message(cause));
      }
      return;
    }
    error = playbackFailureMessage(reason.status, code);
  }
  function update() {
    if (switchingVideo) return;
    if (media.currentTime !== current) lastMovement = performance.now();
    accountPlayed();
    checkStreamFailure();
    current = media.currentTime;
    duration = Number.isFinite(media.duration) ? media.duration : player.session?.durationSeconds ?? 0;
    if (active && Date.now() - lastReport > 10000) {
      lastReport = Date.now();
      void report();
    }
  }
  function applySubtitles() {
    if (!video) return;
    const element=video.querySelector<HTMLTrackElement>(`track[data-subtitle-index="${subtitle}"]`);
    captionTrack = element?.track;
    for (const track of Array.from(video.textTracks)) {
      const mode = track === captionTrack ? 'hidden' : 'disabled';
      if (track.mode !== mode) track.mode = mode;
    }
    updateCaptions();
    if(element?.readyState===2)subtitleOutcome(subtitle,'loaded');
  }
  let lastSubtitleOutcome='';
  function subtitleOutcome(index:number,outcome:'loaded'|'failed'){
    const session=player.session;
    const fingerprint=tracks.find(track=>track.index===index)?.fingerprint;
    if(!subtitleSearch||preview||!session||index!==subtitle||!fingerprint)return;
    const key=`${session.id}:${fingerprint}:${outcome}`;
    if(lastSubtitleOutcome===key)return;
    lastSubtitleOutcome=key;
    void api(`playback/${session.id}/subtitles`,{index,outcome,fingerprint},'POST').catch(()=>{
      if(lastSubtitleOutcome===key)lastSubtitleOutcome='';
    });
  }
  function updateCaptions() {
    captions = Array.from(captionTrack?.activeCues ?? []).filter((cue): cue is VTTCue => 'getCueAsHTML' in cue);
  }
  function renderCaption(node: HTMLElement, cue: VTTCue) {
    const update = (value: VTTCue) => node.replaceChildren(value.getCueAsHTML());
    update(cue);
    return { update };
  }
  function metadata() {
    if (!audioMode) {
      frame = { width: video.videoWidth, height: video.videoHeight };
      const session = player.session;
      if (session?.initialCrop && 'Width' in session.initialCrop)
        session.initialCrop = resolveFrameCrop(session.initialCrop, frame.width, frame.height);
    }
    duration = Number.isFinite(media.duration) ? media.duration : player.session?.durationSeconds ?? 0;
    if (active && player.session?.startSeconds && media.currentTime < 1)
      media.currentTime = player.session.startSeconds;
    if (!audioMode) applySubtitles();
  }
  function videoReady() {
    if (switchingVideo && player.session?.handoff && player.session.id !== switchingVideo.from &&
        video.readyState >= 2 && !video.seeking) {
      switchingVideo = undefined;
      armIdle();
    }
  }
  async function ended() {
    if(preview)return;
    const sessionId = player.session?.id;
    if (audioMode) {
      accountPlayed();
      const delivered = await report('ended');
      if(player.session?.id!==sessionId)return;
      if (!sharedMode && delivered && (!partyRoom||partyHost)) await advanceMusic();
      else player.paused = true;
      return;
    }
    saving = true;
    const delivered = await report('ended');
    if(player.session?.id!==sessionId)return;
    saved = delivered;
    saving = false;
    player.role = 'postplay';
    player.paused = true;
    if(sharedMode)return;
    void refreshAfterChange('tracking');
    if (!saved || !player.session) return;
    try {
      if (player.session.sequence) {
        await loadSequenceNext(player.session.sequence.entryId);
        return;
      }
      const details = await api<{ item: MediaView; next: MediaView | null }>(
        `media/${player.continuationId || player.session.mediaId}`,
        undefined,
        'GET'
      );
      if(player.session?.id!==sessionId)return;
      const continuation =
        details.item.kind === 'episode' && details.item.showId
          ? await api<{ next: MediaView | null }>(`media/${details.item.showId}`, undefined, 'GET')
          : details;
      if(player.session?.id!==sessionId)return;
      next =
        continuation.next?.available &&
        !continuation.next.watched &&
        continuation.next.id !== player.session.mediaId
          ? continuation.next
          : null;
    } catch {
      /* Keep the completed title visible if the next episode cannot be loaded. */
    }
  }
  async function loadSequenceNext(after: string) {
    const sessionId = player.session?.id;
    const source = player.session?.sequence;
    if (!source) return;
    const result = await api<{ next: MediaView | null }>(
      sequencePath(source, { after }),
      undefined,
      'GET'
    );
    if(player.session?.id===sessionId)next = result.next;
  }
  async function switchEdition(edition?: string) {
    const session = player.session;
    if (!session) return;
    if (preview) { if (edition !== undefined) session.edition = edition; return; }
    if (edition !== undefined && !sharedMode && !partyRoom && !audioMode && player.role === 'playback') {
      if (edition !== (session.edition ?? '')) await changeVideo({ edition });
      return;
    }
    try {
      if(partyRoom&&edition===undefined){await joinSynced(partyRoom);return;}
      if (audioMode) {
        await playMedia(session.mediaId, { mediaType: 'audio', fromStart: false, retry: true });
        return;
      }
      await playMedia(session.mediaId, {
        edition,
        subtitleIndex: subtitle,
        continuationId: player.continuationId,
        sequence: session.sequence,
      });
    } catch (e) {
      error = message(e);
    }
  }
  async function changeVideo(options: { quality?: PlaybackQuality; edition?: string }) {
    const session = player.session;
    if (!session || sharedMode || partyRoom || audioMode || switchingVideo || player.loading || player.role !== 'playback') return;
    if (preview) { if (session.quality && options.quality) session.quality.selection = options.quality; return; }
    const feedback = feedbackForViewer();
    const resume = !player.paused;
    switchingVideo = { from: session.id };
    revealControls();
    video.pause();
    try {
      await playMedia(session.mediaId, {
        ...options, reconfigureSessionId: session.id,
        subtitleIndex: options.edition === undefined || subtitle === -1 ? subtitle : undefined,
        sequence: session.sequence,
      });
    } catch (cause) {
      if (player.session?.id === session.id) feedback.failure(message(cause));
    } finally {
      if (switchingVideo?.from === session.id && player.session?.id === session.id) {
        switchingVideo = undefined;
        if (resume) void video.play().catch(() => { player.paused = true; });
        armIdle();
      }
    }
  }
  $effect(() => {
    if (preview) return;
    const session = player.session;
    if (session) {
      playedBeforeRefresh = session.playedBeforeRefresh ?? 0;
      playedSeconds = playedBeforeRefresh;
      playedPosition = session.startSeconds; playedAt = 0; wasPlaying = false; seeking = false;
      if (!session.handoff) crop = false;
      subtitle = session.defaultSubtitleIndex ?? -1;
      captions = [];
      current = session.startSeconds;
      duration = session.durationSeconds;
      next = null;
      saved = false;
      player.controlsVisible = true;
      error = '';
      trackingNotice = '';
    }
  });
  $effect(() => {
    if (preview) return;
    const url = src,
      sessionId=player.session?.id,
      kind = player.session?.kind,
      startPaused = player.session?.startPaused,
      element = media,
      attempt=startupAttempt;
    if (!element || !url) return;
    let cancelled = false,released=false,importFailed=false;
    const ownsStartup=()=>!cancelled&&attempt===startupAttempt&&player.session?.id===sessionId&&src===url&&media===element;
    function releaseStartup(){
      if(released)return;released=true;
      clearStreamFailure();hls?.destroy();hls=null;
      element.pause();element.removeAttribute('src');element.load();
    }
    retryStartup=undefined;
    startupImportError='';
    error = '';
    clearStreamFailure();
    let recoveredMedia = false, restartedNetwork = false;
    hls?.destroy();
    hls = null;
    const start = async () => {
      if (kind === 'hls' && !element.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js').catch(cause=>{importFailed=true;throw cause;});
        if (!ownsStartup()) return;
        if (!Hls.isSupported()) {
          await failure({code: 4});
          return;
        }
        const engine = new Hls();
        hls = engine;
        engine.loadSource(url);
        engine.attachMedia(element);
        engine.on(Hls.Events.ERROR, (_event, data) => {
          if (!ownsStartup() || !data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) { recoveredMedia = true; engine.recoverMediaError(); streamInterrupted({ code: 3 }); }
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) void failure({ code: 3 });
          else { streamInterrupted({ status: data.response?.code, code: 2 }); if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !restartedNetwork) { restartedNetwork = true; engine.startLoad(); } }
        });
        engine.on(Hls.Events.FRAG_LOADED, () => { restartedNetwork = false; clearStreamFailure(); });
        engine.on(Hls.Events.MANIFEST_PARSED, () => {
          void (partyRoom || startPaused ? Promise.resolve() : element.play()).catch(() => {
            player.paused = true;
          });
        });
      } else {
        if (element.getAttribute('src') !== url) element.src = url;
        await (partyRoom || startPaused ? Promise.resolve() : element.play()).catch(() => {
          player.paused = true;
        });
      }
    };
    untrack(() => void start().catch(cause=>{
      if(!ownsStartup())return;
      switchingVideo = undefined;
      releaseStartup();
      if(importFailed){
        startupImportError='Playback could not load. Reload the page to try again.';
        error=startupImportError;
      }else{
        retryStartup=()=>{if(ownsStartup())startupAttempt++;};
        error=message(cause);
      }
    }));
    return () => {
      cancelled = true;
      retryStartup=undefined;
      if(importFailed){startupImportError='';error='';}
      releaseStartup();
    };
  });
  $effect(() => {
    if (preview) return;
    if (media) { media.muted = player.muted; media.volume = volume; }
  });
  function rememberPlayback() {
    const viewer = stopOwner;
    const session = player.session;
    if (!viewer || !session || sharedMode || partyRoom || player.role !== 'playback') {
      savePlaybackSnapshot();
      return;
    }
    accountPlayed();
    savePlaybackSnapshot({
      viewer, session, position: switchingVideo ? current : media?.readyState >= 1 ? media.currentTime : session.startSeconds,
      playedSeconds: audioMode ? playedSeconds : 0,
      subtitle, volume, crop, paused: player.paused, muted: player.muted, browsing: player.browsing,
      continuationId: player.continuationId, queue: player.audioQueue, queueIndex: player.audioIndex,
    });
  }
  async function restorePlayback(signal: AbortSignal) {
    const viewer = stopOwner;
    if (!viewer || page.url.pathname === '/share' || player.session || player.loading) return;
    const saved = takePlaybackSnapshot(viewer);
    if (!saved) return;
    try {
      await api(`playback/${saved.session.id}`, undefined, 'GET', { signal });
    } catch {
      return;
    }
    if (signal.aborted || viewer !== stopOwner || partyRoom || player.session || player.loading) return;
    volume = Math.max(0, Math.min(1, saved.volume));
    crop = saved.crop;
    if (saved.session.mediaType !== 'audio') switchingVideo = {};
    player.session = {
      ...saved.session, handoff: true, startSeconds: saved.position, startPaused: saved.paused,
      playedBeforeRefresh: saved.playedSeconds,
      defaultSubtitleIndex: saved.subtitle, subtitlePrompt: false,
    };
    player.audioQueue = saved.queue;
    player.audioIndex = saved.queueIndex;
    player.browsing = saved.browsing;
    player.continuationId = saved.continuationId;
    player.muted = saved.muted;
    player.paused = saved.paused;
    player.role = 'playback';
    player.controlsVisible = true;
    player.subtitlePrompt = false;
  }
  onMount(() => {
    if (preview) return;
    const restoring = new AbortController();
    void restorePlayback(restoring.signal);
    window.addEventListener('pagehide', rememberPlayback);
    const unregister = registerPlaybackController({
      beginPlaybackGesture: type => {
        const element=type==='audio'?audio:video;
        if(element?.currentSrc)void element.play().catch(()=>{/* Preparation may replace the current stream. */});
      },
      stop: close,
      waitForStop: () => stopSave.wait(),
      pause,
      resume: () => partyRoom ? syncedCommand('play') : media.play(),
      snapshot: () => ({
        positionSeconds: media && media.readyState >= 1 ? media.currentTime : player.session?.startSeconds ?? 0,
        subtitleIndex: subtitle, buffering: !media || media.readyState < 3 || !!media.error, unavailable: !!error,
      }),
      align: state => {
        if(!media||media.readyState<1)return;
        if(state.force||Math.abs(media.currentTime-state.positionSeconds)>1.5)seek(state.positionSeconds,true);
        if(state.paused){media.playbackRate=1;pause(true);}
        else {
          const drift=state.positionSeconds-media.currentTime;
          media.playbackRate=Math.abs(drift)>0.25?(drift>0?1.03:0.97):1;
          if(media.paused)void media.play().catch(cause=>{
            if(cause instanceof DOMException&&cause.name==='NotAllowedError'&&!media.muted){
              // Muted playback is permitted when async source preparation outlasts the Join gesture.
              player.muted=true;media.muted=true;
              void media.play().catch(()=>{player.paused=true;});
            }
          });
        }
      },
    });
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      bounds = { width: rect.width, height: rect.height };
    });
    observer.observe(host);
    host.addEventListener('dblclick', playerDoubleClick);
    host.addEventListener('pointerup', playerTap);
    host.addEventListener('pointercancel', cancelPlayerTap);
    const key = (e: KeyboardEvent) => {
      if (
        !active ||
        e.defaultPrevented ||
        ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes((e.target as HTMLElement)?.tagName)
      )
        return;
      if (e.key === ' ') {
        e.preventDefault();
        void toggle();
      }
      if (e.key === 'Escape' && !audioMode && !document.querySelector('dialog[open]')) {
        toggleUi();
      }
      if (e.key.toLowerCase() === 'c' && !audioMode && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey &&
          !document.querySelector('[popover]:popover-open, dialog[open]')) toggleCrop();
    };
    document.addEventListener('keydown', key);
    for (const event of ['pointermove', 'pointerdown', 'touchstart', 'keydown'])
      document.addEventListener(event, revealControls, { passive: true });
    return () => {
      restoring.abort();
      window.removeEventListener('pagehide', rememberPlayback);
      clearTimeout(idleTimer);
      for (const event of ['pointermove', 'pointerdown', 'touchstart', 'keydown'])
        document.removeEventListener(event, revealControls);
      observer.disconnect();
      host.removeEventListener('dblclick', playerDoubleClick);
      host.removeEventListener('pointerup', playerTap);
      host.removeEventListener('pointercancel', cancelPlayerTap);
      document.removeEventListener('keydown', key);
      unregister();
      stopSave.clear();
      hls?.destroy();
    };
  });
  let lastTiming = 0;
  function tracePlayback(event: import('#lib/diagnostics.js').DiagnosticEvent, details?: Record<string, unknown>) {
    if(preview)return;
    browserDiagnostic(event, {
      sessionId: player.session?.id, mediaType: player.session?.mediaType, delivery: player.session?.kind,
      durationMs: player.preparationStartedAt ? performance.now() - player.preparationStartedAt : 0,
      bufferedSeconds: media?.buffered.length ? Math.max(0, media.buffered.end(media.buffered.length - 1) - media.currentTime) : 0,
      positionSeconds: media?.currentTime, readyState: media?.readyState, networkState: media?.networkState,
      code: media?.error?.code, ...details,
    });
  }
  reportFailure(()=>startupImportError?'':error, ()=>{if(retryStartup)retryStartup();else return switchEdition();}, 'current-viewer');
  reportImportFailure(()=>startupImportError, 'current-viewer');
  reportFailure(()=>trackingNotice, undefined, 'current-viewer');
</script>

<audio
  bind:this={audio}
  aria-label={audioMode ? player.session?.title : 'Music playback'}
  preload="metadata"
  ontimeupdate={() => { if (audioMode) update(); }}
  onloadedmetadata={() => { if (audioMode) { metadata(); tracePlayback('playback.ready'); } }}
  onplaying={() => { if (audioMode) playing(); }}
  onpause={() => { if (audioMode) paused(); }}
  onwaiting={() => { if (audioMode) waiting(); }}
  onseeking={() => { if (audioMode) seekingStarted(); }}
  onseeked={() => { if (audioMode) seekingEnded(); }}
  onended={() => { if (audioMode) void ended(); }}
  onerror={() => { if (audioMode) nativeFailure(); }}
><track kind="captions" /></audio>
<div bind:this={host} class="player" class:active={active && !audioMode} class:switching={!!switchingVideo}
  class:caption-clearance={player.controlsVisible || player.paused}
  aria-hidden={!active || audioMode} aria-busy={!!switchingVideo}>
  <video
    bind:this={video}
    data-player="playback"
    aria-label={player.session?.title ?? 'Title playback'}
    class:positioned={!!videoStyle}
    style={videoStyle}
    playsinline
    preload={switchingVideo ? 'auto' : 'metadata'}
    ontimeupdate={() => { if (audioMode) return; update(); if (video && performance.now() - lastTiming > 10_000) { lastTiming = performance.now(); tracePlayback('playback.timing'); } }}
    onwaiting={() => { if (!audioMode) waiting(); }}
    onseeking={() => { if (!audioMode) tracePlayback('playback.seek'); }}
    onseeked={videoReady}
    oncanplay={videoReady}
    onloadedmetadata={() => { if (audioMode) return; metadata(); tracePlayback('playback.ready'); }}
    onplay={() => {
      if (!audioMode) player.paused = false;
    }}
  onplaying={() => { if (!audioMode) playing(); }}
    onpause={() => { if (!audioMode) paused(); }}
    onended={() => { if (!audioMode) void ended(); }}
    onerror={() => { if (!audioMode) nativeFailure(); }}
  >
    {#each tracks as track (track.url)}<track
        kind="subtitles"
        src={track.url}
        data-subtitle-index={track.index}
        srclang={track.language ?? 'en'}
        label={track.label}
        onload={()=>subtitleOutcome(track.index,'loaded')}
        onerror={()=>subtitleOutcome(track.index,'failed')}
        oncuechange={updateCaptions}
      />{/each}
  </video>
  {#if captions.length && !switchingVideo}
    <div class="video-captions">
      {#each captions as cue (cue)}<span use:renderCaption={cue}></span>{/each}
    </div>
  {/if}
</div>
{#if active}
  <div
    class="playback-chrome"
    class:chrome-hidden={!player.controlsVisible && !player.paused}
    class:browsing={player.browsing}
    inert={!player.controlsVisible && !player.paused}
  >
    {#if player.role === 'postplay' && !error}<div class="postplay solid-surface">
        <Icon name="check" size={30} />
        <h2>{sharedMode?'Playback finished':'One more story, remembered.'}</h2>
        <p>
          {sharedMode?'This shared item has finished.':saving
            ? 'Saving your progress…'
            : saved
              ? 'Your watch history is up to date.'
              : 'Your progress could not be saved.'}
        </p>
        {#if next && !next.available}<p>{next.title} is next, but unavailable.</p>
          <Button

            onclick={() =>
              next?.sequence &&
              loadSequenceNext(next.sequence.entryId).catch((e) => (error = message(e)))}
            >Skip this item</Button
          >{:else if next}<Button
            icon="play"
            onclick={() =>
              !preview && next &&
              playMedia(next.id, {
                continuationId: player.continuationId || next.showId,
                sequence: next.sequence,
              }).catch((e) => (error = message(e)))}
            >{next.kind === 'episode'
              ? `Play S${String(next.seasonNumber ?? 0).padStart(2, '0')}E${String(next.episodeNumber ?? 0).padStart(2, '0')}`
              : `Play ${next.title}`}</Button
          >{/if}<Button  onclick={close}
          >{sharedMode?'Close':'Back to Coast'}</Button
        >
      </div>{/if}
    <section
      use:liquidGlass={{ variant: 'clear' }}
      class="controls glass"
      class:audio={audioMode}
      class:has-quality={showQuality}
      aria-label={`Playback controls: ${player.session?.title}`}
    >
      <div class="transport">
        <Button size="icon"
          class={`icon-button ${!audioMode ? 'skip-back' : ''}`}
          disabled={followingHost || audioMode&&sharedMode}
          label={audioMode ? 'Previous track' : 'Back 10 seconds'}
          title={audioMode ? 'Previous track' : 'Back 10 seconds'}
          onclick={() => {if(!preview)audioMode ? advanceMusic(-1) : seek(current - 10);}} icon={audioMode ? 'left' : 'rewind'} iconSize={20} />
        <Button size="icon" class="transport-primary"
          disabled={!!switchingVideo || followingHost&&(!player.paused||partyRoom?.paused||partyRoom?.bufferingPaused)}
          title={followingHost?'Playback is controlled by the host':undefined}
          label={player.paused ? 'Play' : 'Pause'}
          onclick={toggle} icon={player.paused ? 'play' : 'pause'} iconSize={28} />
        <Button size="icon" class="transport-primary" label="Stop playback" title="Stop playback"
          onclick={close} icon="stop" iconSize={28} />
        <Button size="icon"
          class={`icon-button ${!audioMode ? 'skip-forward' : ''}`}
          disabled={followingHost || audioMode&&sharedMode}
          label={audioMode ? 'Next track' : 'Forward 30 seconds'}
          title={audioMode ? 'Next track' : 'Forward 30 seconds'}
          onclick={() => {if(!preview)audioMode ? advanceMusic() : seek(current + 30);}} icon={audioMode ? 'right' : 'forward'} iconSize={20} />
      </div>
      <PlaybackTimeline
        mediaId={sharedMode?undefined:player.session!.mediaId}
        href={audioMode ? `/music/work/${player.session!.mediaId}` : undefined}
        audio={audioMode}
        title={player.session?.title ?? 'Now playing'}
        detail={`${player.session?.detail ?? ''}${partyRoom ? partyHost?' · Synced host':' · Synced member':''}`}
        disabled={followingHost}
        artwork={player.session?.artwork}
        {current}
        {duration}
        onseek={seek}
        bind:scrubbing
      />
      <Button menu label="Volume" title={player.muted ? 'Unmute' : 'Mute'} pressed={player.muted}
        upward openOnHover primaryAction={() => mutePlayback(!player.muted)}>
        {#snippet trigger()}<Icon
            name={player.muted || volume === 0 ? 'muted' : 'volume'}
            size={21}
          />{/snippet}
        {#snippet children()}
          <div class="volume" data-menu-interactive>
            <input
              type="range"
              data-menu-focus
              class:muted={player.muted}
              min="0"
              max="1"
              step="0.05"
              aria-label="Volume"
              aria-valuetext={`${Math.round(volume * 100)} percent${player.muted ? ', muted' : ''}`}
              value={volume}
              oninput={(event) => {
                volume = event.currentTarget.valueAsNumber;
                if (player.muted) mutePlayback(false);
              }}
            />
          </div>
          {#if audioMode && !sharedMode}
            <div class="menu-divider" role="separator"></div>
            <Button menu label="Advanced options" icon="settings" panel>
              <Button menu label="Current queue" icon="list" upward panel>
                {#each player.audioQueue as entry, index}
                  <Button item selection="radio" checked={index === player.audioIndex} disabled={followingHost||entry.availability !== 'available'} disabledReason={followingHost?'Playback is controlled by the host':entry.availability === 'unknown' ? 'Availability unresolved' : entry.availability !== 'available' ? 'Unavailable' : undefined}
                    onclick={() => { if(preview)return;player.audioIndex = index - 1; void advanceMusic().catch(cause=>error=message(cause)); }}>{entry.title}</Button>
                {:else}
                  <Button item disabled>Queue empty</Button>
                {/each}
              </Button>
              <Button item icon="play" disabled={!!savedQueueRestriction} disabledReason={savedQueueRestriction} onclick={()=>{if(!preview)void playSavedMusicQueue().catch(cause=>error=message(cause));}}>Play saved queue</Button>
            </Button>
          {/if}
        {/snippet}
      </Button>
      {#if !audioMode}
        {#if showQuality}
          <Button menu label="Quality" icon="settings05" panel upward>
            {#if videoQuality}
              <PlaybackQualityMenu section="resolution" info={videoQuality} disabled={qualityDisabled} onchange={quality => changeVideo({ quality })} />
              <PlaybackQualityMenu section="audio-track" info={videoQuality} disabled={qualityDisabled} onchange={quality => changeVideo({ quality })} />
              <div class="menu-divider" role="separator"></div>
            {/if}
            <Button menu label="Advanced options" icon="settings" panel>
              {#if editions.length > 1}
                <Button menu label="Version" icon="film" panel>
                  {#each editions as edition (edition)}<Button item selection="radio"
                    checked={edition === (player.session?.edition ?? '')}
                    disabled={followingHost || !!switchingVideo} disabledReason={followingHost ? 'Playback is controlled by the host' : 'Switching video.'}
                    onclick={() => switchEdition(edition)}>{edition || 'Original'}</Button>{/each}
                </Button>
                {#if videoQuality}<div class="menu-divider" role="separator"></div>{/if}
              {/if}
              {#if videoQuality}
                <PlaybackQualityMenu section="video-advanced" info={videoQuality} disabled={qualityDisabled} onchange={quality => changeVideo({ quality })} />
                <div class="menu-divider" role="separator"></div>
                <PlaybackQualityMenu section="audio-advanced" info={videoQuality} disabled={qualityDisabled} onchange={quality => changeVideo({ quality })} />
              {/if}
            </Button>
          </Button>
        {/if}
        <SubtitleMenu controls={subtitles} {tracks} selected={subtitle} search={subtitleSearch}
          disabled={!tracks.length && !subtitleSearch} onselect={index => { subtitle = index; applySubtitles(); }} />
        <Button size="icon" icon="fullscreen" iconSize={20}
          label="Toggle fullscreen" title="Toggle fullscreen" onclick={fullscreen} />
      {/if}
    </section>
  </div>
{/if}
{#if subtitles.advanced && subtitleSearch}
  <SubtitleSearchDialog controls={subtitles} title={player.session?.title ?? 'Video'} selected={subtitle} />
{/if}
<Dialog
  open={player.subtitlePrompt}
  title="Subtitles"
  onclose={() => {
    if (player.subtitlePrompt) void close();
  }}
  ><div class="stack">
    <p>Choose subtitles for {player.session?.title}.</p>
    <label class="field"
      >Subtitle track<select bind:value={subtitle}
        ><option value={-1}>Off</option>{#each tracks as track}<option value={track.index}
            >{track.label}</option
          >{/each}</select
      ></label
    ><Button
      icon="play"
      onclick={async () => {
        player.subtitlePrompt = false;
        await tick();
        applySubtitles();
      }}>Start playback</Button
    >
  </div></Dialog
>

<style>
  .player {
    visibility: hidden;
    position: fixed;
    inset: 0;
    background: var(--canvas);
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .player.active {
    visibility: visible;
    pointer-events: auto;
    touch-action: manipulation;
  }
  .player.switching video { visibility: hidden; }
  .video-captions {
    position: absolute;
    inset-inline: 5%;
    bottom: max(5%, env(safe-area-inset-bottom));
    display: grid;
    justify-items: center;
    gap: 0.15em;
    color: var(--white);
    font-size: var(--text-2xl);
    line-height: var(--leading-normal);
    text-align: center;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .video-captions > span {
    padding-inline: 0.25em;
    background: color-mix(in srgb, var(--canvas) 78%, transparent);
    border-radius: 0.15em;
  }
  .player.caption-clearance .video-captions { bottom: calc(100px + env(safe-area-inset-bottom)); }
  @media (max-width: 639px) {
    .video-captions { font-size: var(--text-xl); }
    .player.caption-clearance .video-captions { bottom: calc(180px + env(safe-area-inset-bottom)); }
  }
  .playback-chrome {
    position: fixed;
    inset: 0;
    z-index: 90;
    pointer-events: none;
    transition:
      opacity var(--motion) var(--ease),
      visibility var(--motion);
  }
  .playback-chrome > * {
    pointer-events: auto;
  }
  .player video {
    transition:width var(--motion) var(--ease),height var(--motion) var(--ease),left var(--motion) var(--ease),top var(--motion) var(--ease);
    position: absolute;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  @media(prefers-reduced-motion:reduce){.player video{transition:none;}}
  .player video.positioned {
    /* Tailwind's video max-width:100% would clamp the oversized crop placement. */
    max-width: none;
    object-fit: fill;
  }
  .controls {
    position: absolute;
    bottom: max(16px, env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 999px;
    padding: 6px 12px;
    height: 56px;
    width: min(760px, calc(100% - 32px));
    color: var(--ink);
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }
  .controls :global(.icon-button) {
    width: 32px;
    height: 44px;
    border-radius: 10px;
    color: var(--ink);
    transition: transform var(--fast) var(--ease);
  }
  .controls :global(.transport-primary) {
    width: 36px;
  }
  @media (pointer: coarse) {
    .controls :global(.icon-button) {
      width: 44px;
    }
  }
  .controls :global(.icon-button > svg) {
    opacity: 0.7;
    transition: opacity var(--fast);
  }
  .controls :global(.icon-button:is(:hover, :focus-visible) > svg) {
    opacity: 1;
  }
  .controls :global(.icon-button:is(:hover, :focus-visible)) {
    background: transparent;
    color: var(--ink);
    transform: scale(1.08);
  }
  .postplay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 30px;
    border-radius: 12px;
    display: grid;
    justify-items: center;
    gap: 20px;
    text-align: center;
    width: min(480px, calc(100% - 40px));
  }
  .volume {
    display: flex;
    align-items: center;
    min-height: calc(var(--menu-icon-size) + 2 * var(--menu-item-inset));
    padding-inline: var(--menu-item-inset);
  }
  .volume input {
    flex: 1;
    min-width: 0;
    accent-color: var(--ink);
  }
  .volume input.muted { accent-color: var(--muted); opacity: .55; }
  .chrome-hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }
  @media (max-width: 639px) {
    .controls {
      gap: 2px;
      padding-inline: 12px;
      width: calc(100% - 24px);
      bottom: calc(76px + env(safe-area-inset-bottom));
    }
    .controls:not(.audio) {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      justify-items: center;
      gap: 4px;
      height: auto;
      padding: 12px;
      border-radius: 24px;
    }
    .controls.has-quality { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    .controls:not(.audio) :global(.now-playing) {
      grid-column: 1 / -1;
      grid-row: 1;
      justify-self: stretch;
      margin-inline: 0;
    }
    .controls:not(.audio) .transport { grid-column: span 2; gap: 0; }
    .controls :global(.skip-back),
    .controls :global(.skip-forward) { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .controls :global(.icon-button),
    .controls :global(.icon-button > svg) {
      transition: none;
    }
  }
  @media (max-width: 479px) {
    .controls.audio {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 44px;
      justify-content: space-between;
      gap: 8px;
      height: auto;
      padding: 12px;
      border-radius: 24px;
    }
    .controls.audio :global(.now-playing) {
      grid-column: 1 / -1;
      grid-row: 1;
      margin-inline: 0;
    }
  }
</style>
