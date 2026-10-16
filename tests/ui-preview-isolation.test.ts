import { expect, test } from 'bun:test';
import { createPreviewTransport, id } from '../src/routes/ui-preview/demo/fixtures';

test('preview transport refuses unknown commands and external paths without a network fallback', async () => {
  const transport = createPreviewTransport('FriendsPanel', 'friends');
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (() => { requests++; throw new Error('Live fetch reached'); }) as unknown as typeof fetch;
  try {
    for (const [path, method] of [['synced', 'POST'], ['synced/real-room/join', 'POST'], ['admin/benchmarks', 'POST'], ['settings', 'PATCH'], ['profile', 'DELETE']]) {
      const response = await transport(`/api/v1/${path}`, {method});
      expect(response.status).toBe(409);
    }
    expect((await transport('https://example.com/oauth', {method: 'GET'})).status).toBe(409);
    expect(requests).toBe(0);
  } finally { globalThis.fetch = original; }
});

test('preview state belongs to one specimen and synthetic links are never real credentials', async () => {
  const first = createPreviewTransport('NotificationInbox', 'all');
  const second = createPreviewTransport('NotificationInbox', 'all');
  const notices = async (transport: typeof first) => (await (await transport('/api/v1/notifications')).json()).items;
  const before = await notices(first);
  expect(before.some((notice: {kind: string}) => notice.kind === 'friend-request')).toBe(false);
  await first(`/api/v1/notifications/${before[0].id}`, {method: 'POST'});
  expect(await notices(first)).toHaveLength(before.length - 1);
  expect(await notices(second)).toHaveLength(before.length);
  const sharing = createPreviewTransport('sharing.action', 'normal');
  expect(await (await sharing('/api/v1/sharing', {method: 'POST'})).json()).toEqual({id, token: 'preview-only-not-a-real-link'});
  expect((await sharing(`/api/v1/sharing/${id}`, {method: 'DELETE'})).ok).toBe(true);
  expect((await sharing(`/api/v1/sharing/${id}`, {method: 'DELETE'})).status).toBe(409);
});

test('held preview reads abort on the existing request signal', async () => {
  const controller = new AbortController();
  const transport = createPreviewTransport('FriendsPanel', 'loading');
  const pending = transport('/api/v1/social/friends', {signal: controller.signal});
  controller.abort();
  await expect(pending).rejects.toMatchObject({name: 'AbortError'});
  await expect(transport('/api/v1/social/friends', {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
});

test('normal scan, binary-avatar and progress examples have usable fixture contracts', async () => {
  const transport = createPreviewTransport('ConnectionCard', 'connected');
  const scan = await (await transport(`/api/v1/providers/${id}/scan`)).json();
  expect(scan).toMatchObject({state: 'completed', processed: 40, total: 40, error: null});
  const avatar = await transport(`/api/v1/profile/avatars/${id}`);
  expect(avatar.headers.get('content-type')).toBe('image/png');
  expect((await avatar.arrayBuffer()).byteLength).toBeGreaterThan(0);
  expect(await (await transport('/api/v1/progress')).json()).toMatchObject({category: 'screen', page: 1, pages: 1});
});
