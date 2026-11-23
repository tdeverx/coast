import {useShelfLocation} from '#lib/ui/detail-section.svelte.js';
import {profileRowPath} from '#lib/profile/url.js';

import { onDestroy, untrack } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { MediaView, MediaCardPresentation } from '#lib/ui/types.js';
import { message } from '#lib/ui/client.js';
import { useClient } from '#lib/ui/client-context.js';
import { contentRevisionKey } from '#lib/ui/content-revision.svelte.js';
  import { createResource,uniqueItems } from '#lib/ui/resource.svelte.js';
type Content = {
    selected?: { playlist: boolean;name?:string } | null;
    items: (MediaView|MediaCardPresentation)[];
  page: number;
  pages: number;
  total: number;
    kind: 'all' | 'movie' | 'show' | 'album' | 'track' | 'game' | 'book' | 'comic';
  filter: string;
    scope?: 'all' | 'available';
 };
import type { ShelfSource, ShelfControl, ShelfAction } from './types';

export type ListSourceOptions = {
  view: string;
  title: string;
  custom?: boolean;
    filters?:{kind:string;scope:string};
  layout?: 'row' | 'grid';
  profile?: string;
  page?: number;
  initial?: Content;
  onitems?: (items: MediaView[], selection: string) => void;
    ondelete?: () => void;
 };
export function createListSource(getOptions: () => ListSourceOptions): ShelfSource {
 const location=useShelfLocation();
  const { api, change, preview } = useClient();

  let {
    view,
    title,
    custom = false,
    layout = 'row',
    profile,
    initial,
    onitems,
    ondelete,
  } = $derived(getOptions());

  const resource = createResource<Content>(
    untrack(() => initial ?? { items: [], page: 1, pages: 1, total: 0, kind: 'all', filter: 'all' }), !!untrack(() => initial)
  );
  $effect(() => {
    if (initial) {
      resource.replace(initial);
      scope = initial.scope ?? 'all';
      kind = initial.kind;
    }
  });
  const content = $derived(resource.data);
  const busy = $derived(resource.busy);
  const error = $derived(resource.error);
  const ready = $derived(resource.ready);
  let scope = $state(untrack(() => getOptions().filters?.scope??content.scope??'all'));
  let kind = $state(untrack(() => (getOptions().filters?.kind??content.kind) as Content['kind']));
  const filter = 'all';
  let arranging = $state(false);
  const selection = $derived(`${view}:${content.kind}:${content.filter}`);
  const href = (number = 1) => profile
    ? profileRowPath(profile, 'list', new URLSearchParams({ list: view, kind, scope, page: String(number) }))
    : `/lists?${new URLSearchParams({ view, kind, filter, scope, page: String(number) })}`;
  $effect(() => {
    if (ready) onitems?.(content.items.filter((item):item is MediaView=>!('href' in item)), selection);
  });
  async function load(number = getOptions().page ?? 1,append=false) {
    const path = `lists/content?${new URLSearchParams({ view, kind, filter, scope, page: String(number) })}`;

    const result = await resource.load((signal) => api<Content>(path, undefined, 'GET', { signal }), {
      merge: (old, next) => ({
        ...next,
        items: append
          ? uniqueItems([...old.items, ...next.items], (item) => item.entryId ?? item.id)
          : next.items
      })
    });

    if (result && !location.embedded && !preview && layout === 'grid') goto(href(result.page), { shallow: true, replace: true, reset: false, state: page.state });
  }
  const refreshKey = $derived(contentRevisionKey(page.data, ['tracking', 'social']));
  let previousRefresh = untrack(() => refreshKey);
  $effect(() => {
    const next = refreshKey;
    if (next === previousRefresh) return;
    previousRefresh = next;
    untrack(() => {
      if (!preview && !initial && resource.activated) void load(content.page);
    });
  });
  async function edit(id: string, direction?: number) {
    try {
      if (direction) await change(`lists/${view}/move`, { entryId: id, direction });
      else await change(`lists/${view}/items`, { entryId: id }, 'DELETE');
      if (initial || preview) await load(content.page);
    } catch (cause) {
      resource.error = message(cause);
    }
  }
  onDestroy(resource.dispose);


  return {
    get pagination() {
      return {
        kind: 'pages' as const,
        page: content.page,
        pages: content.pages,
        append: false,
        controls: layout === 'grid' ? 'both' as const : 'none' as const,
        url: href
      };
    },

    get title() {
      return content.selected?.name ?? title;
    },

    get items() {
      return content.items;
    },

    get mixed() {
      return true;
    },

    get busy() {
      return busy;
    },

    get ready() {
      return ready;
    },

    get error() {
      return error;
    },

    get activated() {
      return resource.activated;
    },

    get href() {
      return layout === 'row' ? href() : undefined;
    },

    get filters(): ShelfControl[] {
      return [
        {
          type: 'availability',
          label: 'Available only',
          value: scope,
          change: (value) => {
            scope = value as typeof scope;
            void load(1);
          }
        }
      ];
    },

    get filterReset() { return { disabled: scope === 'all' && kind === 'all',
      run: () => { scope = 'all'; kind = 'all'; return load(1); } }; },

    get controls(): ShelfControl[] {
      return [
        {
          type: 'media-type',
          mediums: page.data,
          label: `${title} media type`,
          value: kind,
          change: (value) => {
            kind = value as Content['kind'];
            void load(1);
          }
        }
      ];
    },

    get sequence() {
      return content.selected?.playlist ? { kind: 'playlist' as const, id: view } : undefined;
    },

    get actions(): ShelfAction[] {
      return custom && layout === 'grid'
        ? [
          {
            label: arranging ? 'Done' : 'Arrange',
            run: () => {
              arranging = !arranging;
            }
          },
          ...(ondelete ? [{ label: 'Delete list', run: ondelete }] : profile
            ? [{ label: 'Manage list', run: () => goto(`/lists?${new URLSearchParams({ view })}`) }]
            : [])
        ]
        : [];
    },

    details(item) {
      return custom && arranging
        ? {
          actions: [
            {
              label: `Move ${item.title} earlier`,
              icon: 'left',
              disabled: busy || content.page === 1 && content.items[0]?.entryId === item.entryId,
              run: () => edit(item.entryId!, -1)
            },

            {
              label: `Move ${item.title} later`,
              icon: 'right',
              disabled: busy || content.page === content.pages && content.items.at(-1)?.entryId === item.entryId,
              run: () => edit(item.entryId!, 1)
            },

            {
              label: `Remove ${item.title} from list`,
              icon: 'close',
              disabled: busy,
              run: () => edit(item.entryId!)
            }
          ]
        }
        : undefined;
    },

    get empty() {
      if (!ready) return 'Loading titles…';
      if (kind !== 'all' || scope !== 'all') return 'No titles match these filters.';
      return 'Add titles to this list from their menus.';
    },
    retryLabel: 'Retry',
    load
  };
}
