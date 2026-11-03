import { expect, test } from 'bun:test';
import { defaultBackupPolicy, dueBackupDay } from '../src/lib/backups/model';

test('a daily backup becomes due after local time across a daylight saving change', () => {
  const policy = { ...defaultBackupPolicy, timeZone: 'Europe/London' };
  expect(dueBackupDay(policy, new Date('2026-03-29T02:29:00Z'))).toBeNull();
  expect(dueBackupDay(policy, new Date('2026-03-29T02:30:00Z'))).toBe('2026-03-29');
  expect(dueBackupDay(policy, new Date('2026-11-03T03:29:00Z'))).toBeNull();
  expect(dueBackupDay(policy, new Date('2026-11-03T18:00:00Z'))).toBe('2026-11-03');
});
