export type ShareTarget = 'website' | 'vrchat';
export type VrchatVideoCodec = 'h264' | 'hevc';

export const vrchatAudioBitrate = 192_000;
export const vrchatMaximumBitrate = 8_000_000 + vrchatAudioBitrate;

/** VRRelay's universal output shape, with the source's native frame cadence. */
export function vrchatDeviceProfile(codec: VrchatVideoCodec) {
  return {
    Name: codec === 'h264' ? 'Coast VRChat H.264' : 'Coast VRChat H.265 (experimental)',
    DirectPlayProfiles: [],
    TranscodingProfiles: [{
      Container: codec === 'h264' ? 'ts' : 'mp4', Type: 'Video',
      VideoCodec: codec, AudioCodec: 'aac', Protocol: 'hls', Context: 'Streaming',
      MaxAudioChannels: '2', SegmentLength: 4, MinSegments: 2,
      BreakOnNonKeyFrames: false, EnableAudioVbrEncoding: false,
    }],
    CodecProfiles: [{Type: 'VideoAudio', Codec: 'aac', Conditions: [
      {Condition: 'Equals', Property: 'AudioProfile', Value: 'lc', IsRequired: true},
      {Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '2', IsRequired: true},
      {Condition: 'LessThanEqual', Property: 'AudioSampleRate', Value: '48000', IsRequired: true},
    ]}],
    SubtitleProfiles: [],
  };
}

/** Codec levels must accommodate source cadence, without requesting a new FPS. */
export function h264Level(width: number, height: number, frameRate: number) {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = blocks * frameRate;
  return rate <= 245_760 ? '41' : rate <= 522_240 ? '42' : rate <= 589_824 ? '50' : rate <= 983_040 ? '51' : '52';
}

export function hevcLevel(width:number,height:number,frameRate:number) {
  const samples=width*height*frameRate;
  return samples<=66_846_720?'120':samples<=133_693_440?'123':samples<=267_386_880?'150':samples<=534_773_760?'153':'156';
}

export function vrchatResourceParameters(codec: VrchatVideoCodec, maxBitrate: number) {
  return {
    VideoCodec: codec, AudioCodec: 'aac',
    Profile: codec === 'h264' ? 'high' : 'main',
    [`${codec}-profile`]: codec === 'h264' ? 'high' : 'main',
    'aac-profile': 'lc', AudioSampleRate: '48000', AudioChannels: '2',
    MaxAudioChannels: '2', TranscodingMaxAudioChannels: '2',
    AudioBitrate: String(vrchatAudioBitrate),
    VideoBitrate: String(Math.min(8_000_000, Math.max(100_000, maxBitrate - vrchatAudioBitrate))),
    MaxVideoBitDepth: '8', [`${codec}-videobitdepth`]: '8',
    MaxWidth: '1920', MaxHeight: '1080', RequireNonAnamorphic: 'true',
    SegmentContainer: codec === 'h264' ? 'ts' : 'mp4', SegmentLength: '4',
    MinSegments: '2', BreakOnNonKeyFrames: 'false',
    AllowVideoStreamCopy: 'false', AllowAudioStreamCopy: 'false', EnableAutoStreamCopy: 'false',
    EnableAdaptiveBitrateStreaming: 'false', EnableAudioVbrEncoding: 'false',
  };
}
