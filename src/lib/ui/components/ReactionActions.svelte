<script lang="ts">
 import { onDestroy, untrack } from 'svelte';
 import ContextMenu from './ContextMenu.svelte';
 import MenuAction from './MenuAction.svelte';
 import { useClient } from '$lib/ui/client-context';
 import { createResource } from '$lib/ui/resource.svelte';
 import { createMutation } from '$lib/ui/mutation.svelte';
 import { emojis } from '$lib/social/model';

  const { api, change } = useClient();

 let { targetId, targetKind = 'work', disabled = false }: { targetId: string; targetKind?: 'work' | 'activity'; disabled?: boolean } = $props();
 type Reaction = { emoji: string; count: number; mine: boolean };
 const resource = createResource<Reaction[]>([]);
 async function load() {
  const id = targetId, kind = targetKind;
  await resource.load(async signal => (await api<Record<string, Reaction[]>>(`social/reactions?targetKind=${kind}&ids=${id}`, undefined, 'GET', { signal }))[id] ?? []);
 }
 const mutation = createMutation(load);
 const selected = $derived(resource.data.find(row => row.mine)?.emoji ?? null);
 const counts = $derived(Object.fromEntries(resource.data.map(row => [row.emoji, row.count])));
 $effect(() => { targetId; targetKind; untrack(() => { resource.replace([]); mutation.error = ''; }); });
 onDestroy(resource.cancel);
 function react(emoji: typeof emojis[number]) {
  const id = targetId, kind = targetKind;
  void mutation.run(() => change('social/reactions', { targetKind: kind, targetId: id, emoji: selected === emoji ? null : emoji }));
 }
</script>
<ContextMenu label="Reactions" icon="heart" panel {disabled} onopen={load}>
 {#each emojis as emoji}<MenuAction checked={selected === emoji} disabled={resource.busy || mutation.busy} keepOpen onclick={() => react(emoji)}>{emoji}{counts[emoji] ? ` · ${counts[emoji]}` : ''}</MenuAction>{/each}
 {#if resource.error || mutation.error}<p class="notice error small" role="alert">{resource.error || mutation.error}</p>{/if}
</ContextMenu>
