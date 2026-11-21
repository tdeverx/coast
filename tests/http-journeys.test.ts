import { describe, test, expect } from 'bun:test';

// Run against a disposable Coast server/database only. Never points at a user's installation by default.
const base = process.env.COAST_HTTP_TEST_URL;
const credential = process.env.COAST_HTTP_TEST_TMDB_CREDENTIAL;
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
    const setupPayload = new URLSearchParams({username,password,displayName:'HTTP fixture',passwordConfirmation:password});
    const setup = await fetch(`${base}/setup?/account`, {
      method: 'POST',
      headers: {
        origin: base!,
        accept: 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: setupPayload,
      redirect: 'manual',
    });
    let response = setup;
    if (setup.status === 409)
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
    const landing = await fetch(`${base}/for-you`, {headers:{cookie},redirect:'manual'});
    if (setup.status === 303) {
      expect(landing.status).toBe(303);
      expect(landing.headers.get('location')).toBe('/setup');
    }
    if (landing.status === 303 && landing.headers.get('location') === '/setup') {
      const guarded = await request('media',{title:'Must not exist',kind:'movie'});
      expect(guarded.status).toBe(503);
      expect(await guarded.json()).toMatchObject({code:'tmdb_required'});
      if (credential) {
        const configured = await fetch(`${base}/setup?/tmdb`,{
          method:'POST',headers:{cookie,origin:base!,accept:'text/html','content-type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({tmdbCredential:credential}),redirect:'manual',
        });
        expect(configured.status).toBe(303);
        expect(configured.headers.get('location')).toBe('/for-you');
      }
    }
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
      `/profile/${username}?section=lists`,
      '/for-you?view=watch&section=requests',
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
    const lists = await fetch(`${base}/lists`, { headers: { cookie }, redirect: 'manual' });
    expect(lists.status).toBe(307);
    expect(lists.headers.get('location')).toBe(`/profile/${username}?section=lists`);
    const oldRequests = await fetch(`${base}/requests`, { headers: { cookie }, redirect: 'manual' });
    expect(oldRequests.status).toBe(404);
  });
});
