<script lang="ts">
  import {page as route} from '$app/state';
  import { useClient } from '$lib/ui/client-context';
  import Heading from './Heading.svelte';
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

  const { api } = useClient();

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
  let friendDetails=$state<{userId:string;username:string;rating:number|null;watched:boolean;progress:number}[]>([]);
  let friendTotal=$state(0);
  const socialWork=$derived(item ? ('workId' in item ? item.workId??item.id : item.id) : '');
  $effect(()=>{
    const id=socialWork;friendDetails=[];friendTotal=0;if(!route.data.user||!/^[0-9a-f-]{36}$/.test(id))return;
    const controller=new AbortController();
    void api<Record<string,{friends:typeof friendDetails;total:number}>>(`social/works?ids=${id}`,undefined,'GET',{signal:controller.signal}).then(result=>{friendDetails=result[id]?.friends??[];friendTotal=result[id]?.total??0;}).catch(()=>{});
    return ()=>controller.abort();
  });
</script>

{#snippet actionControls()}
  {#each commands as command}<Button icon={command.icon} emphasis={command.emphasis} disabled={command.disabled} href={command.href} onclick={command.run}>{command.label}</Button>{/each}
  {@render heroActions?.()}
{/snippet}
{#if hasHero}<MediaHero {item} {items} {collection} {parents} {context} {next} {requestable} actions={commands.length || heroActions ? actionControls : undefined} />{/if}
<div class={`content ${className}`} class:details class:page={page ?? !hasHero} class:route-content={!hasHero && !details}>
  {#if back}<Button emphasis="subtle" href={back.href} icon="left">{back.label}</Button>{/if}
  {#if error}<RowFeedback error={error} tag="p" class="notice error" />{/if}
  {#if links.length}<div class="row detail-links">{#each links as link}<Button emphasis="subtle" href={link.href}>{link.label}</Button>{/each}</div>{/if}
  {#each sections as section (section.key)}<Shelf title={section.title} items={section.items ?? []} panels={section.panels}
    size={section.panels ? 'panel' : section.shape ?? 'poster'} shape={section.shape} mediaKind={section.mediaKind}
    artworkOptions={!section.panels} layout={section.layout ?? 'row'} href={section.href}
    pageNumber={section.page} pages={section.pages} pageUrl={section.pageUrl}>
    {#snippet actions()}<RowFeedback error={section.error} retry={section.retry} />{/snippet}
    {#snippet empty()}{#if !section.error && section.empty}<EmptyState {...section.empty} icon="library" />{/if}{/snippet}
  </Shelf>{/each}
  {#if friendDetails.length}<section class="section"><Heading title="Friends on this title" /><div class="row">{#each friendDetails as friend}<Button emphasis="subtle" href={`/profile/${encodeURIComponent(friend.username)}`}>{friend.username}{friend.rating!==null?` · ${friend.rating} stars`:''}{friend.watched?' · Completed':friend.progress?' · In progress':''}</Button>{/each}{#if friendTotal>friendDetails.length}<span class="small quiet">+{friendTotal-friendDetails.length} more friends</span>{/if}</div></section>{/if}
  {@render children?.()}
</div>
<style>
  .details { padding-bottom:90px; }
  .detail-links { margin-bottom:22px; }
</style>
