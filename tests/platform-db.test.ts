import { context, diagnosticStore } from '../src/lib/server/diagnostics';
import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { getDb, getSql, closeDb } from '../src/lib/server/db';
import {
  createFirstAdmin,
  createUser,
  login,
  authenticateSession,
  hashToken,
  requireAdmin,
  type SessionUser,
} from '../src/lib/server/auth';
import {
  enqueueAction,
  claimNextAction,
  registerActionHandler,
  runQueueOnce,
  cancelAction,
  listActions,
  retryAction,
  PermanentActionError,
} from '../src/lib/server/queue';
import { notify, inbox, listDiagnostics } from '../src/lib/server/notifications';
import { defaultConfig, getConfig } from '../src/lib/server/config';
import { updateConfig } from '../src/lib/application/configuration.server';
const target = process.env.TEST_DATABASE_URL;
// This suite resets its named, isolated test database. It never uses DATABASE_URL implicitly.
const enabled = !!target && new URL(target).pathname.startsWith('/coast_platform_test');
describe.skipIf(!enabled)('PostgreSQL auth and durable action lifecycle', () => {
  let admin: SessionUser;
  let member: SessionUser;
  beforeAll(async () => {
    process.env.DATABASE_URL = target;
    await closeDb();
    await migrate(getDb(), { migrationsFolder: 'drizzle' });
    await getSql()`TRUNCATE TABLE users, system_settings RESTART IDENTITY CASCADE`;
  });
  afterAll(async () => {
    await closeDb();
  });
  test('concurrent first-run setup creates exactly one administrator', async () => {
    const results = await Promise.allSettled([
      createFirstAdmin({ username: 'administrator', password: 'A-secure-passphrase-123!' }),
      createFirstAdmin({ username: 'other-admin', password: 'Another-password-123!' }),
    ]);
    const success = results.filter((result) => result.status === 'fulfilled');
    expect(success.length).toBe(1);
    expect(results.filter((result) => result.status === 'rejected').length).toBe(1);
    admin = (success[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createFirstAdmin>>>)
      .value.user;
    expect(requireAdmin(admin).role).toBe('admin');
    const [count] = await getSql()`SELECT count(*)::int AS total FROM users`;
    expect(count.total).toBe(1);
    member = await createUser(admin, { username: 'member', password: 'Member-passphrase-123!' });
  });
  test('only an administrator can create accounts or read diagnostics', async () => {
    await expect(
      createUser(member, { username: 'intruder', password: 'Another-password-123!' })
    ).rejects.toThrow('Administrator');
    await expect(listDiagnostics(member)).rejects.toThrow('Administrator');
    await expect(
      login({ username: 'member', password: 'wrong-password' }, 'test-invalid')
    ).rejects.toThrow('incorrect');
    await expect(
      createUser(admin, { username: 'member', password: 'Another-password-123!' })
    ).rejects.toThrow('already in use');
    const additional = await createUser(admin, {
      username: 'additional-admin',
      password: 'Additional-admin-password!',
      role: 'admin',
    });
    expect(additional.role).toBe('admin');
  });
  test('only administrators can persist and change the experimental gate at runtime', async () => {
    expect((await getConfig()).experimentalGaming).toBe(false);
    await expect(
      updateConfig(member, { ...defaultConfig, experimentalMusic:true,experimentalGaming:true,experimentalParties:true })
    ).rejects.toThrow('Administrator');
    expect((await getConfig()).experimentalGaming).toBe(false);
    await updateConfig(admin, { ...defaultConfig, experimentalMusic:true,experimentalGaming:true,experimentalParties:true });
    expect((await getConfig()).experimentalGaming).toBe(true);
    await updateConfig(admin, defaultConfig);
    expect((await getConfig()).experimentalGaming).toBe(false);
  });
  test('diagnostic settings apply immediately and audit changes even when disabled', async () => {
    expect((await getConfig()).diagnosticLevel).toBe('info');
    await expect(
      updateConfig(member, { ...defaultConfig, diagnosticLevel: 'trace' })
    ).rejects.toThrow('Administrator');
    for (const diagnosticLevel of ['trace', 'off', 'info'] as const) {
      await updateConfig(admin, { ...defaultConfig, diagnosticLevel });
      expect(diagnosticStore.level).toBe(diagnosticLevel);
      expect((await getConfig()).diagnosticLevel).toBe(diagnosticLevel);
    }
    const records: { actor_id: string; previous_level: string; next_level: string }[] =
      await getSql()`SELECT actor_id, previous_level, next_level FROM diagnostic_setting_audit ORDER BY created_at, id`;
    expect(
      records.map((row: { previous_level: string; next_level: string }) => [
        row.previous_level,
        row.next_level,
      ])
    ).toEqual([
      ['info', 'trace'],
      ['trace', 'off'],
      ['off', 'info'],
    ]);
    expect(records.every((row: { actor_id: string }) => row.actor_id === admin.id)).toBe(true);
  });
  test('sessions rotate with a brief concurrent-request grace period and expire server-side', async () => {
    const session = await login(
      { username: 'member', password: 'Member-passphrase-123!' },
      'test-session'
    );
    const storedHash = await hashToken(session.token);
    const [stored] =
      await getSql()`SELECT token_hash FROM sessions WHERE token_hash = ${storedHash}`;
    expect(stored.token_hash).not.toBe(session.token);
    await getSql()`UPDATE sessions SET last_seen_at = NOW() - INTERVAL '2 hours' WHERE token_hash = ${storedHash}`;
    const rotated = await authenticateSession(session.token);
    expect(rotated?.token).toBeDefined();
    expect((await authenticateSession(session.token))?.user.id).toBe(member.id);
    const newHash = await hashToken(rotated!.token!);
    await getSql()`UPDATE sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = ${newHash}`;
    expect(await authenticateSession(rotated!.token)).toBeNull();
  });
  test('parallel claims preserve order within a lane while permitting another user', async () => {
    const requestId = crypto.randomUUID();
    const first = await context.run(requestId, () =>
      enqueueAction({
        userId: member.id,
        kind: 'test.order',
        payload: { order: 1 },
      })
    );
    const second = await enqueueAction({
      userId: member.id,
      kind: 'test.order',
      payload: { order: 2 },
    });
    const other = await enqueueAction({
      userId: admin.id,
      kind: 'test.order',
      payload: { order: 1 },
    });
    const claims = await Promise.all([claimNextAction(), claimNextAction(), claimNextAction()]);
    expect(
      claims
        .filter(Boolean)
        .map((value) => value!.id)
        .sort()
    ).toEqual([first, other].sort());
    expect(claims.find((value) => value?.id === first)?.correlationId).toBe(requestId);
    expect(claims.find((value) => value?.id === first)?.payload).toEqual({ order: 1, _manual: true });
    const [pending] = await getSql()`SELECT state FROM outbox_actions WHERE id = ${second}`;
    expect(pending.state).toBe('pending');
    await getSql()`UPDATE outbox_actions SET state = 'succeeded' WHERE id IN (${first}, ${other})`;
    expect((await claimNextAction())?.id).toBe(second);
    await getSql()`UPDATE outbox_actions SET state = 'succeeded' WHERE id = ${second}`;
  });
  test('pending compaction moves latest intent to the lane tail and does not replace a running action', async () => {
    const old = await enqueueAction({
      userId: member.id,
      kind: 'test.edit',
      payload: { rating: 1 },
      compactionKey: 'rating:movie',
    });
    const middle = await enqueueAction({ userId: member.id, kind: 'test.other', payload: {} });
    const latest = await enqueueAction({
      userId: member.id,
      kind: 'test.edit',
      payload: { rating: 5 },
      compactionKey: 'rating:movie',
    });
    const [superseded] = await getSql()`SELECT state FROM outbox_actions WHERE id = ${old}`;
    expect(superseded.state).toBe('cancelled');
    expect((await claimNextAction())?.id).toBe(middle);
    await getSql()`UPDATE outbox_actions SET state = 'succeeded' WHERE id = ${middle}`;
    expect((await claimNextAction())?.id).toBe(latest);
    const next = await enqueueAction({
      userId: member.id,
      kind: 'test.edit',
      payload: { rating: 3 },
      compactionKey: 'rating:movie',
    });
    expect(await claimNextAction()).toBeNull();
    await getSql()`UPDATE outbox_actions SET state = 'succeeded' WHERE id = ${latest}`;
    await cancelAction(admin, next);
  });
  test('only administrators can inspect, retry or cancel background work', async () => {
    const id = await enqueueAction({ userId: member.id, kind: 'test.edit', payload: {} });
    await expect(listActions(member)).rejects.toThrow('Administrator');
    await expect(retryAction(member, id)).rejects.toThrow('Administrator');
    await expect(cancelAction(member, id)).rejects.toThrow('Administrator');
    expect((await listActions(admin)).some((action) => action.id === id)).toBe(true);
    await cancelAction(admin, id);
  });
  test('outages back off, permanent failures block ordered successors, and a retry resolves the notice', async () => {
    registerActionHandler('test.fail', async () => {
      throw new Error('service temporarily unavailable');
    });
    const first = await enqueueAction({ userId: member.id, kind: 'test.fail', payload: {} });
    await runQueueOnce();
    const [pending] =
      await getSql()`SELECT state, attempts, next_attempt_at FROM outbox_actions WHERE id = ${first}`;
    expect(pending.state).toBe('pending');
    expect(pending.attempts).toBe(1);
    expect(new Date(pending.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    registerActionHandler('test.fail', async () => {
      throw new PermanentActionError('permission denied');
    });
    await retryAction(admin, first);
    await runQueueOnce();
    const second = await enqueueAction({ userId: member.id, kind: 'test.after', payload: {} });
    expect(await claimNextAction()).toBeNull();
    expect((await inbox(member)).some((notice: any) => notice.kind === 'external-action')).toBe(
      true
    );
    await expect(
      cancelAction(admin.role === 'admin' ? { ...admin, role: 'user' } : admin, first)
    ).rejects.toThrow();
    registerActionHandler('test.fail', async () => {});
    await retryAction(admin, first);
    await runQueueOnce();
    expect((await inbox(member)).some((notice: any) => notice.kind === 'external-action')).toBe(
      false
    );
    await cancelAction(admin, second);
  });
  test('administrative notification policy cannot be bypassed by user silencing', async () => {
    await getSql()`UPDATE users SET settings = '{"notificationsSilenced":true}'::jsonb WHERE id = ${member.id}`;
    await notify({ userId: member.id, kind: 'test', title: 'Ordinary', sourceKey: 'ordinary' });
    await notify({
      userId: member.id,
      kind: 'test',
      title: 'Important',
      locked: true,
      level: 'persistent',
      sourceKey: 'locked',
    });
    await updateConfig(admin, { ...defaultConfig, allowNotificationSilencing: false });
    await notify({ userId: member.id, kind: 'test', title: 'Policy', sourceKey: 'policy' });
    const notifications = await inbox(member);
    expect(notifications.find((notice: any) => notice.title === 'Ordinary')?.level).toBe('silent');
    expect(notifications.find((notice: any) => notice.title === 'Important')?.level).toBe(
      'persistent'
    );
    expect(notifications.find((notice: any) => notice.title === 'Policy')?.level).toBe('normal');
  });
  test('a crashed worker lease is retried before later actions in its lane', async () => {
    const first = await enqueueAction({ userId: member.id, kind: 'test.crashed', payload: {} });
    const second = await enqueueAction({ userId: member.id, kind: 'test.following', payload: {} });
    expect((await claimNextAction())?.id).toBe(first);
    await getSql()`UPDATE outbox_actions SET locked_at = NOW() - INTERVAL '6 minutes' WHERE id = ${first}`;
    const recovered = await claimNextAction();
    expect(recovered?.id).toBe(first);
    expect(recovered?.attempts).toBe(2);
    expect(await claimNextAction()).toBeNull();
    await getSql()`UPDATE outbox_actions SET state = 'succeeded' WHERE id = ${first}`;
    await cancelAction(admin, second);
  });
});
