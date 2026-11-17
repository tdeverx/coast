import type { PlaybackSource } from '#lib/providers/contracts.js';

export const videoHeights = [480, 720, 1080, 1440, 2160] as const;
export const audioChannelCounts = [1, 2, 6, 8] as const;
export const bitrateOptions = [0.5, 1, 2, 3, 5, 8, 10, 15, 20, 30, 40, 60, 80, 100].map(value => value * 1_000_000);
export type VideoEncoding = 'h264' | 'hevc';
export type AudioEncoding = 'aac' | 'ac3' | 'eac3';
export type PlaybackQuality = {
  mode?: 'direct' | 'transcode';
  maxHeight?: typeof videoHeights[number];
  maxBitrate?: number;
  audioTrack?: number;
  audioChannels?: typeof audioChannelCounts[number];
  videoCodec?: VideoEncoding;
  audioCodec?: AudioEncoding;
};
export type PlaybackQualityInfo = {
  mode: 'direct' | 'relay' | 'transcode';
  height?: number;
  bitrate?: number;
  bitrateLimit: number;
  allowTranscode: boolean;
  videoCodecs: VideoEncoding[];
  audioCodecs: AudioEncoding[];
  audioTracks: { index: number; label: string; channels?: number; default?: boolean }[];
  selection: PlaybackQuality;
};

export function requiresQualityEncoding(quality?: PlaybackQuality) {
  return !!quality && (quality.mode === 'transcode' || quality.maxHeight !== undefined || quality.audioTrack !== undefined ||
    quality.audioChannels !== undefined || quality.videoCodec !== undefined || quality.audioCodec !== undefined);
}
export function qualitySourceAllowed(source: PlaybackSource, quality?: PlaybackQuality) {
  if (quality?.audioTrack === undefined) return true;
  return source.streams.some(stream => stream.type === 'Audio' && stream.index === quality.audioTrack);
}
export function qualityStreamPath(path: string, quality: PlaybackQuality) {
  if (!requiresQualityEncoding(quality)) return path;
  const url = new URL(path, 'http://coast.invalid');
  const overrides: Record<string, string> = {};
  if (quality.maxHeight) overrides.MaxHeight = String(quality.maxHeight);
  if (quality.audioTrack !== undefined) overrides.AudioStreamIndex = String(quality.audioTrack);
  if (quality.audioChannels) {
    overrides.MaxAudioChannels = String(quality.audioChannels);
    overrides.TranscodingMaxAudioChannels = String(quality.audioChannels);
    overrides.AllowAudioStreamCopy = 'false';
  }
  if (quality.videoCodec) overrides.VideoCodec = quality.videoCodec;
  if (quality.videoCodec || quality.maxHeight) overrides.AllowVideoStreamCopy = 'false';
  if (quality.audioCodec) {
    overrides.AudioCodec = quality.audioCodec;
    overrides.AllowAudioStreamCopy = 'false';
  }
  const keys = new Set(Object.keys(overrides).map(key => key.toLowerCase()));
  for (const key of [...url.searchParams.keys()]) if (keys.has(key.toLowerCase())) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(overrides)) url.searchParams.set(key, value);
  return url.pathname + url.search;
}
