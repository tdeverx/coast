import { test, expect } from 'bun:test';
import {
  validProgress,
  progressFraction,
  lifecycle,
  primaryMediaAction,
  mediaCategories,
} from '../src/lib/media/model';
import { supportsProviderField } from '../src/lib/providers/capabilities';
import { emptyTrackingState, projectTracking } from '../src/lib/core/tracking/state';
test('typed progress keeps counts, percentages and elapsed time distinct', () => {
  expect(progressFraction({ unit: 'pages', value: 100, total: 400 })).toBe(0.25);
  expect(progressFraction({ unit: 'percent', value: 25 })).toBe(0.25);
  expect(progressFraction({ unit: 'minutes-played', value: 500 })).toBeNull();
  expect(validProgress({ unit: 'pages', value: 1.5, total: 200 })).toBe(false);
  expect(validProgress({ unit: 'percent', value: 101 })).toBe(false);
  expect(validProgress({ unit: 'chapters', value: 5, total: 4 })).toBe(false);
  expect(validProgress({ unit: 'seconds', value: Infinity })).toBe(false);
});
test('lifecycle and primary action do not confuse ownership, completion and playback', () => {
  expect(lifecycle({ completed: false, dropped: false, planned: true })).toBe('planned');
  expect(
    lifecycle({
      completed: false,
      dropped: false,
      paused: true,
      planned: false,
      progress: { unit: 'pages', value: 30 },
    })
  ).toBe('paused');
  expect(primaryMediaAction({ category: 'book', canOpen: false, canRequest: false })).toBe(
    'progress'
  );
  expect(primaryMediaAction({ category: 'book', canOpen: true, canRequest: false })).toBe('read');
  expect(primaryMediaAction({ category: 'game', canOpen: true, canRequest: false })).toBe('open');
  expect(primaryMediaAction({ category: 'screen', canOpen: false, canRequest: true })).toBe(
    'request'
  );
  expect(mediaCategories.comic.repeat).toBe('Reread');
});
test('adapter fields are scoped to implemented media and directions', () => {
  expect(supportsProviderField('jellyfin', 'screen', 'history', 'write')).toBe(true);
  expect(supportsProviderField('jellyfin', 'book', 'history', 'write')).toBe(false);
  expect(supportsProviderField('tmdb', 'screen', 'metadata', 'write')).toBe(false);
  expect(supportsProviderField('seerr', 'screen', 'history', 'write')).toBe(false);
});
test('undated completion retains state without manufacturing a completion date', () => {
  const { state } = projectTracking(emptyTrackingState(), { action: 'watch', occurredAt: null });
  expect(state.watched).toBe(true);
  expect(state.playCount).toBe(1);
  expect(state.lastWatchedAt).toBeNull();
});
