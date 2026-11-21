import type { PlaybackView } from '#lib/ui/types.js';

export function playbackTabTitle(session: PlaybackView) {
  const { seriesTitle, episodeCode } = session.nowPlaying ?? {};
  return [seriesTitle, episodeCode, session.title, 'Coast'].filter(Boolean).join(' · ');
}

export function playbackMediaMetadata(session: PlaybackView): MediaMetadataInit {
  const { seriesTitle, episodeCode, artist, album } = session.nowPlaying ?? {};
  return {
    title: [episodeCode, session.title].filter(Boolean).join(' · '),
    artist: seriesTitle ?? artist,
    album,
    artwork: session.artwork ? [{ src: session.artwork }] : [],
  };
}

/** Svelte's route and details titles write to the same title element. */
export function overridePlaybackTabTitle(title: string) {
  let pageTitle = document.title;
  document.title = title;
  const observer = new MutationObserver(() => {
    if (document.title === title) return;
    pageTitle = document.title;
    document.title = title;
  });
  const element = document.querySelector('title');
  if (element) observer.observe(element, { childList: true, characterData: true, subtree: true });
  return () => {
    observer.disconnect();
    if (document.title === title) document.title = pageTitle;
  };
}

export function registerSystemMediaActions(
  session: MediaSession,
  handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>>,
) {
  const supported: MediaSessionAction[] = [];
  for (const action of Object.keys(handlers) as MediaSessionAction[]) {
    const handler = handlers[action];
    if (!handler) continue;
    try {
      session.setActionHandler(action, handler);
      supported.push(action);
    } catch { /* Browsers expose different action sets. */ }
  }
  return () => {
    for (const action of supported) session.setActionHandler(action, null);
  };
}
