import { expect, test } from 'bun:test';
import { POST } from '../src/routes/api/v1/[...path]/+server';

const user = {
  id: crypto.randomUUID(),
  username: 'body-test',
  email: null,
  role: 'user' as const,
  settings: {},
};

async function upNext(body: string, contentType = 'application/json') {
  const url = new URL('http://localhost/api/v1/up-next');
  return POST({
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }),
    url,
    params: { path: 'up-next' },
    locals: { user, expiresAt: null, setup: false },
  } as Parameters<typeof POST>[0]);
}

test('Up next uses the shared JSON content-type and size limits before writing', async () => {
  expect((await upNext('{}', 'text/plain')).status).toBe(415);
  expect((await upNext(JSON.stringify({ padding: 'x'.repeat(1_048_576) }))).status).toBe(413);
});

test('Up next rejects malformed and non-object JSON consistently', async () => {
  for (const body of ['{', 'null', '[]']) {
    const response = await upNext(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Supply a JSON object.',
      code: 'invalid_input',
    });
  }
});
