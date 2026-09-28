import { expect, test } from 'bun:test';
import { trackingLanguage } from '../src/lib/media/model';
test('tracking labels adapt to the medium', () => {
  expect(trackingLanguage('screen').mark).toBe('Mark watched');
  expect(trackingLanguage('screen').logAgain).toBe('Log another watch…');
  expect(trackingLanguage('book').startRepeat).toBe('Start rereading…');
  expect(trackingLanguage('comic').mark).toBe('Mark read');
  expect(trackingLanguage('game').mark).toBe('Mark completed');
  expect(trackingLanguage('game').stopRepeat).toBe('Stop replaying');
});
