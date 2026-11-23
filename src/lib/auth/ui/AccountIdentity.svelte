<script lang="ts">
  import Avatar from '#lib/ui/components/Avatar.svelte';
  import type { ActivityStatus } from '#lib/social/status.js';

  let { name, avatar, detail, status }: {
    name: string; avatar?: string | null; detail?: string; status?: ActivityStatus;
  } = $props();
</script>

<Avatar {name} src={avatar} size={28} {status}/>
<span class="menu-action-label menu-row-copy">
  <span>{name}</span>
  {#if detail}<small>{detail}</small>{/if}
</span>
