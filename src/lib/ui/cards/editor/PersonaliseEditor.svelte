<script lang="ts">
  import { page } from '$app/state';
  import { useClient } from '#lib/ui/client-context.js';
  import CardLayoutEditor from './CardLayoutEditor.svelte';
  import type { CardLayouts, CardLayoutTarget, CardLayout } from '../layout';

  let { onclose }: { onclose: () => void } = $props();
  const { change } = useClient();
  const save = (target: CardLayoutTarget, layout: CardLayout | null) => change<CardLayouts>('settings/card-layout', { target, layout });
</script>

{#key page.data.user?.id}
  <CardLayoutEditor inOverlay onback={onclose} backLabel="Close Personalise" initialLayouts={page.data.user?.settings.cardLayouts} {save} />
{/key}
