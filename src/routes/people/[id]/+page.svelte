<script lang="ts">
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import { page } from '$app/state';
  import Button from '$lib/ui/components/Button.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  let { data } = $props();
  const section = $derived(
    ['all', 'library', 'known'].includes(page.url.searchParams.get('section') ?? '')
      ? page.url.searchParams.get('section')!
      : null
  );
  let failed = $state(false);
  const biographyPreview = $derived(data.person.biography.split('\n\n')[0]);
  $effect(() => {
    data.person.id;
    failed = false;
  });
</script>

<svelte:head><title>{data.person.name} · Coast</title></svelte:head>
<div class="content page route-content people-page">
  {#if !section}<section class="person-intro">
      {#if data.person.portrait && !failed}<img
          class="portrait"
          src={data.person.portrait}
          alt={data.person.name}
          onerror={() => (failed = true)}
        />{/if}
      <div class="bio">
        <Heading variant="page" title={data.person.name} description={data.person.department} />
        <dl>
          {#if data.person.birthday}<div>
              <dt>Born</dt>
              <dd>
                {data.person.birthday}{data.person.birthplace ? ` · ${data.person.birthplace}` : ''}
              </dd>
            </div>{/if}{#if data.person.deathday}<div>
              <dt>Died</dt>
              <dd>{data.person.deathday}</dd>
            </div>{/if}
        </dl>
        {#if data.person.biography}<div>
            <p>{biographyPreview}</p>
            {#if data.person.biography.length > biographyPreview.length}<details>
                <summary>More about {data.person.name}</summary>
                <p>{data.person.biography.slice(biographyPreview.length).trim()}</p>
              </details>{/if}
          </div>{/if}
        <a
          class="small"
          href={`https://www.themoviedb.org/person/${data.person.id}`}
          target="_blank"
          rel="noreferrer">View on TMDB ↗</a
        >
      </div>
    </section>
  {:else}<Button variant="ghost" href={`/people/${data.person.id}`} icon="left"
      >{data.person.name}</Button
    >{/if}
  {#key `${data.person.id}:${section}`}
    {#if section}<Shelf source={{ type: 'credits', personId: data.person.id, scope: section as 'all' | 'library' | 'known', layout: "grid", title: section === 'all'
          ? 'All credits'
          : section === 'known'
            ? 'Known for'
            : 'In your library' }} />
    {:else}<Shelf source={{ type: 'credits', personId: data.person.id, title: "In your library", scope: "library" }} /><Shelf source={{ type: 'credits', personId: data.person.id, title: "Known for", scope: "known" }} /><Shelf source={{ type: 'credits', personId: data.person.id, title: "All credits" }} />{/if}{/key}
</div>

<style>
  .people-page {
    padding-bottom: 90px;
  }
  .person-intro {
    display: flex;
    gap: 32px;
    align-items: start;
    margin: 24px 0 40px;
  }
  .portrait {
    width: clamp(110px, 18vw, 230px);
    aspect-ratio: 2/3;
    object-fit: cover;
    border-radius: 12px;
  }
  .bio {
    min-width: 0;
    max-width: 800px;
    display: grid;
    gap: 18px;
  }
  .bio :global(.page-heading) {
    margin: 0;
  }
  .bio p {
    white-space: pre-line;
    line-height: var(--leading-relaxed);
    font-size: var(--text-sm);
    margin-top: 16px;
  }
  summary {
    cursor: pointer;
  }
  dl {
    display: grid;
    gap: 12px;
  }
  dt {
    font-size: var(--text-sm);
    color: var(--muted);
  }
  dd {
    font-size: var(--text-sm);
    margin-top: 4px;
  }
  @media (max-width: 600px) {
    .person-intro {
      gap: 20px;
      flex-wrap: wrap;
    }
    .portrait {
      width: 120px;
    }
    .bio {
      width: 100%;
    }
  }
</style>
