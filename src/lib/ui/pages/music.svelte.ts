import { page } from '$app/state';
import { playMusic } from '$lib/playback/client.svelte';
import { message } from '$lib/ui/client';
import { useClient } from '$lib/ui/client-context';
import { musicDuration, musicHero, musicHref } from '$lib/music/presentation';
import type { MusicItem, MusicPage } from '$lib/music/model';
import { overviewPanels } from '$lib/ui/insights/overview';
import type {PageCommand} from './types';
import type {DetailRow} from './detail';
import type {DetailRowsModel} from './detail-rows';
export type MusicPageData = { item: MusicItem; connectionId: string; children: MusicPage; failure: string; page: number; pages: number };

/** Music supplies data and commands to the same hero/content/shelf page as other media. */
export function createMusicPage(get: () => MusicPageData, getUrl: () => URL, canAct:()=>boolean=()=>true) {
  const { preview } = useClient();

  let failure = $state('');
  let busy = $state(false);
  const item = $derived(get().item);
  const section = $derived(getUrl().searchParams.get('section'));
  const path = $derived(musicHref(get().connectionId, item.id));
  const artists = $derived(item.kind === 'album' ? item.albumArtists : item.artists);
  const facts = $derived([
    ...(item.kind === 'track' ? [{ label: 'Listens', value: String(item.playCount ?? 0) }, ...(item.positionSeconds ? [{ label: 'Progress', value: musicDuration(item.positionSeconds) }] : [])] : []),
    ...(item.kind!=='artist' && item.releaseDate ? [{ label: 'Released', value: item.releaseDate }] : item.kind!=='artist' && item.year ? [{ label: 'Year', value: String(item.year) }] : []),
    ...(item.kind!=='artist' && item.durationSeconds !== undefined && item.durationSeconds>0 ? [{ label: 'Duration', value: musicDuration(item.durationSeconds) }] : []),
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
  const commands = $derived<PageCommand[]>(canAct() ? [
    ...(item.workId && item.kind!=='artist' && item.available!==false && page.data.capabilities?.playback!==false ? [
      { label: 'Play', size:'hero' as const, icon: 'play' as const, disabled: busy, run: () => act(() => preview ? Promise.resolve() : playMusic(item.workId!, false)) },
      ...(item.kind==='album'||item.positionSeconds ? [{ label: 'Continue', size:'hero' as const, disabled: busy, run: () => act(() => preview ? Promise.resolve() : playMusic(item.workId!, true)) }] : []),
    ] : []),
    { label: 'Music', emphasis: 'subtle', icon: 'left', href: `/music?connection=${get().connectionId}` },
  ] : []);
  const rows = $derived.by((): DetailRow[] => {
    const data = get();
    const result: DetailRow[] = [];
    const key = item.kind === 'artist' ? 'albums' : 'tracks';
    if (item.kind !== 'track' && (!section || section === key)) result.push({
      key,shelf:{title:item.kind==='artist'?'Albums':'Tracks',
      source:{type:'detail',title:item.kind==='artist'?'Albums':'Tracks',
        path:data.connectionId?`music/source/children?${new URLSearchParams({connectionId:data.connectionId,externalId:item.id})}`:`music/${item.workId??item.id}/children`,
        href:`${path}?section=${key}`,shape:'square',mediaKind:'music',layout:section?'grid':'row',page:data.page},
      }
    });
    return result;
  });
  const model=$derived<DetailRowsModel>({insights:{selection:'overview',tabs:[{value:'overview',label:'Overview',panels:overview}],href:`${path}?section=insights`}});
  return {get rows(){return rows;},get model(){return model;},get page() { return {
    hero: !section, item: musicHero(item, get().connectionId), commands, error: failure,
    back: section ? { href: path, label: item.title } : undefined,
    links: [...artists.flatMap(artist => artist.href || get().connectionId ? [{ href: artist.href ?? musicHref(get().connectionId, artist.id), label: artist.name }] : []),
      ...(item.albumId ? [{ href: musicHref(get().connectionId, item.albumId), label: item.album || 'Album' }] : [])],
  }; } };
}
