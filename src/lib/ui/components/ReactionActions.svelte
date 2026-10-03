<script lang="ts">
  import Icon from './Icon.svelte';
  import RowFeedback from './RowFeedback.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import { getContext, onDestroy, untrack } from 'svelte';

  import { useClient } from '$lib/ui/client-context';
  import { createResource } from '$lib/ui/resource.svelte';
  import { createMutation } from '$lib/ui/mutation.svelte';
  import { emojis } from '$lib/social/model';

  const { api, change } = useClient();
  const nested=!!getContext('coast-context-menu');

 let { targetId, targetKind = 'work', disabled = false, initialReaction = null }: { targetId: string; targetKind?: 'work' | 'activity'; disabled?: boolean; initialReaction?: string | null } = $props();
 type Reaction = { emoji: string; count: number; mine: boolean };
 let loaded = $state(false);
 const resource = createResource<Reaction[]>([]);
 async function load() {
  const id = targetId, kind = targetKind;
  const result = await resource.load(async signal => (await api<Record<string, Reaction[]>>(`social/reactions?targetKind=${kind}&ids=${id}`, undefined, 'GET', { signal }))[id] ?? []);
  if (result) loaded = true;
 }
 const mutation = createMutation(load);
 const selected = $derived(loaded ? resource.data.find(row => row.mine)?.emoji ?? null : initialReaction);
 $effect(() => { targetId; targetKind; untrack(() => { resource.replace([]); loaded = false; mutation.error = ''; }); });
 onDestroy(resource.cancel);
 function react(emoji: typeof emojis[number]) {
  const id = targetId, kind = targetKind;
  void mutation.run(() => change('social/reactions', { targetKind: kind, targetId: id, emoji: selected === emoji ? null : emoji }));
 }
</script>
<Button menu label="React" panel {disabled} onopen={load}>
 {#snippet trigger()}{#if selected}<span class="selected-emoji">{selected}</span>{:else}<Icon name="smile" size={20} />{/if}{#if nested}<span class="menu-action-label">React</span><span class="menu-chevron"><Icon name="right" /></span>{/if}{/snippet}
 <div class="reaction-strip">
  {#each emojis as emoji}<Button item class="reaction-choice" label={emoji} checked={selected === emoji} showCheckmark={false} disabled={resource.busy || mutation.busy} keepOpen onclick={() => react(emoji)}><span class="emoji">{emoji}</span></Button>{/each}
 </div>
 {#if resource.error || mutation.error}<RowFeedback error={resource.error || mutation.error} tag="p" class="notice error small" />{/if}
</Button>
<style>
 .selected-emoji,.emoji{font-size:var(--text-xl);line-height:var(--leading-solid);}
 .reaction-strip{display:flex;gap:0;}
 .reaction-strip :global(.reaction-choice){width:auto;min-width:40px;flex:1;padding:10px 8px;justify-content:center;}
 .reaction-strip :global(.menu-action-label){display:flex;flex-direction:column;align-items:center;gap:4px;}
 .reaction-strip :global([aria-checked="true"]){background:color-mix(in srgb,var(--white) 10%,transparent);}
</style>
