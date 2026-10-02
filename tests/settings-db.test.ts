import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { getDb, getSql, closeDb } from '../src/lib/server/db';
import {
  createFirstAdmin,
  createUser,
  updateUserSettings,
  resetUserSettings,
  type SessionUser,
} from '../src/lib/server/auth';
import { defaultConfig, getConfig } from '../src/lib/server/config';
import { updateConfig } from '../src/lib/application/configuration.server';
import { diagnosticStore } from '../src/lib/server/diagnostics';

const target = process.env.TEST_DATABASE_URL;
const enabled = !!target && new URL(target).pathname.startsWith('/coast_settings_test');
describe.skipIf(!enabled)('settings persistence', () => {
  let admin: SessionUser;
  let member: SessionUser;
  beforeAll(async () => {
    process.env.DATABASE_URL = target;
    await closeDb();
    await migrate(getDb(), { migrationsFolder: 'drizzle' });
    await getSql()`TRUNCATE TABLE users, system_settings RESTART IDENTITY CASCADE`;
    admin = (
      await createFirstAdmin({
        username: 'settings-admin',
        password: 'Settings-test-passphrase!',
      })
    ).user;
    member = await createUser(admin, {
      username: 'settings-member',
      password: 'Settings-member-passphrase!',
    });
  });
  afterAll(closeDb);

  test('saving a section preserves unrelated preferences, inherited defaults and profile data', async () => {
    await updateUserSettings(member, {
      syncConflictWinner: 'coast',
      region: 'US',
    });
    await getSql()`UPDATE users SET settings = settings || '{"profile":{"bio":"Kept"}}'::jsonb WHERE id = ${member.id}`;
    await updateUserSettings(member, { fullWidth: false });
    await updateUserSettings(member, { subtitleLanguages: ['fr', 'en'] });
    const [row] = await getSql()`SELECT settings FROM users WHERE id = ${member.id}`;
    expect(row.settings).toEqual({
      syncConflictWinner: 'coast',
      region: 'US',
      fullWidth: false,
      subtitleLanguages: ['fr', 'en'],
      profile: { bio: 'Kept' },
    });
    await expect(
      updateUserSettings(member, { syncConflictWinner: crypto.randomUUID() })
    ).rejects.toThrow('connected accounts');
    await expect(updateUserSettings(member, { region: 'invalid' })).rejects.toThrow();
    expect(
      (await getSql()`SELECT settings FROM users WHERE id = ${member.id}`)[0].settings
    ).toEqual(row.settings);
  });

  test('concurrent policy and logging patches preserve both updates and apply logging immediately', async () => {
    await Promise.all([
      updateConfig(admin, { experimentalFeatures: true, maxBitrateMbps: 42 }),
      updateConfig(admin, { diagnosticLevel: 'debug' }),
    ]);
    expect(await getConfig()).toEqual({
      ...defaultConfig,
      experimentalFeatures: true,
      maxBitrateMbps: 42,
      diagnosticLevel: 'debug',
    });
    expect(diagnosticStore.level).toBe('debug');
    const audit = await getSql()`SELECT previous_level, next_level FROM diagnostic_setting_audit`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      previous_level: 'info',
      next_level: 'debug',
    });
    await updateConfig(admin, { notificationLevel: 'silent' });
    expect(
      (await getSql()`SELECT count(*)::int AS count FROM diagnostic_setting_audit`)[0].count
    ).toBe(1);
  });

  test('invalid and non-admin patches leave system policies untouched', async () => {
    const previous = await getConfig();
    await expect(updateConfig(member, { experimentalFeatures: false })).rejects.toThrow(
      'Administrator'
    );
    await expect(updateConfig(admin, { allowedProviderPorts: [0] })).rejects.toThrow();
    expect(await getConfig()).toEqual(previous);
  });

  test('restoring preferences keeps the profile and resumes inheritance from current system defaults', async () => {
    await updateConfig(admin, {
      subtitleLanguages: ['de'],
      subtitleDefault: 'always',
    });
    await resetUserSettings(member);
    const [row] = await getSql()`SELECT settings FROM users WHERE id = ${member.id}`;
    expect(row.settings).toEqual({ profile: { bio: 'Kept' } });
    expect(row.settings.subtitleLanguages ?? (await getConfig()).subtitleLanguages).toEqual(['de']);
    expect((await getSql()`SELECT count(*)::int AS count FROM users`)[0].count).toBe(2);
  });
});
