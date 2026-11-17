<script lang="ts">
  import { reportFailure, useClient } from '#lib/ui/client-context.js';
  import { onDestroy, tick, untrack } from 'svelte';
  import Button from './Button.svelte';
  import { createMenuResource } from '#lib/ui/controls/menu-resource.svelte.js';
  import { retryMenuRead } from '#lib/ui/controls/menu-read-retry.js';
  import { workMenuScope } from '#lib/ui/controls/work.svelte.js';
  import { listMembershipControls } from '#lib/ui/controls/actions.js';
  import { lazyContent } from '#lib/ui/lazy-content.js';
  import { createOperation } from '#lib/ui/operation.svelte.js';
  import { useRetention } from '#lib/ui/retention.js';
  import { uniqueItems } from '#lib/ui/resource.svelte.js';
  import type { WorkList, WorkListPage } from '#lib/media/work-actions.js';

  let { workId, reading = false, disabled = false, select, children }: {
    workId: string; reading?: boolean; disabled?: boolean;
    select: (list: WorkList) => Promise<unknown>; children?: import('svelte').Snippet;
  } = $props();
  const { api, change, feedback } = useClient();
  const creating = createOperation(useRetention());
  let number = 1;
  let editing = $state(false), name = $state('');
  let input = $state<HTMLInputElement>(), menu = $state<Button>();
  const key = () => workMenuScope([workId, reading]);
  const lists = createMenuResource<WorkListPage>(
    () => ({ items: [], page: 0, pages: 0, total: 0 }),
    key,
    async (signal): Promise<WorkListPage> => {
      const requested = number;
      const previous = lists.data.items;
      const next = await api<WorkListPage>(`collection/${workId}/lists?page=${requested}&reading=${reading}`, undefined, 'GET', { signal });
      return requested === 1 ? next : { ...next, items: uniqueItems([...previous, ...next.items], list => list.id) };
    },
    retryMenuRead
  );
  $effect(() => {
    const scope = key();
    untrack(() => {
      number = 1;
      lists.sync(scope);
      if (lists.active && !disabled) void lists.load();
    });
  });
  onDestroy(lists.dispose);

  function open() {
    if (lists.error) {
      number = 1;
      lists.replace({items: [], page: 0, pages: 0, total: 0});
      void lists.open().then(() => lists.active ? lists.refresh() : undefined);
    } else void lists.open();
  }
  function closeEditor() { editing = false; name = ''; }
  function close() { closeEditor(); lists.close(); }
  async function beginList() {
    editing = true;
    await tick();
    input?.focus();
  }
  function more() {
    if (!lists.active || lists.busy || lists.error || lists.data.page >= lists.data.pages) return;
    number = lists.data.page + 1;
    void lists.load(true);
  }
  async function refreshLists() {
    number = 1;
    await lists.refresh();
  }
  async function toggle(list: WorkList) {
    await select(list);
    await refreshLists();
  }
  async function createList(event: SubmitEvent) {
    event.preventDefault();
    const title = name.trim();
    if (!title) return;
    const mediaId = workId;
    if (await creating.run(async () => {
      await change('lists', { name: title, mediaId });
      feedback.notify(`Added to ${title}.`);
    })) {
      closeEditor();
      await refreshLists();
      await menu?.focusFirst();
    }
  }

  reportFailure(() => lists.error && `Could not load lists. ${lists.error}`);
  reportFailure(() => creating.error);
</script>

<Button menu label="Lists" icon="list" panel disabled={disabled && !creating.busy} bind:this={menu}
  onopen={open} onclose={close}>
  {#if editing}
    <form class="new-list" data-menu-interactive onsubmit={createList}>
      <input bind:this={input} bind:value={name} aria-label="List name" placeholder="List name"
        size={1} maxlength={120} autocomplete="off" disabled={creating.busy} data-menu-focus tabindex="-1" required />
      <Button item type="submit" disabled={creating.busy || !name.trim()} keepOpen>{creating.busy ? 'Creating…' : 'Create'}</Button>
    </form>
  {:else}
    <Button item icon="plus" disabled={disabled || creating.busy} keepOpen onclick={beginList}>New list…</Button>
  {/if}
  <div class="menu-divider" role="separator"></div>
  {#each listMembershipControls(lists.data.items, list => list.count > 0, toggle, disabled || lists.busy || creating.busy) as control}
    <Button {...control} />
  {/each}
  {#if lists.busy}<div class="menu-label" role="status">Loading lists…</div>
  {:else if lists.error}<div class="menu-label" role="status">Lists unavailable</div>
  {:else if !lists.data.items.length && lists.data.page}<div class="menu-label">No lists yet</div>
  {:else if lists.data.page && lists.data.page < lists.data.pages}
    {#key lists.data.page}<div class="menu-label" role="status" use:lazyContent={{load: more, rootMargin: '0px'}}>Loading lists…</div>{/key}
  {/if}
  {@render children?.()}
</Button>

<style>
  .new-list { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--menu-inset); }
  .new-list input {
    min-width: 0;
    min-height: var(--control-height);
    border-radius: var(--menu-row-radius);
    padding: var(--menu-item-inset);
    font-size: var(--text-sm);
  }
</style>
