<script lang="ts">
  import { browserDiagnostic } from '$lib/ui/diagnostics';
  import { sequencePath } from '$lib/media/sequence';
  import { onMount, untrack, tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import {
    player,
    advanceMusic,
    playSavedMusicQueue,
    playMedia,
    registerPlaybackController,
    setPlaybackMuted,
  } from '$lib/playback/client.svelte';
  import { actualPlayedDelta } from '$lib/playback/listening';
  import { noCrop, videoFitStyle, type FrameCrop } from '$lib/playback/crop';
  import { observeVideoCrop } from '$lib/playback/observe-crop';
  import { api, message } from '$lib/ui/client';
  import type { MediaView } from '$lib/ui/types';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import Icon from './Icon.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import PlaybackTimeline from './PlaybackTimeline.svelte';
  let video = $state<HTMLVideoElement>(null!);
  let audio = $state<HTMLAudioElement>(null!);
  let host: HTMLDivElement;
  let current = $state(0),
    duration = $state(0),
    crop = $state(true),
    volume = $state(1),
    subtitle = $state(-1),
    error = $state('');
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
  function pause() { accountPlayed(); media?.pause(); }
  function waiting() { accountPlayed(); wasPlaying = false; tracePlayback('playback.waiting'); }
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
  function seek(seconds: number) {
    if (!media || !Number.isFinite(duration) || duration <= 0) return;
    accountPlayed();
    current = Math.max(0, Math.min(duration, seconds));
    if (audioMode) seeking = true;
    media.currentTime = current;
    revealControls();
    void report();
  }
  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }
  function armIdle() {
    clearTimeout(idleTimer);
    if (!active || audioMode || player.paused || player.role === 'postplay' || error) return;
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
    active;
    player.paused;
    player.role;
    error;
    untrack(() => revealControls());
    return () => clearTimeout(idleTimer);
  });
  async function report(event = 'progress') {
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
          await api(`playback/${session.id}/progress`, {
            ...payload,
            event: 'start',
            paused: false,
          });
          acknowledgedSessionId = session.id;
        }
        await api(`playback/${session.id}/progress`, payload);
        if (event === 'start') acknowledgedSessionId = session.id;
        return true;
      } catch (e) {
        if (player.session?.id === session.id) error = message(e);
        return false;
      }
    });
    return reports;
  }
  function playing() {
    player.paused = false;
    if (!active || player.subtitlePrompt || !player.session || closed) return;
    // Ignore events from a source being replaced.
    if (media.getAttribute('src') !== player.session.url && !hls) return;
    startedSessionId = player.session.id;
    current = media.currentTime;
    duration = Number.isFinite(media.duration) ? media.duration : player.session?.durationSeconds ?? 0;
    if (audioMode) { playedPosition = media.currentTime; playedAt = performance.now(); wasPlaying = true; }
    lastReport = Date.now();
    void report('start');
  }
  async function close() {
    if (closed) return;
    closed = true;
    pause();
    await report('stop');
    player.role = 'idle';
    player.paused = true;
    player.session = null;
    player.subtitlePrompt = false;
    error = '';
    closed = false;
    void invalidateAll();
  }
  async function toggle() {
    if (!media) return;
    if (media.paused) {
      try {
        await media.play();
      } catch (e) {
        error = message(e);
      }
    } else pause();
  }
  async function failure() {
    if (!src) return;
    tracePlayback('playback.failed');
    error = 'Playback was interrupted. Please try again.';
    if (player.session)
      await api(`playback/${player.session.id}/error`, { code: media?.error?.code ?? 0 }).catch(
        () => {}
      );
  }
  function update() {
    accountPlayed();
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
      if (delivered) await advanceMusic();
      else player.paused = true;
      return;
    }
    saving = true;
    saved = await report('ended');
    saving = false;
    player.role = 'postplay';
    player.paused = true;
    void invalidateAll();
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
    }
  });
  $effect(() => {
    const url = src,
      kind = player.session?.kind,
      element = media;
    if (!element || !url) return;
    let cancelled = false;
    error = '';
    bars = noCrop;
    hls?.destroy();
    hls = null;
    const start = async () => {
      if (kind === 'hls' && !element.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (!Hls.isSupported()) {
          await failure();
          return;
        }
        const engine = new Hls();
        hls = engine;
        engine.loadSource(url);
        engine.attachMedia(element);
        engine.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) void failure();
        });
        engine.on(Hls.Events.MANIFEST_PARSED, () => {
          void element.play().catch(() => {
            player.paused = true;
          });
        });
      } else {
        if (element.getAttribute('src') !== url) element.src = url;
        await element.play().catch(() => {
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
      stopCrop();
      hls?.destroy();
      hls = null;
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  });
  $effect(() => {
    if (media) { media.muted = player.muted; media.volume = volume; }
  });
  onMount(() => {
    const unregister = registerPlaybackController({
      stop: close,
      pause,
      resume: () => media.play(),
    });
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      bounds = { width: rect.width, height: rect.height };
    });
    observer.observe(host);
    const key = (e: KeyboardEvent) => {
      if (
        !active ||
        player.paused ||
        e.defaultPrevented ||
        ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes((e.target as HTMLElement)?.tagName)
      )
        return;
      if (e.key === ' ') {
        e.preventDefault();
        void toggle();
      }
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
        pause();
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
  onerror={() => { if (audioMode) void failure(); }}
><track kind="captions" /></audio>
<div bind:this={host} class="player" class:active={active && !audioMode} aria-hidden={!active || audioMode}>
  <video
    bind:this={video}
    data-player="playback"
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
    onerror={() => { if (!audioMode) void failure(); }}
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
    class:browsing={player.paused}
    inert={!player.controlsVisible && !player.paused}
  >
    {#if error}<div class="play-error solid-surface" role="alert">
        <p>{error}</p>
        <div class="row">
          <Button onclick={() => switchEdition()}>Try again</Button><Button
            variant="secondary"
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
            variant="secondary"
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
          >{/if}<Button variant={next ? 'secondary' : 'primary'} onclick={close}
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
        <button
          class="icon-button" class:skip-back={!audioMode}
          aria-label={audioMode ? 'Previous track' : 'Back 10 seconds'}
          title={audioMode ? 'Previous track' : 'Back 10 seconds'}
          onclick={() => audioMode ? advanceMusic(-1) : seek(current - 10)}><Icon name={audioMode ? 'left' : 'rewind'} size={20} /></button
        >
        <button
          class="icon-button play-toggle"
          aria-label={player.paused ? 'Play' : 'Pause'}
          onclick={toggle}><Icon name={player.paused ? 'play' : 'pause'} size={28} /></button
        >
        <button
          class="icon-button" class:skip-forward={!audioMode}
          aria-label={audioMode ? 'Next track' : 'Forward 30 seconds'}
          title={audioMode ? 'Next track' : 'Forward 30 seconds'}
          onclick={() => audioMode ? advanceMusic() : seek(current + 30)}><Icon name={audioMode ? 'right' : 'forward'} size={20} /></button
        >
      </div>
      <PlaybackTimeline
        mediaId={player.session!.mediaId}
        href={audioMode ? `/music/work/${player.session!.mediaId}` : undefined}
        audio={audioMode}
        title={player.session?.title ?? 'Now playing'}
        detail={player.session?.detail ?? ''}
        artwork={player.session?.artwork}
        {current}
        {duration}
        onseek={seek}
        bind:scrubbing
      />
      <ContextMenu label="Playback options" upward>
        {#if audioMode}
          <MenuAction icon="list" onclick={()=>playSavedMusicQueue().catch(cause=>error=message(cause))}>Play saved music queue</MenuAction>
          {#if player.audioNotice}<p class="menu-status" role="status">{player.audioNotice}</p>{/if}
          <ContextMenu label="Queue" icon="list" upward panel>
            {#each player.audioQueue as entry, index}
              <MenuAction selection="radio" checked={index === player.audioIndex} disabled={entry.availability !== 'available'} disabledReason={entry.availability === 'unknown' ? 'Availability unresolved' : entry.availability !== 'available' ? 'Unavailable' : undefined}
                onclick={() => { player.audioIndex = index - 1; void advanceMusic(); }}>{entry.title}</MenuAction>
            {/each}
          </ContextMenu>
        {:else}
        {#if tracks.length}
          <ContextMenu label="Subtitles" icon="subtitles" upward panel>
            <MenuAction
              selection="radio"
              checked={subtitle === -1}
              onclick={() => {
                subtitle = -1;
                applySubtitles();
              }}>Off</MenuAction
            >
            <div class="menu-divider" role="separator"></div>
            {#each tracks as track}<MenuAction
                selection="radio"
                checked={subtitle === track.index}
                onclick={() => {
                  subtitle = track.index;
                  applySubtitles();
                }}>{track.label}</MenuAction
              >{/each}
          </ContextMenu>
        {:else}<MenuAction
            icon="subtitles"
            branch
            disabled
            disabledReason="No subtitle tracks available">Subtitles</MenuAction
          >{/if}
        {#if editions.length > 1}<ContextMenu label="Version" icon="film" upward panel>
            {#each editions as edition}<MenuAction
                selection="radio"
                checked={edition === (player.session?.edition ?? '')}
                onclick={() => switchEdition(edition)}>{edition || 'Original'}</MenuAction
              >{/each}
          </ContextMenu>{/if}
        <div class="menu-divider" role="separator"></div>
        <MenuAction icon="crop" checked={crop} showCheckmark={false} onclick={() => (crop = !crop)}
          >{crop ? 'Fit video' : 'Crop black bars'}</MenuAction
        >
        <MenuAction icon="fullscreen" onclick={fullscreen}>Full screen</MenuAction>
        {/if}
      </ContextMenu>
      {#if !audioMode}<div class="control-divider" aria-hidden="true"></div>
      <button
        class="icon-button fullscreen-button"
        aria-label="Toggle fullscreen"
        title="Toggle fullscreen"
        onclick={fullscreen}><Icon name="fullscreen" size={20} /></button
      >
      {/if}
      <ContextMenu label="Volume" upward>
        {#snippet trigger()}<Icon
            name={player.muted || volume === 0 ? 'muted' : 'volume'}
            size={21}
          />{/snippet}
        {#snippet children()}
          <MenuAction
            icon={player.muted ? 'muted' : 'volume'}
            checked={player.muted}
            showCheckmark={false}
            onclick={() => setPlaybackMuted(!player.muted)}
            >{player.muted ? 'Unmute' : 'Mute'}</MenuAction
          >
          <div class="menu-divider" role="separator"></div>
          <label class="volume" data-menu-interactive
            >Volume<input
              type="range"
              data-menu-focus
              min="0"
              max="1"
              step="0.05"
              bind:value={volume}
              oninput={() => {
                media.volume = volume;
                setPlaybackMuted(volume === 0);
              }}
            /></label
          >
        {/snippet}
      </ContextMenu>
      <button class="icon-button" aria-label="Close player" title="Close player" onclick={close}
        ><Icon name="close" size={20} /></button
      >
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
    background: #000;
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
    position: absolute;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
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
    gap: 2px;
    border-radius: 999px;
    padding: 6px 14px;
    height: 56px;
    width: min(760px, calc(100% - 32px));
    color: var(--ink);
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }
  .controls :global(.icon-button) {
    width: 32px;
    height: 44px;
    border-radius: 10px;
    color: #fff;
    transition: transform var(--fast) var(--ease);
  }
  .controls .play-toggle {
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
    color: #fff;
    transform: scale(1.08);
  }
  .control-divider {
    height: 20px;
    width: 1px;
    flex: none;
    margin-inline: 4px;
    background: rgb(255 255 255 / 20%);
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
    font-size: 12px;
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
    .controls .fullscreen-button,
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
      grid-template-columns: repeat(4, 44px);
      justify-content: space-between;
      gap: 8px;
      height: auto;
      padding: 10px 16px 8px;
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
    .skip-back,
    .skip-forward {
      display: none;
    }
  }
</style>
