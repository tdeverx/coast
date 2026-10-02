import { expect, test } from 'bun:test';
import { bufferedAhead, streamHasStopped, playbackFailureMessage } from '../src/lib/playback/failures';
test('only buffered content at the current position protects playback', () => {
  const ranges = { length: 2, start: (i: number) => [0,40][i], end: (i: number) => [20,60][i] };
  expect(bufferedAhead(ranges, 10)).toBe(10);
  expect(bufferedAhead(ranges, 30)).toBe(0);
});
test('network failures wait for actual exhausted playback', () => {
  const stopped = { buffered: 0, readyState: 2, paused: false, started: true, stalledFor: 10000 };
  expect(streamHasStopped({ ...stopped, buffered: 10 })).toBe(false);
  expect(streamHasStopped({ ...stopped, readyState: 3 })).toBe(false);
  expect(streamHasStopped({ ...stopped, paused: true })).toBe(false);
  expect(streamHasStopped({ ...stopped, stalledFor: 1000 })).toBe(false);
  expect(streamHasStopped(stopped)).toBe(true);
  expect(streamHasStopped({ ...stopped, broken: true, buffered: 10, paused: true })).toBe(true);
});
test('access, missing content and decode failures have different explanations', () => {
  expect(playbackFailureMessage(403)).toContain('permission');
  expect(playbackFailureMessage(404)).toContain('no longer available');
  expect(playbackFailureMessage(undefined, 3)).toContain('decoded');
});
