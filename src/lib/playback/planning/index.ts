import type { BrowserCapabilities, PlaybackPolicy, PlaybackSource } from '$lib/providers/contracts';
export interface PlaybackPlan {
  source: PlaybackSource;
  mode: 'direct' | 'relay' | 'transcode';
  useHls: boolean;
  maxBitrate: number;
}
/** Keep source selection consistent within one server and across connected servers. */
export function comparePlaybackPlans(a: PlaybackPlan, b: PlaybackPlan) {
  return (
    Number(a.mode === 'transcode') - Number(b.mode === 'transcode') ||
    (b.source.bitrate || 0) - (a.source.bitrate || 0)
  );
}
/** Pure planner: every returned source has passed both policy and browser checks. */
export function planPlayback(
  sources: PlaybackSource[],
  browser: BrowserCapabilities,
  policy: PlaybackPolicy,
  sourceId?: string
): PlaybackPlan {
  const maximum = Math.min(policy.maxBitrate, browser.maxBitrate || Infinity);
  const choices = sources
    .filter((s) => !sourceId || s.id === sourceId)
    .map((source): PlaybackPlan | null => {
      const video = source.streams.find((s) => s.type === 'Video'),
        audio =
          source.streams.find((s) => s.type === 'Audio' && s.isDefault) ||
          source.streams.find((s) => s.type === 'Audio');
      const compatible =
        !!source.container &&
        browser.containers.includes(source.container.toLowerCase()) &&
        !!video?.codec &&
        browser.videoCodecs.includes(video.codec.toLowerCase()) &&
        (!audio || (!!audio.codec && browser.audioCodecs.includes(audio.codec.toLowerCase()))) &&
        (!source.bitrate || source.bitrate <= maximum) &&
        (!browser.maxWidth || !video.width || video.width <= browser.maxWidth);
      if (source.directPlay && compatible)
        return {
          source,
          mode: policy.delivery === 'relay-only' ? 'relay' : 'direct',
          useHls: false,
          maxBitrate: maximum,
        };
      if (
        policy.allowTranscoding &&
        source.transcoding &&
        source.transcodingUrl &&
        (browser.nativeHls || browser.hlsJs)
      )
        return { source, mode: 'transcode', useHls: true, maxBitrate: maximum };
      return null;
    })
    .filter((p): p is PlaybackPlan => !!p)
    .sort(comparePlaybackPlans);
  if (!choices.length)
    throw new Error(
      'No playback source is compatible with this device and the administrator playback policy.'
    );
  return choices[0];
}
