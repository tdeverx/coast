<script lang="ts">
  import type { Component } from 'svelte';
  import { untrack } from 'svelte';
  import { providePreviewClient } from '$lib/ui/client-context';
  import { providePreviewPlayback } from '$lib/playback/context.svelte';
  import RowFilter from '$lib/ui/components/RowFilter.svelte';
  import Demo from './Demo.svelte';
  import { createPreviewTransport } from './demo/fixtures';
  import { recipe, scenarios, selectedScenario, scenarioLabel, type ReferenceFamily } from './reference';
  import type { ExampleValues } from './workspace';

  let { name, initialOpen = false, initialScenario, onchange, scenarioValue, options }: {
    name: string; initialOpen?: boolean; initialScenario?: string | null; onchange?: (value: string) => void;
    scenarioValue?:string; options?:ExampleValues;
  } = $props();
  let localScenario = $state(untrack(() => selectedScenario(name, initialScenario)));
  $effect(() => { localScenario = selectedScenario(name, initialScenario); });
  const scenario = $derived(scenarioValue ?? localScenario);
  const composition = $derived(recipe(name));
  const socialNames = new Set(['PartyCard', 'PartyMenu', 'SyncedControls', 'FriendRoster', 'FriendsPanel', 'NotificationInbox', 'StreamsPanel', 'NotificationToasts', 'PlaybackTimeline']);
  const family = $derived<ReferenceFamily | undefined>(composition?.family ?? (socialNames.has(name) ? 'social' : undefined));
  const transport = $derived(createPreviewTransport(name, scenario));
  providePreviewClient((input, init) => transport(input, init));
  providePreviewPlayback();
  let Renderer = $state<Component<{name: string; scenario: string}>>();
  let failure = $state('');
  const loaders = {
    catalogue: () => import('./CatalogueExamples.svelte'),
    social: () => import('./SocialExamples.svelte'),
    admin: () => import('./AdminExamples.svelte'),
    feature: () => import('./FeatureExamples.svelte'),
  };
  $effect(() => {
    const selected = family;
    let cancelled = false;
    Renderer = undefined;
    failure = '';
    if (selected) void loaders[selected]().then(module => { if (!cancelled) Renderer = module.default; })
      .catch(() => { if (!cancelled) failure = 'This example could not load. Reopen it to retry.'; });
    return () => { cancelled = true; };
  });
  function select(value: string) { localScenario = value; onchange?.(value); }
</script>

{#if scenarioValue === undefined && scenarios(name).length > 1}
  <div class="scenario-controls"><RowFilter selection groups={[{label: 'Example state', value: scenario, options: scenarios(name).map(value => ({value, label: scenarioLabel(value)})), change: select}]} /></div>
{/if}
{#key `${name}:${scenario}`}
  <div class="reference-example" data-reference={name} data-scenario={scenario} onclickcapture={event => { const link = (event.target as Element).closest('a'); if (link && !link.hasAttribute('data-preview-navigation')) event.preventDefault(); }} onsubmitcapture={event => event.preventDefault()}>
    {#if failure}<p role="alert">{failure}</p>
    {:else if family}
      {#if Renderer}<Renderer name={composition?.family === 'admin' ? composition.example : name} {scenario} />{:else}<p role="status" class="quiet">Loading example…</p>{/if}
    {:else}<Demo {name} {scenario} {initialOpen} {options} />{/if}
  </div>
{/key}

<style>
  .scenario-controls { margin-block: 12px; }
  .reference-example { position: relative; min-width: 0; contain: layout; }
</style>
