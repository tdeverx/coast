import { untrack } from 'svelte';
import type { ShelfControl, ShelfItem } from './types';

type LocalOptions<T> = {
  items: T[];
  mode: 'none' | 'type' | 'watched';
  layout: 'row' | 'grid';
  busy: boolean;
  availability: boolean;
  availableOnly: boolean;
  title: string;
  href?: string;
  url: URL;
};

const kinds = [
  { value: 'movie', label: 'Movies' },
  { value: 'show', label: 'Shows' },
  { value: 'season', label: 'Seasons' },
  { value: 'episode', label: 'Episodes' },
  { value: 'collection', label: 'Collections' },
  { value: 'album', label: 'Albums' },
  { value: 'track', label: 'Tracks' },
  { value: 'game', label: 'Games' },
];

/** Local selection for finite shelves; remote sources own their query filters. */
export function createShelfSelection<T extends ShelfItem>(get: () => LocalOptions<T>, setAvailable: (value: boolean) => void) {
  const initial = untrack(get);
  const fromUrl = initial.mode !== 'none' && initial.layout === 'grid';
  let settledItems = $state<T[]>(initial.items);
  let progress = $state(fromUrl ? initial.url.searchParams.get('rowProgress') ?? 'all' : 'all');
  let kind = $state(fromUrl ? initial.url.searchParams.get('rowKind') ?? 'all' : 'all');
  if (fromUrl && initial.url.searchParams.get('rowAvailable') === 'true') setAvailable(true);

  const sourceItems = $derived(get().busy ? settledItems : get().items);
  const options = $derived([
    { value: 'all', label: 'All' },
    ...kinds.filter(option => sourceItems.some(item => item.kind === option.value)),
  ]);
  const items = $derived(get().mode === 'none' ? get().items : sourceItems.filter(item =>
    (!get().availability || !get().availableOnly || item.available) &&
    (kind === 'all' || item.kind === kind) &&
    (get().mode !== 'watched' || progress === 'all' || item.watched === (progress === 'watched')),
  ));
  const href = $derived.by(() => {
    const config = get();
    if (!config.href || config.mode === 'none') return config.href;
    const url = new URL(config.href, config.url);
    url.searchParams.set(url.pathname === '/library' ? 'kind' : 'rowKind', kind);
    if (config.mode === 'watched') url.searchParams.set('rowProgress', progress);
    if (config.availability) {
      if (url.pathname === '/library') url.searchParams.set('scope', config.availableOnly ? 'available' : 'all');
      else url.searchParams.set('rowAvailable', String(config.availableOnly));
    }
    return url.pathname + url.search;
  });
  const filters = $derived.by((): ShelfControl[] => {
    const config = get();
    const result: ShelfControl[] = [];
    if (config.mode === 'watched') result.push({
      type: 'segments', label: `${config.title} progress`, value: progress,
      options: [{ value: 'all', label: 'All' }, { value: 'unwatched', label: 'Unwatched' }, { value: 'watched', label: 'Watched' }],
      change: value => { progress = value; },
    });
    if (config.availability) result.push({
      type: 'availability', label: `${config.title} availability`, value: config.availableOnly ? 'available' : 'all',
      change: value => setAvailable(value === 'available'),
    });
    return result;
  });
  const controls = $derived<ShelfControl[]>([{
    type: 'select', label: `${get().title} type`, value: kind, options,
    change: value => { kind = value; },
  }]);
  $effect(() => { if (!get().busy) settledItems = get().items; });
  $effect(() => { if (!options.some(option => option.value === kind)) kind = 'all'; });

  return {
    get items() { return items; },
    get sourceItems() { return sourceItems; },
    get href() { return href; },
    get filters() { return filters; },
    get controls() { return controls; },
    get filtered() { return progress !== 'all' || kind !== 'all' || get().availableOnly; },
    get resetKey() { return `${progress}:${kind}:${get().availableOnly}`; },
  };
}
