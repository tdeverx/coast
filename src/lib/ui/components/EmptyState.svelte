<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';
  let {
    title,
    description,
    icon = 'film',
    children,
    level = 2,
  }: {
    title: string;
    description: string;
    icon?: IconName;
    children?: Snippet;
    level?: 1 | 2;
  } = $props();
</script>

<div class="empty">
  <div class="empty-icon"><Icon name={icon} size={36} /></div>
  <svelte:element this={level === 1 ? 'h1' : 'h2'}>{title}</svelte:element>
  <p>{description}</p>
  {@render children?.()}
</div>
