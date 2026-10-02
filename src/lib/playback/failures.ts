export function playbackFailureMessage(status?: number, code?: number) {
  if (status === 401) return 'Your playback connection needs authentication. Reconnect the account in Settings → Connections.';
  if (status === 403) return 'This account no longer has permission to play the item. Check its access on the media server.';
  if (status === 404 || status === 410) return 'This media source is no longer available. Choose another source or check the server.';
  if (code === 3 || code === 4) return 'This stream cannot be decoded or its format is unsupported. Try another source or edition.';
  return 'The stream stopped receiving media. Check the server connection, then try again.';
}
export function bufferedAhead(ranges: Pick<TimeRanges, 'length' | 'start' | 'end'>, position: number) {
  for (let i = 0; i < ranges.length; i++) if (ranges.start(i) <= position + 0.1 && ranges.end(i) > position) return ranges.end(i) - position;
  return 0;
}
export function streamHasStopped(input: { buffered: number; readyState: number; paused: boolean; started: boolean; stalledFor: number; broken?: boolean }) {
  return !(input.paused && input.started && !input.broken) && (input.broken || input.buffered <= 0.25) && (input.broken || input.readyState < 3) && input.stalledFor >= 8000;
}
