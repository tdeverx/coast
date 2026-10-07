<script lang="ts">
  import {page} from '$app/state';
  import {syncedPlayer,isSyncHost,canControlPlayback,syncedCommand,leaveSynced,joinSynced} from '$lib/playback/synced/client.svelte';
  import SyncedControls from './SyncedControls.svelte';
  import { browserDiagnostic } from '$lib/ui/diagnostics';
  import { sequencePath } from '$lib/media/sequence';
  import { onMount, untrack, tick } from 'svelte';
  import { refreshAfterChange } from '$lib/ui/client';
  import { advanceMusic, playSavedMusicQueue, playMedia, registerPlaybackController, setPlaybackMuted } from '$lib/playback/client.svelte';
  import { usePlayback } from '$lib/playback/context.svelte';
  import { bufferedAhead, streamHasStopped, playbackFailureMessage } from '$lib/playback/failures';
  import { actualPlayedDelta } from '$lib/playback/listening';
  import { noCrop, videoFitStyle, type FrameCrop } from '$lib/playback/crop';
  import { observeVideoCrop } from '$lib/playback/observe-crop';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import type { MediaView } from '$lib/ui/types';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import Icon from './Icon.svelte';

  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import PlaybackTimeline from './PlaybackTimeline.svelte';

  const { api, change } = useClient();

  const { player, preview } = usePlayback();

  let syncControls = $state<{show:()=>Promise<void>}>();
  let video = $state<HTMLVideoElement>(null!);
  let audio = $state<HTMLAudioElement>(null!);
  let host: HTMLDivElement;
  let current = $state(0),
    duration = $state(0),
    crop = $state(true),
    volume = $state(1),
    subtitle = $state(-1),
    error = $state(''),
    trackingNotice = $state('');
  let frame = $state({ width: 0, height: 0 }),
    bounds = $state({ width: 0, height: 0 }),
    bars = $state<FrameCrop>(noCrop),
    next = $state<MediaView | null>(null),
    saved = $state(false),
    saving = $state(false);
  let lastReport = 0,
    startedSessionId = '',
    acknowledgedSessionId = '',
    reports: Promise<boolean> = Promise.resolve(true),
    hls: { destroy: () => void } | null = null,
    closed = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let keyboardInteraction = false;
  let scrubbing = $state(false);
  const followingHost=$derived(!!syncedPlayer.room&&!canControlPlayback());
  const audioMode = $derived(player.session?.mediaType === 'audio');
  const media = $derived<HTMLMediaElement>(audioMode ? audio : video);
  let playedSeconds = 0, playedPosition = 0, playedAt = 0, wasPlaying = false, seeking = false;
  function accountPlayed() {
    if (!audioMode || !media) return;
    const now = performance.now();
    if (playedAt) playedSeconds += actualPlayedDelta(playedPosition, media.currentTime, (now - playedAt) / 1000, wasPlaying, seeking);
    // Native played ranges exclude seek gaps, pauses and buffering, and retain the
    // endpoints that coarse timeupdate events can miss on a complete traversal.
    let covered = 0;
    for (let index = 0; index < media.played.length; index++)
      covered += media.played.end(index) - media.played.start(index);
    playedSeconds = Math.max(playedSeconds, covered);
    playedAt = now;
    playedPosition = media.currentTime;
    current = media.currentTime;
    wasPlaying = !media.paused && media.readyState >= 3;
  }
  function pause(remote=false) { if(syncedPlayer.room&&!remote&&!syncedPlayer.changing){void syncedCommand('pause');return;} accountPlayed(); media?.pause(); }
  function waiting() { accountPlayed(); wasPlaying = false; tracePlayback('playback.waiting'); if (!streamFailure) streamInterrupted({ code: 2 }); else checkStreamFailure(); }
  function seekingStarted() { seeking = true; accountPlayed(); tracePlayback('playback.seek'); }
  function seekingEnded() { seeking = false; playedPosition = media.currentTime; playedAt = performance.now(); wasPlaying = !media.paused && media.readyState >= 3; }
  function paused() {
    accountPlayed();
    player.paused = true;
    tracePlayback('playback.pause');
    if (active && !closed && player.role !== 'postplay') void report('pause');
  }
  const active = $derived(player.role === 'playback' || player.role === 'postplay');
  const src = $derived(player.subtitlePrompt ? undefined : player.session?.url);
  const videoStyle = $derived(
    videoFitStyle(frame.width, frame.height, bounds.width, bounds.height, bars, crop)
  );
  const tracks = $derived((player.session?.subtitles ?? []).filter((track) => track.url));
  const editions = $derived([
    ...new Set(player.session?.sources.map((source) => source.edition ?? '') ?? []),
  ]);
  function seek(seconds: number,remote=false) {
    if(syncedPlayer.room&&!remote){void syncedCommand('seek',{positionSeconds:seconds});return;}
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
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }
  function armIdle() {
    clearTimeout(idleTimer);
    if (!active || audioMode || player.browsing || player.paused || player.role === 'postplay' || error) return;
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
    if (preview) return false;
    const session = player.session;
    if (!session || !active) return false;
    const started = startedSessionId === session.id;
    if (event !== 'stop' && (player.subtitlePrompt || !started)) return false;
    accountPlayed();
    const payload = {
      positionSeconds: started ? current : session.startSeconds,
      durationSeconds: started && Number.isFinite(duration) ? duration : session.durationSeconds,
      event,
      paused: event === 'pause' || media.paused,
      ...(audioMode ? { playedSeconds } : {}),
    };
    // Preserve play/pause/stop order even while a previous report is in flight.
    reports = reports.then(async () => {
      try {
        if (started && event !== 'start' && acknowledgedSessionId !== session.id) {
          await change(`playback/${session.id}/progress`, {
            ...payload,
            event: 'start',
            paused: false,
          });
          acknowledgedSessionId = session.id;
        }
        await change(`playback/${session.id}/progress`, payload);
        trackingNotice = '';
        if (event === 'start') acknowledgedSessionId = session.id;
        return true;
      } catch (e) {
        if (player.session?.id === session.id) trackingNotice = 'Tracking could not be saved yet. Playback can continue; Coast will retry the next report.';
        return false;
      }
    });
    return reports;
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
  }
  let lastTouchTap:{at:number;x:number;y:number}|null=null;
  let lastTouchAt=0;
  function toggleCrop(){crop=!crop;revealControls();}
  function playerTap(event:PointerEvent){
    if(event.pointerType!=='touch'||!event.isPrimary||!active||audioMode)return;
    const now=performance.now();lastTouchAt=now;
    if(lastTouchTap&&now-lastTouchTap.at<=350&&Math.hypot(event.clientX-lastTouchTap.x,event.clientY-lastTouchTap.y)<=24){lastTouchTap=null;toggleCrop();}
    else lastTouchTap={at:now,x:event.clientX,y:event.clientY};
  }
  async function close() {
    if (closed) return;
    closed = true;
    if(syncedPlayer.room&&!syncedPlayer.changing){if(isSyncHost())await syncedCommand('stop');else await leaveSynced();}
    pause(true);
    await report('stop');
    player.role = 'idle';
    player.paused = true;
    player.session = null;
    player.browsing = false;
    player.subtitlePrompt = false;
    error = '';
    closed = false;
    void refreshAfterChange('tracking');
  }
  async function toggle() {
    if (!media) return;
    if(syncedPlayer.room){if(!canControlPlayback()&&media.paused){try{await media.play();}catch(cause){syncedPlayer.notice=message(cause);}return;}await syncedCommand(player.paused?'play':'pause');return;}
    if (media.paused) {
      try {
        await media.play();
      } catch (e) {
        error = message(e);
      }
    } else pause();
  }
  let streamFailure: { status?: number; code?: number } | null = null;
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
    if (!src) return;
    tracePlayback('playback.failed');
    error = playbackFailureMessage(reason.status, reason.code ?? media?.error?.code);
    if (player.session)
      await change(`playback/${player.session.id}/error`, { code: media?.error?.code ?? 0 }).catch(
        () => {}
      );
  }
  function update() {
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
    const selected = tracks.findIndex((track) => track.index === subtitle);
    for (let i = 0; i < video.textTracks.length; i++)
      video.textTracks[i].mode = i === selected ? 'showing' : 'disabled';
  }
  function metadata() {
    if (!audioMode) frame = { width: video.videoWidth, height: video.videoHeight };
    duration = Number.isFinite(media.duration) ? media.duration : player.session?.durationSeconds ?? 0;
    if (active && player.session?.startSeconds && media.currentTime < 1)
      media.currentTime = player.session.startSeconds;
    if (!audioMode) applySubtitles();
  }
  async function ended() {
    if (audioMode) {
      accountPlayed();
      const delivered = await report('ended');
      if (delivered && (!syncedPlayer.room||isSyncHost())) await advanceMusic();
      else player.paused = true;
      return;
    }
    saving = true;
    saved = await report('ended');
    saving = false;
    player.role = 'postplay';
    player.paused = true;
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
      const continuation =
        details.item.kind === 'episode' && details.item.showId
          ? await api<{ next: MediaView | null }>(`media/${details.item.showId}`, undefined, 'GET')
          : details;
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
    const source = player.session?.sequence;
    if (!source) return;
    const result = await api<{ next: MediaView | null }>(
      sequencePath(source, { after }),
      undefined,
      'GET'
    );
    next = result.next;
  }
  async function switchEdition(edition?: string) {
    const session = player.session;
    if (!session) return;
    try {
      if(syncedPlayer.room&&edition===undefined){await joinSynced(syncedPlayer.room);return;}
      if (audioMode) {
        await playMedia(session.mediaId, { mediaType: 'audio', fromStart: false });
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
  $effect(() => {
    if (preview) return;
    const session = player.session;
    if (session) {
      playedSeconds = 0; playedPosition = session.startSeconds; playedAt = 0; wasPlaying = false; seeking = false;
      crop = true;
      subtitle = session.defaultSubtitleIndex ?? -1;
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
      kind = player.session?.kind,
      element = media;
    if (!element || !url) return;
    let cancelled = false;
    error = '';
    bars = noCrop;
    clearStreamFailure();
    let recoveredMedia = false, restartedNetwork = false;
    hls?.destroy();
    hls = null;
    const start = async () => {
      if (kind === 'hls' && !element.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (!Hls.isSupported()) {
          await failure({code: 4});
          return;
        }
        const engine = new Hls();
        hls = engine;
        engine.loadSource(url);
        engine.attachMedia(element);
        engine.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) { recoveredMedia = true; engine.recoverMediaError(); streamInterrupted({ code: 3 }); }
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) void failure({ code: 3 });
          else { streamInterrupted({ status: data.response?.code, code: 2 }); if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !restartedNetwork) { restartedNetwork = true; engine.startLoad(); } }
        });
        engine.on(Hls.Events.FRAG_LOADED, () => { restartedNetwork = false; clearStreamFailure(); });
        engine.on(Hls.Events.MANIFEST_PARSED, () => {
          void (syncedPlayer.room?Promise.resolve():element.play()).catch(() => {
            player.paused = true;
          });
        });
      } else {
        if (element.getAttribute('src') !== url) element.src = url;
        await (syncedPlayer.room?Promise.resolve():element.play()).catch(() => {
          player.paused = true;
        });
      }
    };
    untrack(() => void start());
    const stopCrop = audioMode ? () => {} : observeVideoCrop(video, {
      enabled: () => crop,
      onCrop: (next) => (bars = next),
    });
    return () => {
      cancelled = true;
      clearStreamFailure();
      stopCrop();
      hls?.destroy();
      hls = null;
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  });
  $effect(() => {
    if (preview) return;
    if (media) { media.muted = player.muted; media.volume = volume; }
  });
  onMount(() => {
    if (preview) return;
    const unregister = registerPlaybackController({
      beginPlaybackGesture: type => {
        const element=type==='audio'?audio:video;
        if(element?.currentSrc)void element.play().catch(()=>{/* Preparation may replace the current stream. */});
      },
      stop: close,
      pause,
      resume: () => syncedPlayer.room ? syncedCommand('play') : media.play(),
      snapshot: () => ({positionSeconds:media?.currentTime||0,buffering:!media||media.readyState<3||!!media.error,unavailable:!!error}),
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
    };
    document.addEventListener('keydown', key);
    for (const event of ['pointermove', 'pointerdown', 'touchstart', 'keydown'])
      document.addEventListener(event, revealControls, { passive: true });
    return () => {
      clearTimeout(idleTimer);
      for (const event of ['pointermove', 'pointerdown', 'touchstart', 'keydown'])
        document.removeEventListener(event, revealControls);
      observer.disconnect();
      document.removeEventListener('keydown', key);
      unregister();
      hls?.destroy();
    };
  });
  let lastTiming = 0;
  function tracePlayback(event: import('$lib/diagnostics').DiagnosticEvent) {
    browserDiagnostic(event, { sessionId: player.session?.id, durationMs: player.preparationStartedAt ? performance.now() - player.preparationStartedAt : 0, bufferedSeconds: media?.buffered.length ? Math.max(0, media.buffered.end(media.buffered.length - 1) - media.currentTime) : 0, positionSeconds: media?.currentTime, readyState: media?.readyState, networkState: media?.networkState, code: media?.error?.code });
  }
</script>
{#if page.data.experimentalParties}<SyncedControls bind:this={syncControls} />{/if}

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
<div bind:this={host} class="player" class:active={active && !audioMode} aria-hidden={!active || audioMode}>
  <video
    bind:this={video}
    data-player="playback"
    ondblclick={()=>{if(performance.now()-lastTouchAt>500)toggleCrop();}}
    onpointerup={playerTap}
    onpointercancel={()=>lastTouchTap=null}
    aria-label={player.session?.title ?? 'Title playback'}
    class:positioned={!!videoStyle}
    style={videoStyle}
    playsinline
    preload="metadata"
    ontimeupdate={() => { if (audioMode) return; update(); if (video && performance.now() - lastTiming > 10_000) { lastTiming = performance.now(); tracePlayback('playback.timing'); } }}
    onwaiting={() => { if (!audioMode) waiting(); }}
    onseeking={() => { if (!audioMode) tracePlayback('playback.seek'); }}
    onloadedmetadata={() => { if (audioMode) return; metadata(); tracePlayback('playback.ready'); }}
    onplay={() => {
      if (!audioMode) player.paused = false;
    }}
    onplaying={() => { if (audioMode) return; playing(); tracePlayback('playback.playing'); }}
    onpause={() => { if (!audioMode) paused(); }}
    onended={() => { if (!audioMode) void ended(); }}
    onerror={() => { if (!audioMode) nativeFailure(); }}
  >
    {#each tracks as track (track.url)}<track
        kind="subtitles"
        src={track.url}
        srclang={track.language ?? 'en'}
        label={track.label}
      />{/each}
  </video>
</div>
{#if active}
  <div
    class="playback-chrome"
    class:chrome-hidden={!player.controlsVisible && !player.paused}
    class:browsing={player.browsing}
    inert={!player.controlsVisible && !player.paused}
  >
    {#if syncedPlayer.notice}<p class="small" role="status">{syncedPlayer.notice}</p>{/if}
    {#if trackingNotice}<p class="small" role="status">{trackingNotice}</p>{/if}
    {#if error}<div class="play-error solid-surface" role="alert">
        <p>{error}</p>
        <div class="row">
          <Button onclick={() => switchEdition()}>Try again</Button><Button

            onclick={close}>Close</Button
          >
        </div>
      </div>{/if}
    {#if player.role === 'postplay' && !error}<div class="postplay solid-surface">
        <Icon name="check" size={30} />
        <h2>One more story, remembered.</h2>
        <p>
          {saving
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
              next &&
              playMedia(next.id, {
                continuationId: player.continuationId || next.showId,
                sequence: next.sequence,
              }).catch((e) => (error = message(e)))}
            >{next.kind === 'episode'
              ? `Play S${String(next.seasonNumber ?? 0).padStart(2, '0')}E${String(next.episodeNumber ?? 0).padStart(2, '0')}`
              : `Play ${next.title}`}</Button
          >{/if}<Button  onclick={close}
          >Back to Coast</Button
        >
      </div>{/if}
    <section
      use:liquidGlass={{ variant: 'clear' }}
      class="controls glass"
      class:audio={audioMode}
      aria-label={`Playback controls: ${player.session?.title}`}
    >
      <div class="transport">
        <Button size="icon"
          class={`icon-button ${!audioMode ? 'skip-back' : ''}`}
          disabled={followingHost}
          label={audioMode ? 'Previous track' : 'Back 10 seconds'}
          title={audioMode ? 'Previous track' : 'Back 10 seconds'}
          onclick={() => audioMode ? advanceMusic(-1) : seek(current - 10)} icon={audioMode ? 'left' : 'rewind'} iconSize={20} />
        <Button size="icon" class="icon-button play-toggle"
          disabled={followingHost&&(!player.paused||syncedPlayer.room!.paused||syncedPlayer.room!.bufferingPaused)}
          title={followingHost?'Playback is controlled by the host':undefined}
          label={player.paused ? 'Play' : 'Pause'}
          onclick={toggle} icon={player.paused ? 'play' : 'pause'} iconSize={28} />
        <Button size="icon"
          class={`icon-button ${!audioMode ? 'skip-forward' : ''}`}
          disabled={followingHost}
          label={audioMode ? 'Next track' : 'Forward 30 seconds'}
          title={audioMode ? 'Next track' : 'Forward 30 seconds'}
          onclick={() => audioMode ? advanceMusic() : seek(current + 30)} icon={audioMode ? 'right' : 'forward'} iconSize={20} />
      </div>
      <PlaybackTimeline
        mediaId={player.session!.mediaId}
        href={audioMode ? `/music/work/${player.session!.mediaId}` : undefined}
        audio={audioMode}
        title={player.session?.title ?? 'Now playing'}
        detail={`${player.session?.detail ?? ''}${syncedPlayer.room ? isSyncHost()?' · Synced host':' · Synced member':''}`}
        disabled={followingHost}
        artwork={player.session?.artwork}
        {current}
        {duration}
        onseek={seek}
        bind:scrubbing
      />
      {#if !audioMode}<Button size="icon" icon="home" label={player.browsing?'Hide UI':'Show UI'} pressed={player.browsing} onclick={toggleUi}/>{/if}
      <Button menu label="Playback options" upward>
        {#if page.data.experimentalParties}<Button item icon="party" disabled={syncedPlayer.busy} onclick={()=>syncControls?.show()}>{syncedPlayer.room?'Synced session…':'Start synced session…'}</Button>{/if}
        {#if audioMode}
          <Button item icon="list" disabled={followingHost} disabledReason="Playback is controlled by the host" onclick={()=>playSavedMusicQueue().catch(cause=>error=message(cause))}>Play saved music queue</Button>
          {#if player.audioNotice}<p class="menu-status" role="status">{player.audioNotice}</p>{/if}
          <Button menu label="Queue" icon="list" upward panel>
            {#each player.audioQueue as entry, index}
              <Button item selection="radio" checked={index === player.audioIndex} disabled={followingHost||entry.availability !== 'available'} disabledReason={followingHost?'Playback is controlled by the host':entry.availability === 'unknown' ? 'Availability unresolved' : entry.availability !== 'available' ? 'Unavailable' : undefined}
                onclick={() => { player.audioIndex = index - 1; void advanceMusic(); }}>{entry.title}</Button>
            {/each}
          </Button>
        {:else}
        {#if tracks.length}
          <Button menu label="Subtitles" icon="subtitles" upward panel>
            <Button item
              selection="radio"
              checked={subtitle === -1}
              onclick={() => {
                subtitle = -1;
                applySubtitles();
              }}>Off</Button>
            <div class="menu-divider" role="separator"></div>
            {#each tracks as track}<Button item
                selection="radio"
                checked={subtitle === track.index}
                onclick={() => {
                  subtitle = track.index;
                  applySubtitles();
                }}>{track.label}</Button>{/each}
          </Button>
        {:else}<Button item
            icon="subtitles"
            branch
            disabled
            disabledReason="No subtitle tracks available">Subtitles</Button>{/if}
        {#if editions.length > 1}<Button menu label="Version" icon="film" upward panel>
            {#each editions as edition}<Button item
                selection="radio"
                checked={edition === (player.session?.edition ?? '')}
                disabled={followingHost} disabledReason="Playback is controlled by the host"
                onclick={() => switchEdition(edition)}>{edition || 'Original'}</Button>{/each}
          </Button>{/if}
        <div class="menu-divider" role="separator"></div>
        <Button item icon="crop" checked={crop} showCheckmark={false} onclick={toggleCrop}
          >{crop ? 'Fit video' : 'Crop black bars'}</Button>
        <Button item icon="fullscreen" onclick={fullscreen}>Full screen</Button>
        {/if}
      </Button>
      {#if !audioMode}<div class="control-divider" aria-hidden="true"></div>
      <Button size="icon" class="icon-button fullscreen-button"
        label="Toggle fullscreen"
        title="Toggle fullscreen"
        onclick={fullscreen} icon="fullscreen" iconSize={20} />
      {/if}
      <Button menu label="Volume" upward>
        {#snippet trigger()}<Icon
            name={player.muted || volume === 0 ? 'muted' : 'volume'}
            size={21}
          />{/snippet}
        {#snippet children()}
          <Button item
            icon={player.muted ? 'muted' : 'volume'}
            checked={player.muted}
            showCheckmark={false}
            onclick={() => setPlaybackMuted(!player.muted)}
            >{player.muted ? 'Unmute' : 'Mute'}</Button>
          <div class="menu-divider" role="separator"></div>
          <label class="volume" data-menu-interactive
            >Volume<input
              type="range"
              data-menu-focus
              min="0"
              max="1"
              step="0.05"
              aria-valuetext={`${Math.round(volume * 100)} percent`}
              bind:value={volume}
              oninput={() => {
                media.volume = volume;
                setPlaybackMuted(volume === 0);
              }}
            /></label
          >
        {/snippet}
      </Button>
      <Button size="icon" class="icon-button" label="Close player" title="Close player" onclick={close}
         icon="close" iconSize={20} />
    </section>
  </div>
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
    touch-action:manipulation;
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
    translate: -50% 0;
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
  .controls :global(.play-toggle) {
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
    transform: scale(var(--hover-grow-strong));
  }
  .control-divider {
    height: 20px;
    width: 1px;
    flex: none;
    margin-inline: 4px;
    background: color-mix(in srgb, var(--white) 20%, transparent);
  }
  .play-error,
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
    display: grid;
    gap: 10px;
    padding: 12px;
    font-size: var(--text-sm);
  }
  .volume input {
    accent-color: var(--ink);
  }
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
    .controls :global(.fullscreen-button),
    .control-divider {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .controls :global(.icon-button),
    .controls :global(.icon-button > svg) {
      transition: none;
    }
  }
  @media (max-width: 479px) {
    .controls {
      display: grid;
      grid-template-columns: repeat(5, 44px);
      justify-content: space-between;
      gap: 8px;
      height: auto;
      padding: 12px;
      border-radius: 24px;
    }
    .controls :global(.now-playing) {
      grid-column: 1 / -1;
      grid-row: 1;
      margin-inline: 0;
    }
    .controls.audio {
      grid-template-columns: minmax(0, 1fr) repeat(3, 44px);
    }
    .controls :global(.skip-back),
    .controls :global(.skip-forward) {
      display: none;
    }
  }
</style>
