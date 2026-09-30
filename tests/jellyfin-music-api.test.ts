import { expect, test } from 'bun:test';
import { GET } from '../src/routes/api/v1/[...path]/+server';

const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function requestMusic(query: string, signedIn = true, suffix = '') {
  const path = `providers/${connectionId}/music${suffix}`;
  const url = new URL(`http://coast.test/api/v1/${path}${query}`);
  return GET({
    params: { path },
    url,
    request: new Request(url),
    locals: {
      user: signedIn
        ? {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            username: 'fixture',
            email: null,
            role: 'user',
            settings: {},
          }
        : null,
    },
  } as Parameters<typeof GET>[0]);
}

test('music browsing and details require a signed-in account', async () => {
  for (const suffix of ['', `/${'c'.repeat(32)}`])
    expect((await requestMusic('', false, suffix)).status).toBe(401);
});

test('music API rejects malformed browse filters before accessing an account', async () => {
  for (const query of [
    '?kind=movie',
    '?offset=-1',
    '?offset=abc',
    '?limit=101',
    '?kind=artist&artistId=' + 'c'.repeat(32),
    '?kind=album&albumId=' + 'c'.repeat(32),
    '?kind=track&albumId=arbitrary-item',
  ])
    expect((await requestMusic(query)).status).toBe(400);
});

test('music API rejects malformed single-item identities before accessing an account', async () => {
  expect((await requestMusic('', true, '/arbitrary-item')).status).toBe(400);
});
