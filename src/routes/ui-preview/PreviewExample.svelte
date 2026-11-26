<script lang="ts">
  import { useMenuPreview } from '#lib/ui/controls/menu-preview.js';
  import type { Component } from 'svelte';
  import { providePreviewClient, reportFailure } from '#lib/ui/client-context.js';
  import { providePreviewPlayback } from '#lib/playback/context.svelte.js';
  import NotificationToasts from '#lib/ui/components/NotificationToasts.svelte';
  import Demo from './Demo.svelte';
  import { createPreviewTransport } from './demo/fixtures';
  import { recipe, type ReferenceFamily } from './reference';
  import type { Customisation } from './props';
  import ComponentSpecimen from './ComponentSpecimen.svelte';

  let { name, initialOpen = false, scenario, custom, options, onprop, onevent }: {
    name: string; initialOpen?: boolean;
    scenario:string; options?:Record<string,unknown>; custom?:Customisation; onprop?:(key:string,value:unknown)=>void; onevent?:(name:string,args:unknown[])=>void;
  } = $props();
  const composition = $derived(recipe(name));
  const customActive = $derived(custom !== undefined);
  const socialNames = new Set(['PartyCard', 'PartyMenu', 'PersistentPlayer', 'FriendRoster', 'FriendsPanel', 'NotificationInbox', 'StreamsPanel', 'NotificationToasts', 'PlaybackTimeline']);
  const family = $derived<ReferenceFamily | undefined>(composition?.family ?? (socialNames.has(name) ? 'social' : undefined));
  const menuFixture = useMenuPreview();
  const transport = $derived(createPreviewTransport(name, scenario, menuFixture?.conditions));
  const {feedback} = providePreviewClient((input, init) => transport(input, init));
  $effect(() => {
    if (name === 'NotificationToasts') return feedback.host('preview-canvas');
  });
  providePreviewPlayback();
  let Renderer = $state<Component<{name: string; scenario: string; options?:Record<string,unknown>; onoption?:(key:string,value:unknown)=>void}>>();
  let failure = $state('');
  const loaders = {
    catalogue: () => import('./CatalogueExamples.svelte'),
    social: () => import('./SocialExamples.svelte'),
    admin: () => import('./AdminExamples.svelte'),
    settings: () => import('./SettingsExamples.svelte'),
    production: () => import('./ProductionExamples.svelte'),
    feature: () => import('./FeatureExamples.svelte'),
  };
  $effect(() => {
    const selected = customActive ? undefined : family;
    let cancelled = false;
    Renderer = undefined;
    failure = '';
    if (selected) void loaders[selected]().then(module => { if (!cancelled) Renderer = module.default; })
      .catch(() => { if (!cancelled) failure = 'This example could not load. Reopen it to retry.'; });
    return () => { cancelled = true; };
  });
  reportFailure(()=>failure);
</script>

{#key `${name}:${scenario}`}
  <div class="reference-example" data-reference={name} data-scenario={scenario} onclickcapture={event => { const link = (event.target as Element).closest('a'); if (link && !link.hasAttribute('data-preview-navigation')) event.preventDefault(); }} onsubmitcapture={event => event.preventDefault()}>
    {#if custom}<ComponentSpecimen {name} {custom} change={(key,value)=>onprop?.(key,value)} onevent={(name,args)=>onevent?.(name,args)} />
    {:else if failure}<!-- Failure is delivered by the scoped toast. -->
    {:else if family}
      {#if Renderer}<Renderer name={composition?.family === 'admin' ? composition.example : name} {scenario} {options} onoption={onprop} />{:else}<p role="status" class="quiet">Loading example…</p>{/if}
    {:else}<Demo {name} {scenario} {initialOpen} />{/if}
    {#if name === 'NotificationToasts'}
      {#if feedback.activeHost === 'preview-canvas' && feedback.notifications}
        <div class="sample-notifications">{@render feedback.notifications()}</div>
      {/if}
    {:else}<NotificationToasts notifications={[]} />{/if}
  </div>
{/key}

<style>
  .reference-example { position: relative; min-width: 0; contain: layout;display:grid;grid-template-columns:minmax(0,1fr);justify-items:center; }
  .sample-notifications { grid-area:1 / 1; align-self:center; width:min(100%, var(--toast-width, 380px)); }
  .reference-example:has(.sample-notifications) > :global(.component-specimen) { grid-area:1 / 1; }
</style>
