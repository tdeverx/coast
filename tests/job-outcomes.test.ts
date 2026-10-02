import { expect, test } from 'bun:test';
import { jobOutcome, jobRemedy } from '../src/lib/ui/queue';
import { serviceTasks } from '../src/lib/providers/tasks';
const job = { id: '1', kind: 'catalogue.user-scan', state: 'succeeded', attempts: 1, lastError: null };
test('scan counts do not claim tracking changes', () => {
  expect(jobOutcome({ ...job, progress: { processed: 84 } })).toBe('84 items checked');
  expect(jobOutcome({ ...job, outcome: { added: 0 } })).toBe('Nothing new to add');
  expect(jobOutcome({ ...job, outcome: { added: 84 } })).toBe('Added 84 titles');
});
test('authentication calls for account repair', () => expect(jobRemedy({ ...job, lastError: 'Authentication failed. Reconnect this account in Connections before retrying.' })).toBe('connection'));
test('every provider card has one job kind', () => { for (const provider of ['trakt','jellyfin','seerr','tmdb']) for (const task of serviceTasks(provider)) expect(task.kinds.length).toBe(1); });
