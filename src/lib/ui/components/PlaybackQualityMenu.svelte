<script lang="ts">
  import { audioChannelCounts, bitrateOptions, requiresQualityEncoding, videoHeights, type AudioEncoding, type PlaybackQuality, type PlaybackQualityInfo, type VideoEncoding } from '#lib/playback/quality.js';
  import Button from './Button.svelte';

  let { info, disabled = false, section, onchange }: {
    info: PlaybackQualityInfo;
    disabled?: boolean;
    section: 'resolution' | 'video-advanced' | 'audio-advanced' | 'audio-track';
    onchange: (value: PlaybackQuality) => void | Promise<void>;
  } = $props();
  const selection = $derived(info.selection);
  const encode = $derived(info.allowTranscode && selection.mode !== 'direct');
  const audio = $derived(info.audioTracks.find(track => track.index === selection.audioTrack) ??
    info.audioTracks.find(track => track.default) ?? info.audioTracks[0]);
  const directUnavailable = $derived(info.mode === 'transcode' && !requiresQualityEncoding(selection) && selection.mode !== 'direct');
  const video = [{ value: 'h264', label: 'H.264' }, { value: 'hevc', label: 'H.265 (HEVC)' }] as const;
  const audioFormats = [{ value: 'aac', label: 'AAC' }, { value: 'ac3', label: 'Dolby Digital' }, { value: 'eac3', label: 'Dolby Digital Plus' }] as const;
  const channels = { 1: 'Mono', 2: 'Stereo', 6: '5.1 surround', 8: '7.1 surround' };
  const bitrateLabel = (rate: number) => `${rate / 1_000_000} Mbps`;
  const unavailable = 'These options are unavailable while playback is changing or synced.';
  function set<K extends keyof PlaybackQuality>(key: K, value: PlaybackQuality[K]) {
    if (selection[key] === value) return;
    const next = key === 'mode' && value === 'direct' ? { maxBitrate: selection.maxBitrate } : selection;
    void onchange({ ...next, [key]: value });
  }
  function videoReason(codec: VideoEncoding) {
    return !encode ? 'Transcoding is unavailable.' : !info.videoCodecs.includes(codec) ? 'This device cannot play this encoding.' : undefined;
  }
  function audioReason(codec: AudioEncoding) {
    return !encode ? 'Transcoding is unavailable.' : !info.audioCodecs.includes(codec) ? 'This device cannot play this encoding.' : undefined;
  }
</script>

{#if section === 'resolution'}
  <Button menu label="Resolution" icon="film" panel {disabled} disabledReason={unavailable}>
    <Button item selection="radio" checked={selection.maxHeight === undefined} onclick={() => set('maxHeight', undefined)}>Automatic</Button>
    <div class="menu-divider" role="separator"></div>
    {#each videoHeights as height (height)}
      {@const higher = info.height !== undefined && height > info.height}
      <Button item selection="radio" checked={selection.maxHeight === height} disabled={!encode || higher}
        disabledReason={higher ? 'Above source resolution.' : 'Transcoding is unavailable.'}
        onclick={() => set('maxHeight', height)}>{height}p</Button>
    {/each}
  </Button>
{:else if section === 'audio-track' && info.audioTracks.length}
  <Button menu label="Audio track" icon="volume" panel {disabled}>
    <Button item selection="radio" checked={selection.audioTrack === undefined} onclick={() => set('audioTrack', undefined)}>Automatic</Button>
    <div class="menu-divider" role="separator"></div>
    {#each info.audioTracks as track (track.index)}
      <Button item selection="radio" checked={selection.audioTrack === track.index} disabled={!encode}
        disabledReason="Changing audio tracks requires transcoding." onclick={() => set('audioTrack', track.index)}>{track.label}</Button>
    {/each}
  </Button>
{:else if section === 'video-advanced'}
  <Button menu label="Bitrate" icon="sliders" panel {disabled}>
    <Button item selection="radio" checked={selection.maxBitrate === undefined} onclick={() => set('maxBitrate', undefined)}>Automatic · up to {bitrateLabel(info.bitrateLimit)}</Button>
    <div class="menu-divider" role="separator"></div>
    {#each bitrateOptions as rate (rate)}
      {@const above = rate > info.bitrateLimit}
      {@const needsEncoding = !encode && (!info.bitrate || rate < info.bitrate)}
      <Button item selection="radio" checked={selection.maxBitrate === rate} disabled={above || needsEncoding}
        disabledReason={above ? `Above your ${bitrateLabel(info.bitrateLimit)} limit.` : 'Transcoding is required at this bitrate.'}
        onclick={() => set('maxBitrate', rate)}>{bitrateLabel(rate)}</Button>
    {/each}
  </Button>
  <Button menu label="Playback mode" icon="play" panel {disabled}>
    <Button item selection="radio" checked={selection.mode === undefined} onclick={() => set('mode', undefined)}>Automatic</Button>
    <div class="menu-divider" role="separator"></div>
    <Button item selection="radio" checked={selection.mode === 'direct'} disabled={directUnavailable}
      disabledReason="The current video requires transcoding." onclick={() => set('mode', 'direct')}>Direct play only</Button>
    <Button item selection="radio" checked={selection.mode === 'transcode'} disabled={!info.allowTranscode}
      disabledReason="Transcoding is unavailable." onclick={() => set('mode', 'transcode')}>Force transcode</Button>
  </Button>
  <Button menu label="Video codec" icon="film" panel {disabled}>
    <Button item selection="radio" checked={selection.videoCodec === undefined} onclick={() => set('videoCodec', undefined)}>Automatic</Button>
    <div class="menu-divider" role="separator"></div>
    {#each video as codec (codec.value)}
      <Button item selection="radio" checked={selection.videoCodec === codec.value} disabled={!!videoReason(codec.value)}
        disabledReason={videoReason(codec.value)} onclick={() => set('videoCodec', codec.value)}>{codec.label}</Button>
    {/each}
  </Button>
{:else if section === 'audio-advanced'}
  <Button menu label="Audio channels" icon="volume" panel {disabled}>
    <Button item selection="radio" checked={selection.audioChannels === undefined} onclick={() => set('audioChannels', undefined)}>Automatic</Button>
    <div class="menu-divider" role="separator"></div>
    {#each audioChannelCounts as count (count)}
      {@const higher = audio?.channels !== undefined && count > audio.channels}
      <Button item selection="radio" checked={selection.audioChannels === count} disabled={!encode || higher}
        disabledReason={higher ? 'Above the selected track’s channel count.' : 'Transcoding is unavailable.'}
        onclick={() => set('audioChannels', count)}>{channels[count]}</Button>
    {/each}
  </Button>
  <Button menu label="Audio codec" icon="volume" panel {disabled}>
    <Button item selection="radio" checked={selection.audioCodec === undefined} onclick={() => set('audioCodec', undefined)}>Automatic</Button>
    <div class="menu-divider" role="separator"></div>
    {#each audioFormats as codec (codec.value)}
      <Button item selection="radio" checked={selection.audioCodec === codec.value} disabled={!!audioReason(codec.value)}
        disabledReason={audioReason(codec.value)} onclick={() => set('audioCodec', codec.value)}>{codec.label}</Button>
    {/each}
  </Button>
{/if}
