<script lang="ts" generics="T extends { id: string; name: string; playlist: boolean }">
  import type { Snippet } from 'svelte';
  import MenuAction from './MenuAction.svelte';
  let { lists, member, disabled = false, playlistLabel = 'Add to', playlistIcon = 'plus', onchange, empty }: {
    lists: T[];
    member: (list: T) => boolean;
    disabled?: boolean;
    playlistLabel?: string;
    playlistIcon?: 'plus' | 'list';
    onchange: (list: T) => void;
    empty?: Snippet;
  } = $props();
</script>

{#each lists as list (list.id)}<MenuAction icon={list.playlist ? playlistIcon : 'list'}
  checked={list.playlist ? undefined : member(list)} {disabled} onclick={() => onchange(list)}>
  {list.playlist ? `${playlistLabel} ${list.name}` : list.name}
</MenuAction>{:else}{@render empty?.()}{/each}
