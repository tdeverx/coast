<script lang="ts">
  import { reportFailure } from '$lib/ui/client-context';
  import { onDestroy, untrack } from 'svelte';
  import Button from './Button.svelte';
  import { createMenuResource } from '$lib/ui/controls/menu-resource.svelte';
  import { workMenuScope } from '$lib/ui/controls/work.svelte';
  import { listMembershipControls } from '$lib/ui/controls/actions';
  import { useClient } from '$lib/ui/client-context';
  import type { WorkList, WorkListPage } from '$lib/media/work-actions';
  let { workId, reading = false, disabled = false, select, children }: {
    workId: string; reading?: boolean; disabled?: boolean;
    select: (list: WorkList) => Promise<unknown>; children?: import('svelte').Snippet;
  } = $props();
  const { api } = useClient();
  let number = $state(1);
  const lists = createMenuResource<WorkListPage>(() => ({ items: [], page: 1, pages: 1, total: 0 }),
    () => workMenuScope([workId, reading, number]),
    signal => api(`collection/${workId}/lists?page=${number}&reading=${reading}`, undefined, 'GET', { signal }));
  $effect(() => { const scope = workMenuScope([workId, reading, number]); untrack(() => { scope; lists.sync(scope); if (lists.active && !disabled) void lists.load(); }); });
  onDestroy(lists.dispose);
  async function toggle(list: WorkList) { await select(list); await lists.refresh(); }

  reportFailure(()=>lists.error);
</script>
<Button menu label="Lists" icon="list" panel {disabled} onopen={() => void lists.open()} onclose={lists.close}>
  {#if lists.busy}<div class="menu-label" role="status">Loading lists…</div>{/if}
  {#each listMembershipControls(lists.data.items, list => list.count > 0, toggle, disabled || lists.busy) as control}<Button {...control} />
  {:else}{#if !lists.busy && !lists.error}<Button item href="/lists">Create a list…</Button>{/if}{/each}
  {#if lists.error}<Button item keepOpen icon="refresh" onclick={() => lists.load(true)}>Retry</Button>{/if}
  {#if lists.data.pages > 1}<div class="menu-divider" role="separator"></div>
    <Button item keepOpen disabled={lists.busy || lists.data.page <= 1} onclick={() => number = lists.data.page - 1}>Previous lists</Button>
    <Button item keepOpen disabled={lists.busy || lists.data.page >= lists.data.pages} onclick={() => number = lists.data.page + 1}>More lists</Button>
  {/if}
  {@render children?.()}
</Button>
