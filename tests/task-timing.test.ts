import { expect, test } from 'bun:test';
import { providerSchedule } from '../src/lib/providers/schedule';
import { serviceTasks } from '../src/lib/providers/tasks';
import { eligibleTaskAccounts, taskDue, taskSchedulingEnabled, type TaskAccount } from '../src/lib/providers/task-timing';
import { jobTaskSections, jobOutcome, jobWaitingReason, jobPurposeLabel, type QueueAction } from '../src/lib/ui/queue';

const now = Date.parse('2026-10-07T10:00:00Z');
const task = (provider: string, kind: string) => serviceTasks(provider).find(entry => entry.kinds[0] === kind)!;
const account: TaskAccount = { id: 'account', externalUserId: 'external', role: 'user', settings: {} };
const features = { developerMode: false, enableTrakt: true, enableRequests: true, experimentalGaming: true };

test('task eligibility preserves account opt-ins and explicit shared source selection', () => {
  const accounts = [account, { ...account, id: 'admin', role: 'admin' }];
  const schedule = providerSchedule('jellyfin');
  expect(eligibleTaskAccounts('jellyfin.streams', accounts, schedule, {}, true).map(entry => entry.id)).toEqual(['admin']);
  expect(eligibleTaskAccounts('jellyfin.library', accounts, { ...schedule, libraryConnectionId: 'missing' }, {}, true)).toEqual([]);
  expect(eligibleTaskAccounts('jellyfin.library', accounts, schedule, { libraryScan: { connectionId: 'missing' } }, true)).toEqual([account]);
  expect(eligibleTaskAccounts('trakt.import', [{ ...account, settings: { sync: { lists: true } } }], schedule, {}, true)).toEqual([]);
  expect(eligibleTaskAccounts('trakt.lists-import', [{ ...account, settings: { sync: { lists: true } } }], schedule, {}, true)).toHaveLength(1);
  expect(eligibleTaskAccounts('catalogue.user-scan', accounts, schedule, {}, false)).toEqual([]);
  expect(eligibleTaskAccounts('steam.achievements', [{ ...account, settings: { importAchievements: false } }], schedule, {}, true)).toEqual([]);
});

test('due evidence uses account checkpoints, request verification and active live cadence', () => {
  const schedule = providerSchedule('jellyfin');
  const user = { ...account, userCompleted: new Date(now - 60000) };
  expect(taskDue(task('jellyfin', 'jellyfin.sync'), schedule, {}, user, { completed: new Date(0) }, now).at).toBe(now + 9 * 60000);
  expect(taskDue(task('jellyfin', 'jellyfin.live'), schedule, {}, { ...account, live: true }, { completed: new Date(now - 60000) }, now).at).toBe(now);
  expect(taskDue(task('jellyfin', 'jellyfin.live'), schedule, {}, account, { completed: new Date(now - 60000) }, now).at).toBe(now + 4 * 60000);
  expect(taskDue(task('seerr', 'seerr.sync'), providerSchedule('seerr'), {}, { ...account, settings: { requestsVerifiedAt: new Date(now).toISOString() } }, {}, now).at).toBe(now + 60000);
});

test('full and recent library due times share source-change and blocking rules', () => {
  const schedule = providerSchedule('jellyfin');
  const settings = { libraryScan: { connectionId: account.id, externalUserId: account.externalUserId, fullCompletedAt: new Date(now - 3600000).toISOString() } };
  const recent = taskDue(task('jellyfin', 'jellyfin.library'), schedule, settings, account, {}, now);
  expect(recent.full).toBe(false); expect(recent.at).toBe(now - 50 * 60000);
  expect(taskDue(task('jellyfin', 'jellyfin.library'), schedule, settings, { ...account, externalUserId: 'changed' }, {}, now)).toMatchObject({ at: now, full: true });
  expect(taskDue(task('jellyfin', 'jellyfin.library'), schedule, settings, account, { blocked: true }, now, true).at).toBeNull();
  expect(taskDue(task('jellyfin', 'jellyfin.bootstrap'), schedule, {}, account, {}, now).at).toBeNull();
});

test('manual due requests bypass automatic pauses but preserve feature and current-work gates', () => {
  const schedule = { ...providerSchedule('jellyfin'), enabled: false, userSyncEnabled: false };
  const sync = task('jellyfin', 'jellyfin.sync');
  expect(taskSchedulingEnabled('jellyfin', true, sync, schedule, features)).toBe(false);
  expect(taskSchedulingEnabled('jellyfin', true, sync, schedule, { ...features, developerMode: true }, true)).toBe(true);
  expect(taskSchedulingEnabled('steam', true, task('steam', 'steam.sync'), providerSchedule('steam'), { ...features, experimentalGaming: false }, true)).toBe(false);
  expect(taskDue(sync, schedule, {}, account, { blocked: true }, now, true).at).toBeNull();
});

const action = (patch: Partial<QueueAction>): QueueAction => ({ id: 'job', kind: 'jellyfin.sync', state: 'running', attempts: 1, lastError: null, ...patch });
test('existing Jobs text follows music/reconciliation stage counts and preserves unknown totals', () => {
  expect(jobOutcome(action({ progress: { processed: 2000, total: 2000, phase: 'music-tracks', stageProcessed: 10, stageTotal: 30 } }))).toBe('Importing listening history · 10 of 30');
  expect(jobOutcome(action({ state: 'pending', progress: { processed: 2000, total: 2000, phase: 'reconciling', stageProcessed: 3, stageTotal: null } }))).toBe('Importing progress and favourites · 3');
  expect(jobOutcome(action({ progress: { processed: 1, total: 4, phase: 'scanning' } }))).toBe('Checking library access · 1 of 4');
});
test('completion distinguishes personal bootstrap from full access and shared metadata', () => {
  expect(jobOutcome(action({ kind: 'jellyfin.bootstrap', state: 'succeeded', outcome: { checked: 8 } }))).toBe('Personal activity imported · 8 screen items checked · Full library access checked separately');
  expect(jobOutcome(action({ state: 'succeeded', outcome: { checked: 800 } }))).toBe('Full library access and personal activity checked · 800 screen items checked');
  expect(jobOutcome(action({ kind: 'jellyfin.library', state: 'succeeded', outcome: { checked: 800 } }))).toBe('Shared library metadata checked · 800 screen items checked');
});

test('existing queue status text uses durable waiting reasons and requested purpose', () => {
  expect(jobWaitingReason(action({ state: 'pending', waitingReason: 'provider-capacity', purpose: 'manual' }))).toBe('Waiting for the current service scan');
  expect(jobWaitingReason(action({ state: 'pending', waitingReason: 'yielded' }))).toBe('Import paused between pages · Waiting to continue');
  expect(jobWaitingReason(action({ state: 'running', waitingReason: 'worker-capacity' }))).toBeNull();
  expect(jobWaitingReason(action({ state: 'pending', serviceRetryAt: '2999-01-01T00:00:00Z' }))).toBe('Waiting for service cooldown');
  expect(jobPurposeLabel(action({ purpose: 'manual' }))).toBe('Requested now');
  expect(jobPurposeLabel(action({ purpose: 'bootstrap' }))).toBe('Account setup');
});


test('Queue orders upcoming tasks by next run and separates manual tasks without repeating active work',()=>{
  const job=(state:string):QueueAction=>({id:state,kind:'fixture',state,attempts:0,lastError:null});
  const entry=(id:string,nextAt:string|null,state?:string)=>({id,timing:{nextAt},jobs:state?[job(state)]:[]});
  const result=jobTaskSections([
    entry('later','2026-10-07T11:00:00Z','succeeded'),
    entry('manual',null,'cancelled'),
    entry('earlier','2026-10-07T10:00:00Z'),
    ...['running','pending','failed'].map(state=>entry(state,'2026-10-07T09:00:00Z',state)),
  ]);
  expect(result.upcoming.map(entry=>entry.id)).toEqual(['earlier','later']);
  expect(result.manual.map(entry=>entry.id)).toEqual(['manual']);
  expect(result.running.map(entry=>entry.id)).toEqual(['running']);
  expect(result.waiting.map(entry=>entry.id)).toEqual(['pending']);
  expect(result.attention.map(entry=>entry.id)).toEqual(['failed']);
  expect(jobTaskSections([{id:'unassessed',jobs:[]}]).manual.map(entry=>entry.id)).toEqual(['unassessed']);
});

test('one task represents multiple account jobs and moves sections as its accounts finish',()=>{
 const job=(id:string,state:string):QueueAction=>({id,kind:'jellyfin.sync',state,attempts:0,lastError:null});
 const task={id:'user-sync',timing:{nextAt:'2026-10-07T11:00:00Z'},jobs:[job('a','running'),job('b','pending'),job('c','failed')]};
 expect(jobTaskSections([task]).running).toHaveLength(1);
 expect(jobTaskSections([task]).waiting).toHaveLength(0);
 task.jobs[0].state='succeeded';
 expect(jobTaskSections([task]).waiting).toHaveLength(1);
 task.jobs[1].state='succeeded';
 expect(jobTaskSections([task]).attention).toHaveLength(1);
 task.jobs[2].state='succeeded';
 expect(jobTaskSections([task]).upcoming).toHaveLength(1);
});

test('task representatives use exact totals and terminal samples do not create active tasks',async()=>{
 const {taskJobCount,taskLastRun}=await import('../src/lib/ui/queue');
 const jobs=[action({id:'sample',state:'pending',taskCount:150}),action({id:'last',state:'succeeded',taskCount:0,updatedAt:'2026-10-07T10:00:00Z',outcome:{checked:84}})];
 expect(taskJobCount(jobs,'pending')).toBe(150);expect(taskLastRun(jobs)?.outcome?.checked).toBe(84);
 expect(jobTaskSections([{jobs,timing:{nextAt:null}}]).waiting).toHaveLength(1);
 expect(jobTaskSections([{jobs:[action({state:'failed',taskCount:0})],timing:{nextAt:null}}]).attention).toHaveLength(0);
});
