import {expect, test} from 'bun:test';
import {requestScopeFormatter} from '../src/lib/media/requests';
import type {MediaActionData} from '../src/lib/media/actions';

const request = (destination: string, is4k = false, seasons: number[] = []): MediaActionData['requests'][number] => ({
  id: destination, state: 'pending', destination, is4k, seasons,
  canCancel: true, canApprove: false, canDecline: false,
});

test('request labels preserve season order, quality and destination wording', () => {
  const other = request('Other');
  for (const [is4k, seasons, label] of [
    [false, [], 'Standard version'], [true, [], '4K version'],
    [false, [1], 'Season 1'], [true, [0], 'Season 0 · 4K'],
    [false, [3, 1], 'Seasons 3, 1'], [true, [3, 1], 'Seasons 3, 1 · 4K'],
    [false, [2, 2], 'Seasons 2, 2'],
  ] as const) {
    const item = request('Server', is4k, [...seasons]);
    expect(requestScopeFormatter([item, {...item}])(item)).toBe(label);
    expect(requestScopeFormatter([item, other])(item)).toBe(`${label} · Server`);
  }
  expect(requestScopeFormatter([])(request('Outside'))).toBe('Standard version');
  expect(requestScopeFormatter([request('A'), request('B')])(request('Outside'))).toBe('Standard version · Outside');
});
