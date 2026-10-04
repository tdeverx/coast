import { expect, test } from 'bun:test';
import { IgdbAdapter, mapIgdbGame } from '../src/lib/providers/igdb/adapter.server';
import { ProviderHttpError } from '../src/lib/server/security/provider-fetch';
import { supportsProviderField } from '../src/lib/providers/capabilities';

const credentials = () => ({ clientId: crypto.randomUUID(), clientSecret: 'fixture-secret' });
const token = { access_token: 'fixture-token', expires_in: 3600, token_type: 'bearer' };
const fixture = {
  id: 1942, name: 'Fixture game', summary: 'A game', first_release_date: 1431993600,
  cover: { image_id: 'cover123' }, artworks: [{ image_id: 'art123' }],
  platforms: [{ name: 'PC' }, { name: 'PC' }], genres: [{ name: 'Role-playing (RPG)' }],
  involved_companies: [
    { company: { name: 'Developer' }, developer: true },
    { company: { name: 'Publisher' }, publisher: true },
  ],
};

test('IGDB maps expanded metadata and derives artwork only from validated image IDs', () => {
  const game = mapIgdbGame(fixture);
  expect(game.externalId).toBe('1942');
  expect(game.releaseDate).toBe('2015-05-19');
  expect(game.platforms).toEqual(['PC']);
  expect(game.developers).toEqual(['Developer']);
  expect(game.publishers).toEqual(['Publisher']);
  expect(game.posterPath).toBe('https://images.igdb.com/igdb/image/upload/t_cover_big/cover123.jpg');
  expect(mapIgdbGame({ id: 1, name: 'Undated' }).releaseDate).toBeNull();
  expect(() => mapIgdbGame({ ...fixture, cover: { image_id: '../malicious' } })).toThrow();
  expect(supportsProviderField('igdb', 'game', 'metadata', 'read')).toBe(true);
  expect(supportsProviderField('igdb', 'screen', 'metadata', 'read')).toBe(false);
  expect(supportsProviderField('igdb', 'game', 'history', 'write')).toBe(false);
});

test('app authentication keeps the secret in the POST body and reuses a token for concurrent searches', async () => {
  const creds = credentials();
  let authCalls = 0;
  const bodies: string[] = [];
  const adapter = new IgdbAdapter(creds, async (path, init) => {
    expect(path).toBe('/v4/games');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-token');
    expect(new Headers(init?.headers).get('client-id')).toBe(creds.clientId);
    bodies.push(String(init?.body));
    return [fixture];
  }, async (path, init) => {
    authCalls++;
    expect(path).toBe('/oauth2/token');
    expect(init?.method).toBe('POST');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_secret')).toBe(creds.clientSecret);
    return token;
  });
  const query = 'A "game"; limit 500; \\';
  const results = await Promise.all([adapter.search(query, 2), adapter.details('1942')]);
  expect(authCalls).toBe(1);
  expect(results[0].items[0].externalId).toBe('1942');
  expect(bodies[0]).toContain(`search ${JSON.stringify(query)};`);
  expect(bodies[0]).toContain('offset 60;');
});

test('401 renews an app token once and rate limits never become uncontrolled retries', async () => {
  let authCalls = 0, apiCalls = 0;
  const adapter = new IgdbAdapter(credentials(), async (_, init) => {
    apiCalls++;
    if (apiCalls === 1) throw new ProviderHttpError(401);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token2');
    return [fixture];
  }, async () => ({ ...token, access_token: `token${++authCalls}` }));
  expect((await adapter.details('1942')).title).toBe(fixture.name);
  expect(authCalls).toBe(2);
  expect(apiCalls).toBe(2);
  let rateCalls = 0;
  const limited = new IgdbAdapter(credentials(), async () => {
    rateCalls++; throw new ProviderHttpError(429);
  }, async () => token);
  await expect(limited.search('Game')).rejects.toMatchObject({ status: 429, code: 'igdb_rate_limited' });
  expect(rateCalls).toBe(1);
});

test('malformed upstream responses are 502 while invalid search and identity inputs never hit IGDB', async () => {
  let calls = 0;
  const adapter = new IgdbAdapter(credentials(), async () => { calls++; return [{ id: 1 }]; }, async () => token);
  await expect(adapter.details('1; limit 500')).rejects.toThrow();
  await expect(adapter.search('', 1)).rejects.toThrow();
  await expect(adapter.search('Game', 0)).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(adapter.search('Game')).rejects.toMatchObject({ status: 502, code: 'igdb_unavailable' });
  const absent = new IgdbAdapter(credentials(), async () => [], async () => token);
  await expect(absent.details('1942')).rejects.toMatchObject({ status: 404 });
});

test('invalid OAuth responses and repeated rejection do not reveal secrets or loop', async () => {
  const invalid = new IgdbAdapter(credentials(), async () => [fixture], async () => ({ error: 'fixture-secret' }));
  await expect(invalid.search('Game')).rejects.toMatchObject({ status: 502 });
  let calls = 0;
  const rejected = new IgdbAdapter(credentials(), async () => { calls++; throw new ProviderHttpError(401); }, async () => token);
  await expect(rejected.search('Game')).rejects.toMatchObject({ status: 502, code: 'igdb_rejected' });
  expect(calls).toBe(2);
});

test('discovery uses ranked IGDB visits, preserves rank and excludes future releases from recent queries',async()=>{
  const calls:{path:string;body:string}[]=[];
  const adapter=new IgdbAdapter(credentials(),async(path,init)=>{
    calls.push({path,body:String(init?.body)});
    if(path==='/v4/popularity_primitives')return [{game_id:2},{game_id:1},{game_id:2}];
    return [{id:1,name:'First'},{id:2,name:'Second'}];
  },async()=>token);
  expect((await adapter.discover('trending')).map(g=>g.externalId)).toEqual(['2','1']);
  expect(calls[0].body).toContain('popularity_type = 1');
  expect(calls[1].body).toContain('id = (2,1)');
  await adapter.discover('recent');
  expect(calls[2].body).toContain('first_release_date <=');
  expect(calls[2].body).toContain('sort first_release_date desc');
});

test('similar games preserve provider ordering, omit self and validate IDs before queries',async()=>{
 const requests:string[]=[];
 const adapter=new IgdbAdapter(credentials(),async(_path,init)=>{const body=String(init?.body);requests.push(body);return body.includes('fields similar_games')?[{similar_games:[1942,7,8,7]}]:[{id:8,name:'Eight'},{id:7,name:'Seven'}];},async()=>token);
 expect((await adapter.recommendations('1942')).map(game=>game.externalId)).toEqual(['7','8']);
 expect(requests[1]).toContain('id = (7,8)');
 await expect(adapter.recommendations('1; limit 500')).rejects.toThrow();expect(requests).toHaveLength(2);
});
