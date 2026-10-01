<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MediaView } from '$lib/ui/types';
  import type { HeroItem } from '$lib/ui/heroes/presentation.svelte';
  import type { PageCommand, PageSection } from '$lib/ui/pages/types';
  import { heroTitleIds } from '$lib/media/hero';
  import MediaHero from './MediaHero.svelte';
  import Shelf from './Shelf.svelte';
  import Button from './Button.svelte';
  import RowFeedback from './RowFeedback.svelte';
  import EmptyState from './EmptyState.svelte';
  let {
    children, hero = true, item, items = [], collection, parents = [], context = 'details', next = null,
    requestable = false, heroActions, commands = [], links = [], sections = [], error = '', back,
    details = false, page, class: className = '',
  }: {
    children?: Snippet;
    hero?: boolean;
    item?: HeroItem;
    items?: HeroItem[];
    collection?: { items: MediaView[]; selection: string; busy?: boolean };
    parents?: MediaView[];
    context?: 'discover' | 'details' | 'home';
    next?: MediaView | null;
    requestable?: boolean;
    heroActions?: Snippet;
    commands?: PageCommand[];
    links?: { href: string; label: string }[];
    sections?: PageSection[];
    error?: string;
    back?: { href: string; label: string };
    details?: boolean;
    page?: boolean;
    class?: string;
  } = $props();
  const hasHero = $derived(hero && (collection ? heroTitleIds(collection.items).length > 0 : !!item || items.length > 0));
</script>

{#snippet actionControls()}
  {#each commands as command}<Button icon={command.icon} variant={command.variant} disabled={command.disabled} href={command.href} onclick={command.run}>{command.label}</Button>{/each}
  {@render heroActions?.()}
{/snippet}
{#if hasHero}<MediaHero {item} {items} {collection} {parents} {context} {next} {requestable} actions={commands.length || heroActions ? actionControls : undefined} />{/if}
<div class={`content ${className}`} class:details class:page={page ?? !hasHero} class:route-content={!hasHero && !details}>
  {#if back}<Button variant="ghost" href={back.href} icon="left">{back.label}</Button>{/if}
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if links.length}<div class="row detail-links">{#each links as link}<Button variant="ghost" href={link.href}>{link.label}</Button>{/each}</div>{/if}
  {#each sections as section (section.key)}<Shelf title={section.title} items={section.items ?? []} panels={section.panels}
    size={section.panels ? 'panel' : section.shape ?? 'poster'} shape={section.shape} mediaKind={section.mediaKind}
    artworkOptions={!section.panels} layout={section.layout ?? 'row'} href={section.href}
    pageNumber={section.page} pages={section.pages} pageUrl={section.pageUrl}>
    {#snippet actions()}<RowFeedback error={section.error} retry={section.retry} />{/snippet}
    {#snippet empty()}{#if !section.error && section.empty}<EmptyState {...section.empty} icon="library" />{/if}{/snippet}
  </Shelf>{/each}
  {@render children?.()}
</div>
<style>
  .details { padding-bottom:90px; }
  .detail-links { margin-bottom:22px; }
</style>
