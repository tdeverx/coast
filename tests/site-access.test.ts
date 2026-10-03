import { expect, test } from 'bun:test';
import { isPublicReadPath } from '../src/lib/social/public.server';

const id = '12345678-1234-1234-1234-123456789012';
const profiles = ['/profile/fixture', '/api/v1/profile/activity', '/api/v1/profile/section', `/api/v1/profile/avatar/${id}/${'a'.repeat(64)}`, '/api/v1/artwork/tmdb/w342/fixture.jpg'];
const browsing = ['/', '/discover', '/search', `/media/${id}`, `/music/work/${id}`, `/games/${id}`];
const privatePaths = ['/for-you', '/library', '/settings', '/api/v1/profile', '/api/v1/profile/avatars', '/api/v1/collection', '/api/v1/social/feed', '/api/v1/playback', `/api/v1/providers/${id}/music/item/artwork`, '/profile/fixture/edit'];

test('private-site/public-profiles allows only profile reads and their safe artwork dependencies', () => {
  for (const path of profiles) expect(isPublicReadPath(path, 'public-profiles')).toBe(true);
  for (const path of [...browsing, ...privatePaths]) expect(isPublicReadPath(path, 'public-profiles')).toBe(false);
});
test('private mode stays closed and public browsing retains its existing scope', () => {
  for (const path of [...profiles, ...browsing, ...privatePaths]) expect(isPublicReadPath(path, 'private')).toBe(false);
  for (const path of [...profiles, ...browsing]) expect(isPublicReadPath(path, 'public-read-only')).toBe(true);
  for (const path of privatePaths) expect(isPublicReadPath(path, 'public-read-only')).toBe(false);
});
