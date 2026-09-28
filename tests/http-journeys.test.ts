import { describe, test, expect } from 'bun:test';

// Run against a disposable Coast server/database only. Never points at a user's installation by default.
const base = process.env.COAST_HTTP_TEST_URL;
const suite = base ? describe : describe.skip;
suite('Coast HTTP journeys', () => {
  let cookie = '';
  const username = 'coast-browser-test',
    password = 'Local-test-password-2026!';
  let mediaId = '';
  const request = async (path: string, body?: unknown, method = 'POST') =>
    fetch(`${base}/api/v1/${path}`, {
      method,
      headers: { origin: base!, 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
  test('first-run form creates a local session; CSRF and unauthenticated writes fail', async () => {
    const denied = await request('media', { title: 'Must not exist', kind: 'movie' });
    expect(denied.status).toBe(401);
    const payload = new URLSearchParams({ username, password });
    const setup = await fetch(`${base}/setup`, {
      method: 'POST',
      headers: {
        origin: base!,
        accept: 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: payload,
      redirect: 'manual',
    });
    let response = setup;
    if (!setup.headers.get('set-cookie'))
      response = await fetch(`${base}/login`, {
        method: 'POST',
        headers: {
          origin: base!,
          accept: 'text/html',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: payload,
        redirect: 'manual',
      });
    expect(response.status).toBe(303);
    cookie = response.headers.get('set-cookie')!.split(';')[0];
    expect(cookie).toContain('coast_session=');
    const csrf = await fetch(`${base}/api/v1/media`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: 'https://untrusted.invalid' },
      body: JSON.stringify({ title: 'Must not exist', kind: 'movie' }),
    });
    expect(csrf.status).toBe(403);
  });
  test('native movie tracking, half-star ratings and ordered lists persist through the HTTP boundary', async () => {
    const added = await request('media', {
      title: 'Coast browser test movie',
      kind: 'movie',
      year: 2026,
    });
    expect(added.status).toBe(200);
    mediaId = (await added.json()).id;
    expect((await request('tracking', { mediaId, action: 'favourite', value: true })).status).toBe(
      200
    );
    expect((await request('ratings', { mediaId, value: 4.5 })).status).toBe(200);
    expect((await request('tracking', { mediaId, action: 'watch' })).status).toBe(200);
    const detail = await (await request(`media/${mediaId}`, undefined, 'GET')).json();
    expect(detail.item.watched).toBe(true);
    expect(detail.item.playCount).toBe(1);
    expect(detail.item.rating).toBe(4.5);
    expect(detail.item.favourite).toBe(true);
    const list = await (await request('lists', { name: 'Browser journey list' })).json();
    expect(typeof list.id).toBe('string');
    expect((await request(`lists/${list.id}/items`, { mediaId })).status).toBe(200);
    const all = await (await request('lists', undefined, 'GET')).json();
    expect(all.lists.find((x: { id: string }) => x.id === list.id).items[0].id).toBe(mediaId);
    const badRating = await request('ratings', { mediaId, value: 4.2 });
    expect(badRating.status).toBe(400);
  });
  test('the core authenticated pages render', async () => {
    for (const path of [
      '/for-you',
      '/library',
      '/discover',
      '/search?q=Coast',
      '/lists',
      '/requests',
      '/settings',
      '/settings/connections',
      '/settings/admin',
      '/notifications',
      `/media/${mediaId}`,
    ]) {
      const response = await fetch(`${base}${path}`, { headers: { cookie }, redirect: 'manual' });
      expect(response.status, `${path} returns successfully`).toBe(200);
      expect(await response.text()).not.toContain('Internal Error');
    }
  });
});
