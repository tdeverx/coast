import { expect, test } from 'bun:test';
import { decideSync } from '../src/lib/sync/values';

test('sync distinguishes remote edits, local edits, and simultaneous conflicts', () => {
  const baseline = { remote: { value: 2 }, agreed: { value: 2 }, conflict: false };
  expect(decideSync({ value: 2 }, { value: 3 }, baseline)).toBe('remote');
  expect(decideSync({ value: 4 }, { value: 2 }, baseline)).toBe('local');
  expect(decideSync({ value: 4 }, { value: 3 }, baseline)).toBe('conflict');
  expect(decideSync({ value: 4 }, { value: 4 }, baseline)).toBe('agree');
  expect(decideSync({ value: null }, { value: 3 })).toBe('remote');
  expect(decideSync({ value: 4 }, { value: 3 })).toBe('conflict');
});
test('a conflict remains pending even when another observation matches', () => {
  expect(
    decideSync(
      { value: true },
      { value: true },
      { remote: { value: false }, agreed: { value: false }, conflict: true }
    )
  ).toBe('conflict');
});
