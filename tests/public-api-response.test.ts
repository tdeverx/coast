import { expect, test } from 'bun:test';
import { publicPage } from '../src/lib/server/public-api/response';

test('public pagination never copies browser models or provider fields', () => {
  const internal = { page: 2, pages: 3, total: 140, items: [{ connectionId: 'private-source', progress: 120 }], assessments: [{ source: 'private-source' }], filters: { username: 'private-user' } };
  const safe = [{ id: 'public-work', title: 'Title' }];
  expect(publicPage(safe, internal, new URL('https://coast.test/api/public/v1/library?category=screen&page=2'))).toEqual({
    items: safe,
    pagination: { page: 2, pages: 3, total: 140, pageSize: 60, next: '/api/public/v1/library?category=screen&page=3', previous: '/api/public/v1/library?category=screen&page=1' },
  });
  expect(publicPage([], { page: 1, pages: 1, total: 0 }, new URL('https://coast.test/api/public/v1/library')).pagination).toMatchObject({ next: null, previous: null });
});
