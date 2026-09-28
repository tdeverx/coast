import { expect, test } from 'bun:test';
import { playbackTime } from '../src/lib/playback/time';
test('resume positions normalize minutes and hours', () => {
  expect(playbackTime(754)).toBe('12:34');
  expect(playbackTime(3754)).toBe('1:02:34');
  expect(playbackTime(0)).toBe('0:00');
  expect(playbackTime(-12)).toBe('0:00');
  expect(playbackTime(NaN)).toBe('0:00');
});
