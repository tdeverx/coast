import { expect, test } from 'bun:test';
import { JellyfinAdapter } from '../src/lib/providers/jellyfin/adapter.server';
import { planPlayback } from '../src/lib/playback/planning';
import { qualityStreamPath } from '../src/lib/playback/quality';
import { ProviderHttpError } from '../src/lib/server/security/provider-fetch';
import { addedSubtitleTrack, subtitleLanguage, type JellyfinSubtitle } from '../src/lib/playback/subtitles';
import type { BrowserCapabilities, PlaybackSource } from '../src/lib/providers/contracts';

test('Jellyfin management credentials must access libraries and have no personal user identity',async()=>{
  const server=new JellyfinAdapter(async path=>{
    if(path==='/Library/VirtualFolders')return [];
    throw new ProviderHttpError(400);
  },'server');
  await expect(server.verifyManagementKey()).resolves.toBeUndefined();
  const personal=new JellyfinAdapter(async path=>path==='/Library/VirtualFolders'?[]:{Id:'viewer'},'viewer');
  await expect(personal.verifyManagementKey()).rejects.toThrow('personal Jellyfin account');
  const forbidden=new JellyfinAdapter(async()=>{throw new ProviderHttpError(403);},'viewer');
  await expect(forbidden.verifyManagementKey()).rejects.toMatchObject({status:403});
});

test('personal subtitle access follows Jellyfin’s subtitle permission, including on admin accounts',async()=>{
  const id='1234';
  const adapter=(policy:Record<string,boolean>)=>new JellyfinAdapter(async()=>({Id:id,Policy:policy}),'viewer');
  expect(await adapter({IsAdministrator:true,EnableSubtitleManagement:false}).canManageSubtitles(id)).toBe(false);
  expect(await adapter({IsDisabled:true,EnableSubtitleManagement:true}).canManageSubtitles(id)).toBe(false);
  expect(await adapter({EnableSubtitleManagement:true}).canManageSubtitles(id)).toBe(true);
});

test('Jellyfin searches only through OpenSubtitles results and downloads the selected provider ID', async () => {
  const calls: { path: string; method: string }[] = [];
  const signal = new AbortController().signal;
  const adapter = new JellyfinAdapter(async (path, init) => {
    calls.push({ path, method: init?.method ?? 'GET' });
    if (init?.method === 'POST') return null;
    expect(init?.signal).toBe(signal);
    return [
      { ProviderName: 'Open Subtitles', Id: 'opensubtitles/file+123', Name: 'Matching release', IsHashMatch: true },
      { ProviderName: 'Other provider', Id: 'other' },
      { ProviderName: 'OpenSubtitles', Id: '' },
    ];
  }, 'device');
  const results = await adapter.remoteSubtitles('abc', 'pt-br', signal);
  expect(results.map(result => [result.Id, result.IsHashMatch])).toEqual([['opensubtitles/file+123', true]]);
  await adapter.downloadSubtitle('abc', results[0].Id);
  expect(calls).toEqual([
    { path: '/Items/abc/RemoteSearch/Subtitles/pt-br', method: 'GET' },
    { path: '/Items/abc/RemoteSearch/Subtitles/opensubtitles%2Ffile%2B123', method: 'POST' },
  ]);
});

test('subtitle confirmation ignores old, incompatible and ambiguous tracks', () => {
  const existing: JellyfinSubtitle = { type: 'Subtitle', index: 1, codec: 'srt', language: 'por', external: true, path: 'Movie.pt-PT.srt' };
  const added = { ...existing, index: 2, path: 'Movie.pt-BR.sdh.srt', sdh: true };
  const expected = { language: 'pt-br', sdh: true };
  expect(subtitleLanguage('eng')).toBe('en');
  expect(addedSubtitleTrack([existing], [{ ...existing, index: 9 }], expected)).toBeUndefined();
  expect(addedSubtitleTrack([existing], [existing, { ...added, codec: 'pgs' }], expected)).toBeUndefined();
  expect(addedSubtitleTrack([existing], [existing, added, { ...added, index: 3, path: 'Movie.extra.pt-BR.srt' }], expected)).toBeUndefined();
  expect(addedSubtitleTrack([existing], [existing, added], expected)?.index).toBe(2);
});

test('quality changes keep the correct source, restrict unusable choices and update Jellyfin HLS controls', () => {
  const source: PlaybackSource = {
    id: 'original', name: 'Original', container: 'mp4', bitrate: 4_000_000, directPlay: true, directStream: true,
    transcoding: true, transcodingUrl: '/Videos/abc/master.m3u8', raw: {},
    streams: [{ type: 'Video', index: 0, codec: 'h264' }, { type: 'Audio', index: 1, codec: 'aac', channels: 6 }],
  };
  const browser: BrowserCapabilities = { containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], nativeHls: false, hlsJs: true };
  const policy = { delivery: 'allow-direct', maxBitrate: 5_000_000, allowTranscoding: true } as const;
  expect(planPlayback([source], browser, policy).mode).toBe('direct');
  expect(planPlayback([source], browser, policy, source.id, 'video', { audioTrack: 1, maxHeight: 720 }).mode).toBe('transcode');
  expect(() => planPlayback([source], browser, policy, source.id, 'video', { audioTrack: 7 })).toThrow();
  expect(() => planPlayback([source], browser, { ...policy, maxBitrate: 1_000_000 }, source.id, 'video', { mode: 'direct' })).toThrow();
  const path = qualityStreamPath('/Videos/abc/master.m3u8?videoCodec=h264&MaxAudioChannels=2&MediaSourceId=original',
    { audioTrack: 1, audioChannels: 6, videoCodec: 'hevc', maxHeight: 720 });
  const params = new URL(path, 'http://example.test').searchParams;
  expect(params.has('videoCodec')).toBe(false);
  expect(Object.fromEntries(params)).toEqual({
    MediaSourceId: 'original', MaxHeight: '720', AudioStreamIndex: '1', MaxAudioChannels: '6',
    TranscodingMaxAudioChannels: '6', VideoCodec: 'hevc', AllowVideoStreamCopy: 'false', AllowAudioStreamCopy: 'false',
  });
});
