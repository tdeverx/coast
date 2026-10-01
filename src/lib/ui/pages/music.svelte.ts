import { invalidateAll } from '$app/navigation';
import { playMusic } from '$lib/playback/client.svelte';
import { api, message } from '$lib/ui/client';
import { musicCard, musicDuration, musicHero, musicHref } from '$lib/music/presentation';
import type { MusicItem, MusicPage } from '$lib/music/model';
import { overviewPanels } from '$lib/ui/insights/overview';
import type { PageCommand, PageSection } from './types';
export type MusicPageData = { item: MusicItem; connectionId: string; children: MusicPage; failure: string; page: number; pages: number };

/** Music supplies data and commands to the same hero/content/shelf page as other media. */
export function createMusicPage(get: () => MusicPageData, getUrl: () => URL) {
  let failure = $state('');
  let busy = $state(false);
  const item = $derived(get().item);
  const section = $derived(getUrl().searchParams.get('section'));
  const path = $derived(musicHref(get().connectionId, item.id));
  const artists = $derived(item.kind === 'album' ? item.albumArtists : item.artists);
  const facts = $derived([
    ...(item.kind === 'track' ? [{ label: 'Listens', value: String(item.playCount ?? 0) }, ...(item.positionSeconds ? [{ label: 'Progress', value: musicDuration(item.positionSeconds) }] : [])] : []),
    ...(item.releaseDate ? [{ label: 'Released', value: item.releaseDate }] : item.year ? [{ label: 'Year', value: String(item.year) }] : []),
    ...(item.durationSeconds !== undefined ? [{ label: 'Duration', value: musicDuration(item.durationSeconds) }] : []),
    ...(item.discNumber !== undefined ? [{ label: 'Disc', value: String(item.discNumber) }] : []),
    ...(item.trackNumber !== undefined ? [{ label: 'Track', value: String(item.trackNumber) }] : []),
    ...(item.genres.length ? [{ label: 'Genres', value: item.genres.join(', ') }] : []),
  ]);
  const overview = $derived(overviewPanels(item.overview, facts));
  async function act(task: () => Promise<unknown>) {
    if (busy) return;
    busy = true; failure = '';
    try { await task(); } catch (cause) { failure = message(cause); } finally { busy = false; }
  }
  const commands = $derived<PageCommand[]>([
    ...(item.workId ? [
      { label: 'Play', icon: 'play' as const, disabled: busy, run: () => act(() => playMusic(item.workId!, false)) },
      { label: 'Continue', variant: 'secondary' as const, disabled: busy, run: () => act(() => playMusic(item.workId!, true)) },
      { label: item.kind === 'album' ? 'Log album' : 'Log listen', icon: 'clock' as const, variant: 'ghost' as const, disabled: busy,
        run: () => act(async () => { await api(`music/${item.workId}/log`, { batchId: crypto.randomUUID() }); await invalidateAll(); }) },
    ] : []),
    { label: 'Music', variant: 'ghost', icon: 'left', href: `/music?connection=${get().connectionId}` },
  ]);
  const sections = $derived.by((): PageSection[] => {
    const data = get();
    const result: PageSection[] = [];
    if (overview.length && (!section || section === 'insights')) result.push({ key: 'insights', title: 'Overview', panels: overview, layout: section ? 'grid' : 'row' });
    const key = item.kind === 'artist' ? 'albums' : 'tracks';
    if (item.kind !== 'track' && (!section || section === key)) result.push({
      key, title: item.kind === 'artist' ? 'Albums' : 'Tracks', items: data.children.items.map(child => musicCard(child, data.connectionId)),
      shape: 'square', mediaKind: 'music', layout: section ? 'grid' : 'row', href: !section ? `${path}?section=${key}` : undefined,
      page: data.page, pages: data.pages, pageUrl: number => `${path}?section=${key}&page=${number}`,
      error: data.failure, retry: () => invalidateAll(),
      empty: { title: item.kind === 'artist' ? 'No albums available' : 'No tracks available', description: 'This Jellyfin account has no matching music here.' },
    });
    return result;
  });
  return { get page() { return {
    details: true, hero: !section, item: musicHero(item, get().connectionId), commands, sections, error: failure,
    back: section ? { href: path, label: item.title } : undefined,
    links: [...artists.map(artist => ({ href: musicHref(get().connectionId, artist.id), label: artist.name })),
      ...(item.albumId ? [{ href: musicHref(get().connectionId, item.albumId), label: item.album || 'Album' }] : [])],
  }; } };
}
