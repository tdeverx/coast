import { beforeAll, afterAll, test, expect } from 'bun:test';
import { networkInterfaces } from 'node:os';
import { getSql } from '../src/lib/server/db';
import {
  createUser,
  login,
  updateUser,
  authenticateSession,
  listUsers,
  type SessionUser,
} from '../src/lib/server/auth';
import { loginJellyfin, jellyfinSignInServices } from '../src/lib/server/auth/jellyfin';
import { defaultConfig, getConfig, type CoastConfig } from '../src/lib/server/config';
import { updateConfig } from '../src/lib/application/configuration.server';
import { configureInstance } from '../src/lib/providers/instances.server';
import { listProviders } from '../src/lib/providers/instances.server';
import { updateJellyfinPlaybackImport } from '../src/lib/providers/jellyfin/connection.server';
import { getSeerr } from '../src/lib/providers/seerr/connection.server';
import { requestOptions, requestMedia } from '../src/lib/providers/seerr/requests.server';
import { ingestMetadata } from '../src/lib/catalogue/service';
import { connectJellyfin } from '../src/lib/providers/jellyfin/connection.server';
import { decryptCredential } from '../src/lib/server/security/credentials';
import { musicDetails, setMusicFavourite } from '../src/lib/music/service.server';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const prefix = `jellyfin-${crypto.randomUUID().slice(0, 8)}`;
let admin: SessionUser,
  instanceId: string,
  fixture: ReturnType<typeof Bun.serve>,
  previous: CoastConfig;
const ids: string[] = [];
let seerrMismatch = false;
let administrator = false,
  disabled = false,
  serverId = 'sign-in-fixture',
  policyId: string | undefined;
const favourites = new Set<string>();
const musicId = 'b'.repeat(32);
const signIn = (name: string, password = '') =>
  loginJellyfin({ instanceId, username: name, password }, crypto.randomUUID());
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  previous = await getConfig();
  const [row] =
    await getSql()`INSERT INTO users (username, password_hash, role) VALUES (${prefix}, ${await Bun.password.hash('Local-admin-password')}, 'admin') RETURNING *`;
  admin = { id: row.id, username: row.username, email: null, role: 'admin', settings: {} };
  ids.push(admin.id);
  const address = Object.values(networkInterfaces())
    .flat()
    .find(
      (i) =>
        i &&
        !i.internal &&
        i.family === 'IPv4' &&
        /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)
    )?.address;
  if (!address) throw Error('A private LAN address is required for the isolated provider fixture.');
  fixture = Bun.serve({
    hostname: address,
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/v1/')) {
        expect(request.headers.get('x-api-key')).toBe('synthetic-seerr-key');
        const userId = Number(request.headers.get('x-api-user'));
        if (url.pathname.startsWith('/api/v1/user/jellyfin/'))
          return Response.json({
            id: url.pathname.endsWith('seerr-denied') ? 43 : 42,
            username: 'Seerr viewer',
            permissions: 32,
          });
        if (url.pathname === '/api/v1/auth/me')
          return Response.json({
            id: seerrMismatch ? 999 : userId,
            username: 'Seerr viewer',
            permissions: userId === 43 ? 0 : 32,
          });
        if (url.pathname === '/api/v1/service/radarr')
          return Response.json([{ id: 1, name: 'Library', isDefault: true }]);
        if (url.pathname === '/api/v1/movie/700001')
          return Response.json({ id: 700001, mediaInfo: { status: 1, requests: [] } });
        if (url.pathname === '/api/v1/request' && request.method === 'POST') {
          expect(userId).toBe(42);
          const body = await request.json();
          expect(body.mediaId).toBe(700001);
          return Response.json({
            id: 71,
            status: 1,
            requestedBy: { id: userId },
            media: { id: 1, tmdbId: body.mediaId, status: 2 },
          });
        }
        return new Response(null, { status: 404 });
      }
      if (url.pathname === '/System/Info/Public')
        return Response.json({
          Id: serverId,
          ServerName: 'Test Jellyfin',
          ProductName: 'Jellyfin Server',
          Version: '10.11.0',
        });
      if (url.pathname === '/Users/AuthenticateByName') {
        const body = await request.json();
        if (!['', 'x'].includes(body.Pw)) return new Response(null, { status: 401 });
        return Response.json({
          AccessToken: `token-${body.Username}`,
          ServerId: serverId,
          User: { Id: body.Username, Name: body.Username },
        });
      }
      if (url.pathname.startsWith('/Users/') && !url.pathname.includes('/Items/')) {
        const id = url.pathname.split('/').at(-1)!;
        if (!request.headers.get('authorization')?.includes(`token-${id}`))
          return new Response(null, { status: 403 });
        return Response.json({
          Id: policyId ?? id,
          Name: id,
          Policy: { IsAdministrator: administrator, IsDisabled: disabled },
        });
      }
      if (url.pathname.includes('/Items/'))
        return Response.json({
          Id: musicId,
          Type: 'MusicAlbum',
          Name: 'Test album',
          UserData: { IsFavorite: favourites.has(url.pathname.split('/')[2]) },
        });
      if (url.pathname.startsWith('/UserFavoriteItems/')) {
        const userId = url.searchParams.get('userId')!;
        if (request.method === 'POST') favourites.add(userId);
        else favourites.delete(userId);
        return Response.json({ IsFavorite: favourites.has(userId) });
      }
      return new Response(null, { status: 404 });
    },
  });
  await updateConfig(admin, {
    ...defaultConfig,
    allowedProviderPorts: [...defaultConfig.allowedProviderPorts, fixture.port!],
  });
  const instance = await configureInstance(admin.id, {
    provider: 'jellyfin',
    name: prefix,
    baseUrl: `http://${address}:${fixture.port}`,
    allowPrivateNetwork: true,
  });
  instanceId = instance.id;
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  if (admin) await updateConfig(admin, previous);
  if (instanceId) {
    const linked =
      await getSql()`SELECT user_id FROM user_identities WHERE instance_id=${instanceId}`;
    ids.push(...linked.map((row: { user_id: string }) => row.user_id));
    await getSql()`DELETE FROM provider_instances WHERE id=${instanceId}`;
  }
  for (const id of new Set(ids)) await getSql()`DELETE FROM users WHERE id=${id}`;
  fixture?.stop(true);
});
run(
  'sign-in accepts Jellyfin passwords only through verified services and provisions a distinct identity',
  async () => {
    expect((await jellyfinSignInServices()).find((s) => s.id === instanceId)).toEqual({
      id: instanceId,
      name: prefix,
    });
    await expect(signIn('first')).rejects.toThrow('Ask an administrator');
    await updateConfig(admin, { jellyfinAutoCreateUsers: true });
    await expect(signIn('first', 'incorrect')).rejects.toThrow('incorrect');
    const result = await signIn('first', 'x');
    ids.push(result.user.id);
    expect(result.user.role).toBe('user');
    const [row] = await getSql()`SELECT password_hash FROM users WHERE id=${result.user.id}`;
    expect(row.password_hash).toBeNull();
    const jobs = await getSql()`SELECT kind FROM outbox_actions WHERE user_id = ${result.user.id}`;
    expect(jobs.map((job: { kind: string }) => job.kind)).toEqual(['jellyfin.sync']);
    await expect(
      login({ username: result.user.username, password: 'x' }, crypto.randomUUID())
    ).rejects.toThrow('incorrect');
    await expect(
      login(
        { username: result.user.username, password: 'coast-nonexistent-account-dummy' },
        crypto.randomUUID()
      )
    ).rejects.toThrow('incorrect');
    const [connection] =
      await getSql()`SELECT credentials FROM provider_connections WHERE user_id=${result.user.id} AND instance_id=${instanceId}`;
    expect(JSON.parse(await decryptCredential(connection.credentials))).toEqual({
      accessToken: 'token-first',
    });
    administrator = true;
    const repeat = await signIn('first');
    expect(repeat.user.id).toBe(result.user.id);
    expect(repeat.user.role).toBe('user'); // Administrator sync is still off.
    administrator = false;
    await getSql()`UPDATE provider_instances SET settings=settings || '{"approved":false}'::jsonb WHERE id=${instanceId}`;
    expect((await jellyfinSignInServices()).some((s) => s.id === instanceId)).toBe(false);
    await expect(signIn('first')).rejects.toThrow('verify');
    await getSql()`UPDATE provider_instances SET settings=settings || '{"approved":true}'::jsonb WHERE id=${instanceId}`;
    serverId = 'changed';
    await expect(signIn('first')).rejects.toThrow('identity');
    serverId = 'sign-in-fixture';
    policyId = 'another';
    await expect(signIn('first')).rejects.toThrow('identity');
    policyId = undefined;
  }
);
run(
  'existing links are reused without username takeover, including concurrent first sign-in',
  async () => {
    const local = await createUser(admin, {
      username: `${prefix}-linked`,
      password: 'Local-linked-password',
    });
    ids.push(local.id);
    await connectJellyfin(local.id, { instanceId, username: 'linked', password: '' });
    await updateConfig(admin, { jellyfinAutoCreateUsers: false });
    expect((await signIn('linked')).user.id).toBe(local.id);
    await updateConfig(admin, { jellyfinAutoCreateUsers: true });
    const occupied = await createUser(admin, {
      username: 'collision',
      password: 'Local-collision-password',
    });
    ids.push(occupied.id);
    const fresh = await signIn('collision');
    ids.push(fresh.user.id);
    expect(fresh.user.id).not.toBe(occupied.id);
    expect(fresh.user.username).not.toBe(occupied.username);
    const concurrent = await Promise.all([signIn('parallel'), signIn('parallel')]);
    ids.push(concurrent[0].user.id);
    expect(concurrent[0].user.id).toBe(concurrent[1].user.id);
    await connectJellyfin(local.id, { instanceId, username: 'rebound', password: '' });
    expect((await signIn('rebound')).user.id).toBe(local.id);
    await updateConfig(admin, { jellyfinAutoCreateUsers: false });
    await expect(signIn('linked')).rejects.toThrow('Ask an administrator');
    const shared1 = await createUser(admin, {
        username: `${prefix}-shared1`,
        password: 'Local-shared-password',
      }),
      shared2 = await createUser(admin, {
        username: `${prefix}-shared2`,
        password: 'Local-shared-password',
      });
    ids.push(shared1.id, shared2.id);
    for (const user of [shared1, shared2])
      await connectJellyfin(user.id, { instanceId, username: 'shared', password: '' });
    await expect(signIn('shared')).rejects.toThrow('multiple');
  }
);
run(
  'role sync promotes and demotes with session revocation, while disabled accounts cannot return',
  async () => {
    await updateConfig(admin, { jellyfinAutoCreateUsers: true, jellyfinSyncAdmins: true });
    administrator = true;
    const elevated = await signIn('elevated');
    ids.push(elevated.user.id);
    expect(elevated.user.role).toBe('admin');
    administrator = false;
    const demoted = await signIn('elevated');
    expect(demoted.user.role).toBe('user');
    expect(await authenticateSession(elevated.token)).toBeNull();
    await updateUser(admin, elevated.user.id, { disabled: true });
    expect(await authenticateSession(demoted.token)).toBeNull();
    await expect(signIn('elevated')).rejects.toThrow('Coast account is disabled');
    await updateUser(admin, elevated.user.id, { disabled: false });
    disabled = true;
    await expect(signIn('elevated')).rejects.toThrow('Jellyfin account is disabled');
    disabled = false;
    await connectJellyfin(admin.id, { instanceId, username: 'root-linked', password: '' });
    await expect(signIn('root-linked')).rejects.toThrow('active Coast administrator');
  }
);
run(
  'account editing enforces local password rules, active administrator guards and private responses',
  async () => {
    const user = await createUser(admin, {
      username: `prefix-${prefix}-edit`,
      password: 'Local-edit-password',
    });
    ids.push(user.id);
    const session = await login(
      { username: user.username, password: 'Local-edit-password' },
      crypto.randomUUID()
    );
    await expect(updateUser(user, user.id, { role: 'admin' })).rejects.toThrow(
      'Administrator access'
    );
    await expect(updateUser(admin, admin.id, { disabled: true })).rejects.toThrow(
      'Another administrator'
    );
    await expect(updateUser(admin, user.id, { password: 'x' })).rejects.toThrow();
    const updated = await updateUser(admin, user.id, {
      role: 'admin',
      email: 'user@example.test',
      password: 'New-local-password',
    });
    expect(updated.role).toBe('admin');
    expect(updated.email).toBe('user@example.test');
    expect(updated.hasLocalPassword).toBe(true);
    expect(updated).not.toHaveProperty('passwordHash');
    expect(await authenticateSession(session.token)).toBeNull();
    const fresh = await login(
      { username: user.username, password: 'New-local-password' },
      crypto.randomUUID()
    );
    expect(fresh.user.role).toBe('admin');
    await updateUser(admin, user.id, { role: 'user' });
    await expect(
      updateUser({ ...user, role: 'admin' }, admin.id, { disabled: true })
    ).rejects.toThrow('active administrator');
    expect((await listUsers(admin)).every((row) => !('passwordHash' in row))).toBe(true);
    const external = await signIn('local-password-added');
    ids.push(external.user.id);
    expect(
      (await updateUser(admin, external.user.id, { password: 'Separate-Coast-password' }))
        .hasLocalPassword
    ).toBe(true);
    expect(
      (
        await login(
          { username: external.user.username, password: 'Separate-Coast-password' },
          crypto.randomUUID()
        )
      ).user.id
    ).toBe(external.user.id);
  }
);
run('music favourites affect only the linked account and reject invalid identities', async () => {
  const account = await signIn('first');
  const [connection] =
    await getSql()`SELECT id FROM provider_connections WHERE user_id=${account.user.id} AND instance_id=${instanceId}`;
  await setMusicFavourite(account.user.id, connection.id, musicId, { favourite: true });
  expect((await musicDetails(account.user.id, connection.id, musicId)).item.favourite).toBe(true);
  await setMusicFavourite(account.user.id, connection.id, musicId, { favourite: false });
  expect((await musicDetails(account.user.id, connection.id, musicId)).item.favourite).toBe(false);
  await expect(
    setMusicFavourite(admin.id, connection.id, musicId, { favourite: true })
  ).rejects.toThrow('Connect your account');
  await expect(
    setMusicFavourite(account.user.id, connection.id, 'not-music', { favourite: true })
  ).rejects.toThrow();
});

run(
  'Jellyfin import defaults on and explicit opt-outs survive reconnect and Jellyfin sign-in',
  async () => {
    const account = await signIn('import-preference');
    ids.push(account.user.id);
    const provider = (await listProviders(account.user.id)).find((p) => p.id === instanceId)!;
    expect(provider.connection!.settings.importPlayback).toBe(true);
    await updateJellyfinPlaybackImport(account.user.id, provider.connection!.id, {
      enabled: false,
    });
    await connectJellyfin(account.user.id, {
      instanceId,
      username: 'import-preference',
      password: '',
    });
    await signIn('import-preference');
    expect(
      (await listProviders(account.user.id)).find((p) => p.id === instanceId)!.connection!.settings
        .importPlayback
    ).toBe(false);
  }
);
run(
  'Jellyfin-created Coast accounts request through their mapped Seerr identity and permissions',
  async () => {
    const account = await signIn('seerr-login');
    ids.push(account.user.id);
    const [password] =
      await getSql()`SELECT password_hash FROM users WHERE id = ${account.user.id}`;
    expect(password.password_hash).toBeNull();
    const [jellyfin] =
      await getSql()`SELECT base_url FROM provider_instances WHERE id = ${instanceId}`;
    const service = await configureInstance(admin.id, {
      provider: 'seerr',
      name: prefix + '-requests',
      baseUrl: jellyfin.base_url,
      apiKey: 'synthetic-seerr-key',
      allowPrivateNetwork: true,
      linkedMediaInstanceId: instanceId,
    });
    const title = await ingestMetadata({
      provider: 'tmdb',
      externalId: '700001',
      externalIds: { tmdb: '700001' },
      kind: 'movie',
      title: prefix + ' request',
    });
    try {
      const context = await getSeerr(account.user.id, service.id);
      expect(context.linkedJellyfinUserId).toBe('seerr-login');
      expect(context.account.id).toBe(42);
      const options = await requestOptions(account.user.id, title.id);
      expect(options).toHaveLength(1);
      expect(options[0].externalUserId).toBe(42);
      const request = await requestMedia(account.user.id, {
        mediaId: title.id,
        instanceId: service.id,
        is4k: false,
      });
      expect(request.userId).toBe(account.user.id);
      expect(request.instanceId).toBe(service.id);
      const [action] =
        await getSql()`SELECT connection_id FROM outbox_actions WHERE user_id = ${account.user.id} AND kind = 'seerr.request' AND payload->>'requestId' = ${request.id}`;
      expect(action.connection_id).toBe(context.connection.id);
      expect(
        (await context.adapter.create({ kind: 'movie', tmdbId: 700001, is4k: false, serverId: 1 }))
          .requestedBy?.id
      ).toBe(42);
      const denied = await signIn('seerr-denied');
      ids.push(denied.user.id);
      expect(await requestOptions(denied.user.id, title.id)).toEqual([]);
      await expect(
        requestMedia(denied.user.id, { mediaId: title.id, instanceId: service.id, is4k: false })
      ).rejects.toThrow('not available');
      seerrMismatch = true;
      await expect(getSeerr(account.user.id, service.id)).rejects.toThrow('identity');
    } finally {
      seerrMismatch = false;
      await getSql()`DELETE FROM media WHERE id = ${title.id}`;
      await getSql()`DELETE FROM provider_instances WHERE id = ${service.id}`;
    }
  }
);
