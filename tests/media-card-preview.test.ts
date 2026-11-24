import { expect, test } from 'bun:test';
import { cardPreviewTransport, examplesFor, previewStates } from '../src/lib/ui/cards/editor/examples';
import { variants } from '../src/lib/ui/cards/editor/variants';

test('every state previews the selected card type', () => {
  for (const { kind } of variants) {
    for (const { id: state } of previewStates) {
      const examples = examplesFor(kind, { state });
      expect(examples.length).toBeGreaterThan(0);
      for (const { item } of examples) {
        expect(item.kind === kind || (kind === 'person' && item.kind === 'artist'), `${kind} · ${state}`).toBe(true);
      }
    }
  }
});

test('request previews have one example per outcome with matching availability', () => {
  for (const { kind } of variants) {
    expect(examplesFor(kind, { state: 'request' }).map(({ item }) => [item.captionStatus?.label, item.available])).toEqual([
      ['Pending', false], ['Available', true], ['Declined', false],
    ]);
  }
});

test('artist and collection examples belong to their card types', () => {
  expect(examplesFor('person').some(({ item }) => item.kind === 'artist')).toBe(true);
  expect(examplesFor('collection').map(({ previewLabel }) => previewLabel)).toEqual(['Box set', 'Playlist', 'Comic series']);
});

test('the catalogue episode uses its matching show and season metadata', () => {
  const [{ item: show }] = examplesFor('show');
  const [{ item: season }] = examplesFor('season');
  const [{ item: episode }] = examplesFor('episode');
  expect(episode).toMatchObject({
    title: 'Kassa', showTitle: show.title, showId: show.id, seasonId: season.id,
    seasonNumber: 1, episodeNumber: 1, runtimeMinutes: 42,
    artworkSources: { show: { primary: show.poster }, season: { primary: season.poster } },
  });
});

test('the card editor can preview the selected card menu without live commands', async () => {
  const [{ item }] = examplesFor('episode');
  const transport = cardPreviewTransport(() => item);
  const actions = await transport(`/api/v1/media/${item.id}/actions`);
  expect(await actions.json()).toMatchObject({ item: { id: item.id, title: 'Kassa' } });
  expect((await transport('/api/v1/tracking', { method: 'POST' })).status).toBe(409);
});

test('session variants use the right menus and preview items', () => {
  const live = examplesFor('movie', { state: 'session' });
  const streams = examplesFor('movie', { state: 'session', sessionMode: 'grouped' });
  const ended = examplesFor('movie', { state: 'session', sessionMode: 'ended' });
  const links = examplesFor('movie', { state: 'session', sessionMode: 'shared-link' });
  expect(live.every(({ item, menu }) => item.captionSubtitle === 'Playing' && !menu)).toBe(true);
  expect(streams.map(({ menu }) => menu)).toEqual(['stream', 'stream', 'stream']);
  expect(ended.every(({ item, menu, trailingDate }) => item.captionSubtitle === 'Ended' && !menu && trailingDate)).toBe(true);
  expect(links.map(({ previewLabel, menu }) => [previewLabel, menu])).toEqual([
    ['Website', 'shared-link'], ['VRChat', 'shared-link'],
  ]);
});

test('Journal layout is an Activity override that keeps grouped episode runs', () => {
  expect(previewStates.map(({ label }) => label)).not.toContain('Journal');
  const activity = examplesFor('episode', { state: 'activity' });
  const journal = examplesFor('episode', { state: 'activity', journalLayout: true });
  expect(journal.some(({ item }) => item.captionSubtitle?.startsWith('2 episodes'))).toBe(true);
  expect(journal.every(({ item }) => activity.some(entry => entry.item.id === item.id))).toBe(true);
});
