import { expect, test } from 'bun:test';
import { createSocialEnrichment, type SocialEnrichment } from '../src/lib/ui/social-enrichment';

const badge = { friends: [{ username: 'friend' }], total: 1 };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: (value: SocialEnrichment) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<SocialEnrichment>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('appended pages fetch each ID once including empty results and keep earlier badges visible', async () => {
  const batches: string[][] = [];
  let visible: SocialEnrichment = {};
  const enrichment = createSocialEnrichment(async ids => {
    batches.push(ids);
    return Object.fromEntries(ids.filter(id => Number(id) % 2).map(id => [id, badge]));
  }, value => { visible = value; });
  for (let page = 1; page <= 20; page++) {
    enrichment.update({ scope: 'viewer:filter:revision', active: true, ids: Array.from({ length: page * 60 }, (_, i) => String(i + 1)) });
    if (page > 1) expect(visible['1']).toEqual(badge);
    await settle();
  }
  expect(batches).toHaveLength(20);
  expect(batches.flat()).toHaveLength(1200);
  expect(new Set(batches.flat()).size).toBe(1200);
  enrichment.update({ scope: 'viewer:filter:revision', active: true, ids: ['1', '2'] });
  await settle();
  expect(batches).toHaveLength(20);
  expect(visible).toEqual({ '1': badge });
  enrichment.cancel();
});

test('large arrivals have at most two concurrent 60-ID batches', async () => {
  const requests: ReturnType<typeof deferred>[] = [];
  let active = 0, peak = 0;
  const enrichment = createSocialEnrichment((ids, signal) => {
    expect(ids.length).toBeLessThanOrEqual(60);
    expect(signal.aborted).toBe(false);
    active++; peak = Math.max(active, peak);
    const request = deferred(); requests.push(request);
    return request.promise.finally(() => { active--; });
  }, () => {});
  enrichment.update({ scope: 'one', active: true, ids: Array.from({ length: 300 }, (_, i) => String(i)) });
  expect(requests).toHaveLength(2);
  for (let index = 0; index < 5; index++) { requests[index].resolve({}); await settle(); }
  expect(requests).toHaveLength(5);
  expect(peak).toBe(2);
  enrichment.cancel();
});

test('failed batches remain retryable and a pending append does not cancel or duplicate older work', async () => {
  const requests: { ids: string[]; signal: AbortSignal; response: ReturnType<typeof deferred> }[] = [];
  let visible: SocialEnrichment = {};
  const enrichment = createSocialEnrichment((ids, signal) => {
    const response = deferred(); requests.push({ ids, signal, response }); return response.promise;
  }, value => { visible = value; });
  const update = (ids: string[]) => enrichment.update({ scope: 'one', active: true, ids });
  update(['old']); update(['old', 'new']);
  expect(requests.map(request => request.ids)).toEqual([['old'], ['new']]);
  expect(requests[0].signal.aborted).toBe(false);
  requests[0].response.resolve({ old: badge }); requests[1].response.reject(new Error('temporary failure'));
  await settle();
  expect(visible).toEqual({ old: badge });
  update(['old', 'new']);
  expect(requests[2].ids).toEqual(['new']);
  requests[2].response.resolve({}); await settle();
  update(['old', 'new']);
  expect(requests).toHaveLength(3);
  enrichment.cancel();
});

test('viewer, filter, revision, sign-out and disposal invalidate old delivery even when fetch ignores abort', async () => {
  const requests: { signal: AbortSignal; response: ReturnType<typeof deferred> }[] = [];
  let visible: SocialEnrichment = {};
  const enrichment = createSocialEnrichment((_ids, signal) => {
    const response = deferred(); requests.push({ signal, response }); return response.promise;
  }, value => { visible = value; });
  for (const scope of ['viewer1:filter1:revision1', 'viewer2:filter1:revision1', 'viewer2:filter2:revision1', 'viewer2:filter2:revision2']) {
    enrichment.update({ scope, ids: ['work'], active: true });
    expect(visible).toEqual({});
  }
  for (const request of requests.slice(0, -1)) {
    expect(request.signal.aborted).toBe(true);
    request.response.resolve({ work: badge });
  }
  await settle(); expect(visible).toEqual({});
  requests.at(-1)!.response.resolve({ work: badge }); await settle();
  expect(visible).toEqual({ work: badge });
  enrichment.update({ scope: 'signed-out', ids: ['work'], active: false });
  expect(visible).toEqual({});
  enrichment.update({ scope: 'next-viewer', ids: ['work'], active: true });
  const pending = requests.at(-1)!;
  enrichment.cancel();
  expect(pending.signal.aborted).toBe(true);
  pending.response.resolve({ work: badge }); await settle();
  expect(visible).toEqual({});
});

test('card replacement aborts old requests and discards results outside the new selection', async () => {
  const requests: { signal: AbortSignal; response: ReturnType<typeof deferred> }[] = [];
  let visible: SocialEnrichment = {};
  const enrichment = createSocialEnrichment((_ids, signal) => {
    const response = deferred(); requests.push({ signal, response }); return response.promise;
  }, value => { visible = value; });
  enrichment.update({ scope: 'one', ids: ['old'], active: true });
  enrichment.update({ scope: 'one', ids: ['new'], active: true });
  expect(requests[0].signal.aborted).toBe(true);
  requests[0].response.resolve({ old: badge, new: badge });
  requests[1].response.resolve({ new: badge, unexpected: badge });
  await settle(); expect(visible).toEqual({ new: badge });
  enrichment.cancel();
});
