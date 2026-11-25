<script lang="ts">
  import { page } from '$app/state';
  import ClassicSettings from '#lib/settings/ClassicSettings.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const editor = $derived(page.data.capabilities?.settingsSidebar === true
    ? import('#lib/settings/redesign/SettingsEditor.svelte').then(module => module.default)
    : undefined);
</script>

{#if editor}
  {#await editor then SettingsEditor}
    <SettingsEditor {data} />
  {/await}
{:else}
  <ClassicSettings {data} />
{/if}
