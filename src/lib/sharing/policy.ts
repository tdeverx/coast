import {vrchatResourceParameters, type ShareTarget, type VrchatVideoCodec} from './vrchat-profile';

/** Keep quality stable inside a generation; only bitrate changes during a handoff. */
export const viewerIdleSeconds = 90;
export const minimumSharedBitrate = 500_000;
export const maximumSharedViewers = 20;
export const shareTokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** Android players select their HLS media source from the URL before fetching it. */
export function publicSharePath(token:string,target:ShareTarget='website') { return `/share/${token}${target==='vrchat'?'.m3u8':''}`; }

/** Resolvers may hand a child playlist directly to Android instead of the invitation URL. */
export function externalShareResourcePath(sessionId:string,path:string) {
  return `/api/share/external/${sessionId}/stream${new URL(path,'http://resource.invalid').pathname.toLowerCase().endsWith('.m3u8')?'.m3u8':''}`;
}

export function playbackLimits(serverMbps: number, settings: {personalBitrateMbps?:number;sharedBitrateMbps?:number}) {
  return {
    personal: Math.floor(Math.min(serverMbps, settings.personalBitrateMbps ?? serverMbps) * 1_000_000),
    shared: Math.floor((settings.sharedBitrateMbps ?? 20) * 1_000_000),
  };
}
/** Leave headroom for audio, transport overhead and variable-bitrate bursts. Not an egress shaper. */
export function sharedAllocation(budget: number, viewers: number) {
  const usable = Math.floor(budget * 0.85);
  const capacity = Math.min(maximumSharedViewers, Math.floor(usable / minimumSharedBitrate));
  return { capacity, bitrate: viewers > 0 && viewers <= capacity ? Math.floor(usable / viewers / 50_000) * 50_000 : 0 };
}
export function encodingBitrate(current: number, desired: number) {
  // Reductions take effect at the next request. Small increases keep their current generation.
  return desired < current || desired >= current * 1.25 ? desired : current;
}
/** Replace case-insensitively: Jellyfin treats query keys as case-insensitive too. */
export function sharedResourcePath(path: string, session: {providerSessionId:string;providerDeviceId:string;maxBitrate:number;mediaType:string;vrchatCodec?:VrchatVideoCodec}) {
  const url = new URL(path, 'http://resource.invalid');
  // Subtitle resources need neither bitrate nor encoding-session changes.
  if (/\/subtitles\//i.test(url.pathname)) return path;
  const replacements: Record<string,string> = {
    PlaySessionId: session.providerSessionId, DeviceId: session.providerDeviceId,
    ...(session.vrchatCodec ? vrchatResourceParameters(session.vrchatCodec,session.maxBitrate) : {}),
  };
  const keys = new Set(Object.keys(replacements).map(key=>key.toLowerCase()));
  if(session.vrchatCodec)for(const key of ['width','height','framerate','maxframerate'])keys.add(key);
  for (const key of [...url.searchParams.keys()]) if (keys.has(key.toLowerCase())) url.searchParams.delete(key);
  for (const [key,value] of Object.entries(replacements)) url.searchParams.set(key,value);
  return url.pathname+url.search;
}
