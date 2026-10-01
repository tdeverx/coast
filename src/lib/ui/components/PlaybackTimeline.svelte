<script lang="ts">
  import Icon from './Icon.svelte';
  import { playbackTime as time } from '$lib/playback/time';

  let { mediaId, href, audio = false, title, detail, artwork, current, duration, onseek, scrubbing = $bindable(false) }: {
    mediaId: string;
    href?: string;
    audio?: boolean;
    title: string;
    detail: string;
    artwork?: string | null;
    current: number;
    duration: number;
    onseek: (seconds: number) => void;
    scrubbing?: boolean;
  } = $props();
  let preview = $state(0);
  let artworkFailed = $state(false);
  const length = $derived(Number.isFinite(duration) ? Math.max(0, duration) : 0);
  const position = $derived(Math.min(length, Math.max(0, scrubbing ? preview : current)));
  const progress = $derived(length > 0 ? position / length * 100 : 0);
  $effect(() => { artwork; artworkFailed = false; });
  function commit(value: string) {
    onseek(Number(value));
    scrubbing = false;
  }
</script>

<div class="now-playing" class:scrubbing style={`--progress:${progress}%`}>
  <a class="artwork" href={href ?? `/media/${mediaId}`} aria-label={`View ${title}`} title={`View ${title}`}>
      {#if artwork && !artworkFailed}<img src={artwork} alt="" onerror={() => (artworkFailed = true)} />
      {:else}<Icon name={audio ? 'volume' : 'film'} size={18} />{/if}
    </a>
  <div class="seek-area">
    <div class="track-info"><div class="track-copy"><strong>{title}</strong><span>{detail}</span></div></div>
  <div class="times" aria-hidden="true"><span>{time(position)}</span><span>−{time(length - position)}</span></div>
  <div class="progress-track" aria-hidden="true"><div class="progress-fill"></div></div>
  <input
    type="range"
    aria-label="Playback position"
    aria-valuetext={`${time(position)} elapsed, ${time(length - position)} remaining`}
    min="0" max={length} step="1" value={position} disabled={length === 0}
    onpointerdown={() => { preview = current; scrubbing = true; }}
    oninput={(event) => { preview = Number(event.currentTarget.value); scrubbing = true; }}
    onchange={(event) => { if (scrubbing) commit(event.currentTarget.value); }}
    onpointerup={(event) => { if (scrubbing) commit(event.currentTarget.value); }}
    onpointercancel={() => (scrubbing = false)}
    onblur={() => (scrubbing = false)}
  />
  </div>
</div>

<style>
  .now-playing { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; height: 44px; margin-inline: 8px; }
  .seek-area { position: relative; flex: 1; min-width: 0; height: 44px; border-radius: 6px; }
  .track-info { position: absolute; inset: 1px 0 9px; display: flex; align-items: center; gap: 9px; pointer-events: none; transition: opacity var(--fast) var(--ease), transform var(--fast) var(--ease); }
  .artwork { position: relative; opacity: 0.7; transition: opacity var(--fast), transform var(--fast) var(--ease); width: 28px; height: 42px; flex: none; display: grid; place-items: center; overflow: hidden; border-radius: 4px; background: var(--surface); }
  .artwork:is(:hover, :focus-visible) { transform: scale(1.08); opacity: 1; }
  .artwork img { width: 100%; height: 100%; object-fit: cover; }
  .track-copy { display: grid; min-width: 0; font-size: var(--text-sm); line-height: var(--leading-normal); }
  .track-copy strong, .track-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track-copy strong { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
  .track-copy span { opacity: .72; margin-top: 2px; }
  .times { position: absolute; inset: 7px 0 auto; display: flex; justify-content: space-between; gap: 8px; font-size: var(--text-sm); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; opacity: 0; transform: translateY(3px); transition: opacity var(--fast) var(--ease), transform var(--fast) var(--ease); pointer-events: none; }
  .progress-track { position: absolute; bottom: 3px; width: 100%; height: 3px; border-radius: 99px; overflow: hidden; background: color-mix(in srgb, var(--white) calc(69 / 255 * 100%), transparent); transition: height var(--fast) var(--ease); pointer-events: none; }
  .progress-fill { width: var(--progress); height: 100%; background: currentColor; border-radius: inherit; }
  input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; touch-action: pan-y; }
  .seek-area:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 4px; }
  .now-playing:is(:has(.seek-area:hover), :has(input:focus-visible), .scrubbing) .track-info { opacity: 0; transform: translateY(-3px); }
  .now-playing:is(:has(.seek-area:hover), :has(input:focus-visible), .scrubbing) .times { opacity: 1; transform: none; }
  .now-playing:is(:has(.seek-area:hover), :has(input:focus-visible), .scrubbing) .progress-track { height: 8px; }
  @media (hover: none), (pointer: coarse) {
    .track-info { opacity: 0; }
    .times { opacity: 1; transform: none; }
    .progress-track { height: 8px; }
  }
  @media (max-width: 639px) { .now-playing { margin-inline: 4px; gap: 10px; } .track-copy strong { font-size: var(--text-sm); } .track-copy span { font-size: var(--text-sm); } }
  @media (prefers-reduced-motion: reduce) { .track-info, .times, .progress-track, .artwork { transition: none; } }
</style>
