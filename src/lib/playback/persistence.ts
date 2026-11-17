import type { PlaybackView } from '#lib/ui/types.js';

const key = 'coast:playback';
type PlaybackSnapshot = {
  viewer: string;
  session: PlaybackView;
  position: number;
  playedSeconds: number;
  subtitle: number;
  volume: number;
  crop: boolean;
  paused: boolean;
  muted: boolean;
  browsing: boolean;
  continuationId: string;
  queue: { id: string; title: string; availability: string }[];
  queueIndex: number;
};

export function savePlaybackSnapshot(snapshot?: PlaybackSnapshot) {
  try {
    if (snapshot) sessionStorage.setItem(key, JSON.stringify(snapshot));
    else sessionStorage.removeItem(key);
  } catch {
    // The live player remains usable when tab storage is disabled.
  }
}

export function takePlaybackSnapshot(viewer: string): PlaybackSnapshot | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as PlaybackSnapshot | null;
    sessionStorage.removeItem(key);
    if (!saved || saved.viewer !== viewer || saved.session?.shareId ||
        saved.session?.url !== `/api/v1/playback/${saved.session?.id}/stream` ||
        !Number.isFinite(saved.position) || !Number.isFinite(saved.playedSeconds) || saved.playedSeconds < 0 ||
        !Number.isFinite(saved.volume) || !Array.isArray(saved.queue)) return;
    return saved;
  } catch {
    savePlaybackSnapshot();
  }
}
