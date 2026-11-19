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

import { eq, sql } from 'drizzle-orm';
import { ingestMetadata } from '../src/lib/catalogue/service.server';
import { effectiveReleaseDate, snapshotRank } from '../src/lib/catalogue/metadata/release-date.server';
import { mediaViewsForIds, screenWorkSummaries } from '../src/lib/server/queries/media';
import { metadataSnapshots, works } from '../src/lib/server/db/schema';

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
    await updateUserSettings(member, { fullWidth: false, liquidGlass: false });
    await updateUserSettings(member, { subtitleLanguages: ['fr', 'en'] });
    const [row] = await getSql()`SELECT settings FROM users WHERE id = ${member.id}`;
    expect(row.settings).toEqual({
      syncConflictWinner: 'coast',
      region: 'US',
      fullWidth: false,
      liquidGlass: false,
      subtitleLanguages: ['fr', 'en'],
      profile: { bio: 'Kept' },
    });
    await expect(
      updateUserSettings(member, { syncConflictWinner: crypto.randomUUID() })
    ).rejects.toThrow('connected accounts');
    await expect(updateUserSettings(member, { region: 'invalid' })).rejects.toThrow();
    await expect(updateUserSettings(member, { liquidGlass: 'off' })).rejects.toThrow();
    expect(
      (await getSql()`SELECT settings FROM users WHERE id = ${member.id}`)[0].settings
    ).toEqual(row.settings);
  });

  test('concurrent policy and logging patches preserve both updates and apply logging immediately', async () => {
    await Promise.all([
      updateConfig(admin, { experimentalMusic:true,experimentalGaming:true,experimentalParties:true, maxBitrateMbps: 42 }),
      updateConfig(admin, { diagnosticLevel: 'debug', diagnosticMaxSizeMiB: 64, diagnosticMaxAgeDays: 30 }),
    ]);
    expect(await getConfig()).toEqual({
      ...defaultConfig,
      experimentalMusic:true,experimentalGaming:true,experimentalParties:true,
      maxBitrateMbps: 42,
      diagnosticLevel: 'debug', diagnosticMaxSizeMiB: 64, diagnosticMaxAgeDays: 30,
    });
    expect(diagnosticStore.level).toBe('debug');
    expect(diagnosticStore.retention).toEqual({maxSizeMiB:64,maxAgeDays:30});
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
  test('metadata priorities are admin-only and agree across card, summary and SQL readers', async () => {
    const original = await getConfig();
    const sources = {
      details: ['trakt','tmdb','jellyfin'], artwork: ['tmdb','jellyfin','trakt'], release: ['jellyfin','tmdb','trakt'],
    } satisfies import('../src/lib/catalogue/metadata/resolve').MetadataSource;
    await expect(updateConfig(member,{metadataSource:sources})).rejects.toThrow('Administrator');
    await expect(updateConfig(admin,{metadataSource:{...sources,release:['tmdb','tmdb','trakt']}})).rejects.toThrow();
    const base = {kind:'movie' as const,provider:'tmdb' as const,externalId:'9871251',title:'Global title',
      releaseDate:'2000-07-01',genres:['Drama'],posterPath:'https://image.tmdb.org/t/p/w780/fixture.jpg',
      facts:{status:'Released',networks:[{id:'10',name:'Network'}]}};
    const item = await ingestMetadata(base,{complete:true});
    try {
      await ingestMetadata({...base,facts:{originalLanguage:'en'}});
      const [saved] = await getDb().select({raw:metadataSnapshots.raw}).from(metadataSnapshots)
        .where(eq(metadataSnapshots.mediaId,item.id));
      expect(saved.raw.facts).toMatchObject({status:'Released',networks:[{id:'10',name:'Network'}],originalLanguage:'en'});
      await ingestMetadata({kind:'movie',provider:'trakt',externalId:'55120',title:'Trakt title',
        genres:['Comedy'],releaseDate:'2000-08-01'},{mediaId:item.id});
      await ingestMetadata({kind:'movie',provider:'jellyfin',externalId:'local-test',title:'Local title',
        genres:['Local genre'],releaseDate:'2000-06-01'},{mediaId:item.id});
      await updateConfig(admin,{metadataSource:sources});
      const config = await getConfig();
      expect(config.metadataSource).toEqual(sources);
      const [card] = await mediaViewsForIds(admin.id,[item.id]);
      const [summary] = await screenWorkSummaries(admin.id,[item.id]);
      expect(card).toMatchObject({title:'Trakt title',releaseDate:'2000-06-01',genres:['Comedy'],poster:base.posterPath});
      expect(summary).toMatchObject({title:card.title,year:card.year});
      const [resolved] = await getDb().execute<{date:string;provider:string}>(sql`select
        ${effectiveReleaseDate(sql`${item.id}::uuid`,config.metadataSource)}::text as date,
        (select s.provider from metadata_snapshots s where s.media_id=${item.id} and s.genres is not null
          order by ${snapshotRank(config.metadataSource,'details',sql`s.provider`)},s.updated_at desc,s.id limit 1) as provider`);
      expect(resolved).toMatchObject({date:card.releaseDate,provider:'trakt'});
      await updateConfig(admin,{metadataSource:{...sources,details:'tmdb-only'}});
      expect((await mediaViewsForIds(admin.id,[item.id]))[0]).toMatchObject({
        title:base.title,genres:base.genres,releaseDate:'2000-06-01',poster:base.posterPath,
      });
      await updateConfig(admin,{metadataSource:sources});
      await ingestMetadata({kind:'movie',provider:'trakt',externalId:'55120',title:'Sparse update'},{mediaId:item.id,complete:true});
      expect((await mediaViewsForIds(admin.id,[item.id]))[0].genres).toEqual(['Comedy']);
      await ingestMetadata({kind:'movie',provider:'trakt',externalId:'55120',title:'Explicit empty genres',genres:[]},{mediaId:item.id});
      expect((await mediaViewsForIds(admin.id,[item.id]))[0].genres).toEqual([]);
    } finally {
      await updateConfig(admin,{metadataSource:original.metadataSource});
      await getDb().delete(works).where(eq(works.id,item.id));
    }
  });

  test('the selected action persists as a validated partial preference',async()=>{
    await updateUserSettings(member,{action:'listen'});
    expect((await getSql()`select settings from users where id=${member.id}`)[0].settings.action).toBe('listen');
    await expect(updateUserSettings(member,{action:'all'})).rejects.toThrow();
    expect((await getSql()`select settings from users where id=${member.id}`)[0].settings.profile).toEqual({bio:'Kept'});
  });

  test('odd reading page sanitization persists a false preference and rejects non-booleans', async () => {
    await updateUserSettings(member, { sanitizeOddReadingPages: false });
    expect((await getSql()`select settings from users where id=${member.id}`)[0].settings.sanitizeOddReadingPages).toBe(false);
    await expect(updateUserSettings(member, { sanitizeOddReadingPages: 'off' })).rejects.toThrow();
    await updateUserSettings(member, { sanitizeOddReadingPages: true });
    expect((await getSql()`select settings from users where id=${member.id}`)[0].settings.sanitizeOddReadingPages).toBe(true);
  });

  test('invalid and non-admin patches leave system policies untouched', async () => {
    const previous = await getConfig();
    await expect(updateConfig(member, { experimentalMusic:false,experimentalGaming:false,experimentalParties:false })).rejects.toThrow(
      'Administrator'
    );
    await expect(updateConfig(admin, { allowedProviderPorts: [0] })).rejects.toThrow();
    expect(await getConfig()).toEqual(previous);
  });

  test('public-profile-only access persists independently of registration and other policies', async () => {
    const previous = await getConfig();
    await updateConfig(admin, { siteAccess: 'public-profiles' });
    expect(await getConfig()).toEqual({ ...previous, siteAccess: 'public-profiles' });
    await expect(updateConfig(member, { siteAccess: 'public-read-only' })).rejects.toThrow('Administrator');
    expect((await getConfig()).siteAccess).toBe('public-profiles');
    await updateConfig(admin, { siteAccess: previous.siteAccess });
  });

  test('restoring preferences keeps the profile and resumes inheritance from current system defaults', async () => {
    await updateConfig(admin, {
      subtitleLanguages: ['de'],
      subtitleDefault: 'always',
    });
    const retained={profile:{bio:'Kept'},personalBitrateMbps:3,sharedBitrateMbps:6,allowPlaybackSharing:false,shareDemand:false,social:{audience:'private'}};
    await getSql()`update users set settings=settings||${retained}::jsonb where id=${member.id}`;
    await resetUserSettings(member);
    const [row] = await getSql()`SELECT settings FROM users WHERE id = ${member.id}`;
    expect(row.settings).toEqual(retained);
    expect(row.settings.liquidGlass ?? true).toBe(true);
    expect(row.settings.subtitleLanguages ?? (await getConfig()).subtitleLanguages).toEqual(['de']);
    expect((await getSql()`SELECT count(*)::int AS count FROM users`)[0].count).toBe(2);
  });
});
