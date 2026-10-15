import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq, inArray } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDb, getDb } from '../src/lib/server/db';
import { users, games, gameExternalIds, providerInstances } from '../src/lib/server/db/schema';
import { getConfig, type CoastConfig } from '../src/lib/server/config';
import { updateConfig } from '../src/lib/application/configuration.server';
import { type SessionUser } from '../src/lib/server/auth';
import { decryptCredential } from '../src/lib/server/security/credentials';
import { gameDetails, createPlaythrough, logGameSession } from '../src/lib/core/games/service.server';
import { instanceFetchConfig } from '../src/lib/providers/instances.server';
import { GET, POST } from '../src/routes/api/v1/[...path]/+server';

const target = process.env.TEST_DATABASE_URL;
const suite = target ? describe : describe.skip;
suite('IGDB authenticated API and provider persistence', () => {
  const originalFetch = globalThis.fetch;
  const originalDb = process.env.DATABASE_URL, originalDir = process.env.COAST_DATA_DIR;
  const adminId = crypto.randomUUID(), memberId = crypto.randomUUID();
  const admin: SessionUser = { id: adminId, username: `igdb-${adminId}`, email: null, role: 'admin', settings: {} };
  const member: SessionUser = { ...admin, id: memberId, role: 'user', username: `igdb-${memberId}` };
  const clientId = crypto.randomUUID(), clientSecret = 'fixture-client-secret';
  let previousConfig: CoastConfig;
  let directory: string, instanceId: string, gameId: string;
  let apiCalls = 0, oauthCalls = 0, tokenDenied = false, outage = false, title = 'IGDB fixture';
  let expectedSecret = clientSecret;
  let upstreamStatus:number|null=null;
  const externalId = String(Math.floor(Math.random() * 1000000000) + 1000000000);
  const request = (path: string, actor: SessionUser | null, body?: unknown, query = '') => {
    const url = new URL(`http://coast.test/api/v1/${path}${query}`);
    const method = body === undefined ? 'GET' : 'POST';
    return (method === 'GET' ? GET : POST)({ url, params: { path },
      request: new Request(url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }),
      locals: { user: actor },
    } as Parameters<typeof GET>[0]);
  };
  beforeAll(async () => {
    await closeDb(); process.env.DATABASE_URL = target!;
    directory = await mkdtemp(join(tmpdir(), 'coast-igdb-'));
    process.env.COAST_DATA_DIR = directory;
    await migrate(getDb(), { migrationsFolder: `${import.meta.dir}/../drizzle` });
    await getDb().insert(users).values([admin, member].map((user) => ({ id: user.id, username: user.username, role: user.role, passwordHash: 'fixture' })));
    previousConfig = await getConfig();
    await updateConfig(admin, { ...previousConfig, experimentalMusic:true,experimentalGaming:true,experimentalParties:true });
    // Exercise the actual fixed-origin transport and parsers, but never send credentials to a service.
    globalThis.fetch = (async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const headers = new Headers(init?.headers);
      expect(init?.redirect).toBe('manual');
      if (headers.get('host') === 'id.twitch.tv' && url.pathname === '/oauth2/token') {
        oauthCalls++;
        expect(url.search).toBe('');
        expect(new URLSearchParams(String(init?.body)).get('client_secret')).toBe(expectedSecret);
        return Response.json(tokenDenied ? { error: 'invalid credentials' } : { access_token: 'fixture-token', expires_in: 3600, token_type: 'bearer' }, { status: tokenDenied ? 400 : 200 });
      }
      if (headers.get('host') === 'api.igdb.com' && url.pathname === '/v4/games') {
        apiCalls++;
        expect(headers.get('client-id')).toBe(clientId);
        expect(headers.get('authorization')).toBe('Bearer fixture-token');
        return Response.json(upstreamStatus?{error:'fixture-private-provider-error'}:outage ? { error: 'offline' } : [{ id: Number(externalId), name: title, summary: 'Imported overview', genres: [{ name: 'Adventure' }], platforms: [{ name: 'PC' }], cover: { image_id: 'fixturecover' } }], { status:upstreamStatus??(outage ? 503 : 200),headers:upstreamStatus===429?{'Retry-After':'999999'}:undefined });
      }
      throw new Error('Unexpected fixture request.');
    }) as typeof fetch;
  });
  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await updateConfig(admin, previousConfig);
    await getDb().delete(users).where(inArray(users.id, [adminId, memberId]));
    if (instanceId) await getDb().delete(providerInstances).where(eq(providerInstances.id, instanceId));
    if (gameId) await getDb().delete(games).where(eq(games.id, gameId));
    await closeDb();
    if (originalDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDb;
    if (originalDir === undefined) delete process.env.COAST_DATA_DIR; else process.env.COAST_DATA_DIR = originalDir;
    await rm(directory, { recursive: true, force: true });
  });
  test('only administrators configure IGDB; credentials are verified and encrypted, never returned', async () => {
    const input = { provider: 'igdb', name: 'Fixture IGDB', clientId, clientSecret };
    expect((await request('providers', null, input)).status).toBe(401);
    expect((await request('providers', member, input)).status).toBe(403);
    expect((await request('providers', admin, { provider: 'igdb', name: 'Missing secret', clientId })).status).toBe(400);
    tokenDenied = true;
    expect((await request('providers', admin, input)).status).toBe(502);
    expect((await getDb().select().from(providerInstances).where(eq(providerInstances.name, input.name))).length).toBe(0);
    tokenDenied = false;
    const response = await request('providers', admin, input);
    expect(response.status).toBe(200);
    const data = await response.json(); instanceId = data.id;
    expect(data.baseUrl).toBe('https://api.igdb.com');
    expect(JSON.stringify(data)).not.toContain(clientSecret);
    const [stored] = await getDb().select().from(providerInstances).where(eq(providerInstances.id, instanceId));
    expect(stored.credentials).toStartWith('v1.');
    expect(stored.credentials).not.toContain(clientSecret);
    expect(JSON.parse(await decryptCredential(stored.credentials!))).toEqual({ clientId, clientSecret });
    const listing = await request('providers', member);
    expect(await listing.text()).not.toContain(clientSecret);
    await expect(instanceFetchConfig({ ...stored, baseUrl: 'https://untrusted.example' })).rejects.toThrow('not allowed');
  });
  test('authenticated search and concurrent imports keep one game; refresh retains private history', async () => {
    const query = `?instanceId=${instanceId}&q=Fixture`;
    expect((await request('games/igdb/search', null, undefined, query)).status).toBe(401);
    const search = await request('games/igdb/search', member, undefined, query);
    expect(search.status).toBe(200);
    expect((await search.json()).items[0].externalId).toBe(externalId);
    const imports = await Promise.all([
      request('games/import', member, { instanceId, externalId }),
      request('games/import', member, { instanceId, externalId }),
    ]);
    expect(imports.map((response) => response.status)).toEqual([200, 200]);
    const entries = await Promise.all(imports.map((response) => response.json()));
    gameId = entries[0].id;
    expect(entries[1].id).toBe(gameId);
    const identities = await getDb().select().from(gameExternalIds).where(eq(gameExternalIds.gameId, gameId));
    expect(identities.length).toBe(1);
    const playthrough = await createPlaythrough(memberId, gameId, { platform: 'PC' });
    await logGameSession(memberId, playthrough.id, { id: crypto.randomUUID(), minutesPlayed: 45, playedAt: '2020-01-01T00:00:00.000Z' });
    title = 'Updated IGDB fixture';
    expect((await request('games/import', member, { instanceId, externalId })).status).toBe(200);
    const details = await gameDetails(memberId, gameId);
    expect(details.title).toBe(title);
    expect(details.posterPath).toContain('images.igdb.com');
    expect(details.playthroughs[0].minutesPlayed).toBe(45);
    expect((await gameDetails(adminId, gameId)).playthroughs).toEqual([]);
    expect(oauthCalls).toBe(3); // failed setup, successful verification, and one cached service token
  });
  test('credential rotation replaces the cached app token', async () => {
    const before = oauthCalls;
    expectedSecret = 'rotated-fixture-secret';
    const saved = await request('providers', admin, { id: instanceId, provider: 'igdb', name: 'Fixture IGDB', clientSecret: expectedSecret });
    expect(saved.status).toBe(200);
    expect((await request('games/igdb/search', member, undefined, `?instanceId=${instanceId}&q=Fixture`)).status).toBe(200);
    expect(oauthCalls).toBe(before + 2);
  });
  test('provider failure leaves catalog untouched and disabled instances cannot use cached tokens', async () => {
    outage = true;
    expect((await request('games/import', member, { instanceId, externalId })).status).toBe(502);
    expect((await gameDetails(memberId, gameId)).title).toBe(title);
    outage = false;
    const before = apiCalls;
    const query = `?instanceId=${instanceId}&q=Fixture`;
    expect((await request('games/igdb/bad-id', member, undefined, `?instanceId=${instanceId}`)).status).toBe(400);
    await getDb().update(providerInstances).set({ enabled: false }).where(eq(providerInstances.id, instanceId));
    expect((await request('games/igdb/search', member, undefined, query)).status).toBe(409);
    expect(apiCalls).toBe(before);
  });
  test('typed upstream auth and rate failures are mapped safely at the common API boundary',async()=>{
    await getDb().update(providerInstances).set({enabled:true}).where(eq(providerInstances.id,instanceId));
    const query=`?instanceId=${instanceId}&q=Fixture`;
    for(const status of [401,403]){
      upstreamStatus=status;
      const response=await request('games/igdb/search',member,undefined,query);
      expect(response.status).toBe(502);expect(await response.text()).not.toContain('fixture-private-provider-error');
    }
    upstreamStatus=429;
    const response=await request('games/igdb/search',member,undefined,query);
    expect(response.status).toBe(429);expect(response.headers.get('Retry-After')).toBe('86400');
    expect(await response.text()).not.toContain('fixture-private-provider-error');
    upstreamStatus=null;
  });
});
