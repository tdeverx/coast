import { expect, test } from 'bun:test';
import { musicCard, musicCredits, musicDuration } from '../src/lib/music/presentation';
import type { MusicItem } from '../src/lib/music/model';

const album: MusicItem = {
  id: 'b'.repeat(32),
  kind: 'album',
  title: 'Compilation',
  artists: [{ id: 'a'.repeat(32), name: 'Guest' }],
  albumArtists: [{ id: 'c'.repeat(32), name: 'Various artists' }],
  artistNames: ['Guest'],
  genres: [],
  externalIds: {},
};

test('music cards retain connection-scoped routes and album artist credits', () => {
  const card = musicCard({ ...album, primaryImageTag: 'cover' }, 'connection');
  expect(card.kind).toBe('album');
  expect(card.captionSubtitle).toBe('Various artists');
  expect(card.href).toBe(`/music/connection/${album.id}`);
  expect(card.poster).toBe(`/api/v1/providers/connection/music/${album.id}/artwork`);
  expect(musicCard(album, 'other').href).not.toBe(card.href);
  expect(musicCard(album, 'connection').poster).toBeUndefined();
});

test('tracks use performer credits and unknown durations remain absent', () => {
  expect(musicCredits({ ...album, kind: 'track' })).toBe('Guest');
  expect(musicCredits({ ...album, artists: [], albumArtists: [] })).toBe('Guest');
  expect(musicDuration(undefined)).toBe('');
  expect(musicDuration(0)).toBe('0:00');
  expect(musicDuration(12.5)).toBe('0:12');
  expect(musicDuration(185)).toBe('3:05');
});
