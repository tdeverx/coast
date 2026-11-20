<script lang="ts">
  import { page } from '$app/state';
  import { artworkColour } from '#lib/ui/artwork-colour.js';
  import { sectionTarget } from '#lib/ui/section-target.js';
  import Shelf from '../components/Shelf.svelte';

  let { href, artwork }: { href: string; artwork?: string } = $props();
  const row = $derived(sectionTarget(href, page.url)?.source);
  const source = $derived(row?.type === 'discovery'
    ? { ...row, mediums: { ...page.data, features: page.data.capabilities } }
    : row);
</script>

<div class:detail-presentation={!!artwork} use:artworkColour={artwork ? [artwork] : []}>
  <div class="content section-page">
    {#if source}<Shelf {source} hideEmpty={false} />{/if}
  </div>
</div>

<style>
  .section-page { padding-top: 72px; padding-bottom: 96px; }
</style>
