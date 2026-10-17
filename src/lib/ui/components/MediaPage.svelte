<script lang="ts">
  import { reportFailure } from '$lib/ui/client-context';
  import type { Snippet } from 'svelte';
  import type { MediaView } from '$lib/ui/types';
  import type { HeroItem } from '$lib/ui/heroes/presentation.svelte';
  import type { PageCommand, PageSection } from '$lib/ui/pages/types';
  import { heroTitleIds } from '$lib/media/hero';
  import MediaHero from './MediaHero.svelte';
  import Shelf from './Shelf.svelte';
  import Button from './Button.svelte';
  import EmptyState from './EmptyState.svelte';

  let {
    children, hero = true, item, items = [], collection, parents = [], context = 'details', next = null,
    requestable = false, heroActions, commands = [], links = [], sections = [], error = '', back,
    details = false, page, editionName,heroAlignment='left', class: className = '',
  }: {
    children?: Snippet;
    hero?: boolean;
    item?: HeroItem;
    items?: HeroItem[];
    collection?: { items: HeroItem[]; selection: string; busy?: boolean };
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
    editionName?:string;heroAlignment?:'left'|'center'|'adaptive';details?: boolean;
    page?: boolean;
    class?: string;
  } = $props();
  const hasHero = $derived(hero && (collection ? heroTitleIds(collection.items).length > 0 : !!item || items.length > 0));
  reportFailure(()=>error);
</script>

{#snippet actionControls()}
  {#each commands as command}<Button size={command.size} icon={command.icon} emphasis={command.emphasis} disabled={command.disabled} href={command.href} onclick={command.run}>{command.label}</Button>{/each}
  {@render heroActions?.()}
{/snippet}
{#if hasHero}<MediaHero alignment={heroAlignment} {editionName} {item} {items} {collection} {parents} {context} {next} {requestable} actions={commands.length || heroActions ? actionControls : undefined} />{/if}
<div class={`content ${className}`} class:details class:page={page ?? !hasHero} class:route-content={!hasHero && !details}>
  {#if back}<Button emphasis="subtle" href={back.href} icon="left">{back.label}</Button>{/if}

  {#if links.length}<div class="row detail-links">{#each links as link}<Button emphasis="subtle" href={link.href}>{link.label}</Button>{/each}</div>{/if}
  {#each sections as section (section.key)}<Shelf source={section.source} title={section.title} items={section.items ?? []} panels={section.panels}
    size={section.panels ? 'panel' : section.shape ?? 'poster'} shape={section.shape} mediaKind={section.mediaKind}
    artworkOptions={!section.panels} layout={section.layout ?? 'row'} href={section.href}
    pageNumber={section.page} pages={section.pages} pageUrl={section.pageUrl} error={section.error} retry={section.retry}>
    {#snippet empty()}{#if !section.error && section.empty}<EmptyState {...section.empty} icon="library" />{/if}{/snippet}
  </Shelf>{/each}
  {@render children?.()}
</div>
<style>
  .details { padding-bottom:90px; }
  .detail-links { margin-bottom:22px; }
</style>
