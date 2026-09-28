<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import type { CastMember } from '$lib/providers/contracts';
  import { lazyImage } from '$lib/ui/lazy-image';
  import { creditRoles } from '$lib/media/credits';
  import SegmentedControl from './SegmentedControl.svelte';
  import ContentRow from './ContentRow.svelte';
  let {
    people,
    crew = [],
    busy = false,
    href,
    layout = 'row',
  }: {
    people: CastMember[];
    crew?: CastMember[];
    busy?: boolean;
    href?: string;
    layout?: 'row' | 'grid';
  } = $props();
  let selection = $state(
    untrack(() =>
      layout === 'grid' && page.url.searchParams.get('credits') === 'crew' ? 'crew' : 'cast'
    )
  );
  const visible = $derived(selection === 'cast' ? people : crew);
  let failed = $state<string[]>([]);
</script>

<ContentRow
  title="Credits"
  {layout}
  href={href ? `${href}&credits=${selection}` : undefined}
  artworkOptions={false}
  preserveHeight
  busy={selection === 'crew' && busy}
>
  {#snippet filters()}<SegmentedControl
      label="Credits selection"
      bind:value={selection}
      options={[
        { value: 'cast', label: 'Cast' },
        { value: 'crew', label: 'Crew' },
      ]}
    />{/snippet}
  {#snippet children(style)}
    {#each visible as person (person.id)}{@const roles = creditRoles(person.character)}<a
        href={`/people/${person.id}`}
        aria-label={`View ${person.name}`}
      >
        <div
          class="portrait"
          style:aspect-ratio={style.shape === 'poster'
            ? '2 / 3'
            : style.shape === 'square'
              ? '1'
              : style.shape === 'banner'
                ? '5.4'
                : '16 / 9'}
        >
          {#if person.portrait && !failed.includes(person.portrait)}<img
              use:lazyImage={person.portrait}
              alt=""
              loading="lazy"
              decoding="async"
              onerror={() => (failed = [...failed, person.portrait!])}
            />
          {:else}<span aria-hidden="true"
              >{person.name
                .split(' ')
                .map((part) => part[0])
                .slice(0, 2)
                .join('')}</span
            >{/if}
        </div>
        <h3>{person.name}</h3>
        {#if roles.names.length}<p title={roles.full}>
            {roles.preview}{#if roles.remaining}<span class="remaining">
                {' · '}+{roles.remaining} {roles.remaining === 1 ? 'role' : 'roles'}</span
              >{/if}{#if roles.voice}<span class="remaining">{' · '}Voice</span>{/if}
          </p>{/if}
      </a>{/each}
    {#if !visible.length && !busy}<div class="row-empty">
        <p class="muted">No {selection} credits are available for this title.</p>
      </div>{/if}
  {/snippet}
</ContentRow>

<style>
  a {
    display: block;
    min-width: 0;
    scroll-snap-align: start;
  }
  .portrait {
    aspect-ratio: 2/3;
    border-radius: 12px;
    overflow: hidden;
    background: var(--surface-soft);
    display: grid;
    place-items: center;
    color: var(--quiet);
    font-size: 28px;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  h3 {
    font-size: 12px;
    margin-top: 12px;
    font-weight: 600;
  }
  p {
    font-size: 10px;
    color: var(--muted);
    margin-top: 4px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .remaining {
    color: var(--quiet);
  }
</style>
