<script lang="ts">
  import { createResource } from '#lib/ui/resource.svelte.js';
  import { reportFailure, useClient } from '#lib/ui/client-context.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';
  import Pagination from '#lib/ui/components/Pagination.svelte';
  import type { adminDemand } from '#lib/collection/demand.server.js';

  type Demand = Awaited<ReturnType<typeof adminDemand>>;
  let { query }: { query: string | null } = $props();
  const { api } = useClient();
  const report = createResource<Demand | null>(null);
  const demand = $derived(report.data);

  function load(search: string) {
    return report.load(signal => api<Demand>('admin/demand' + search, undefined, 'GET', { signal }));
  }

  $effect(() => {
    const search = query;
    report.replace(null);
    if (search !== null) void load(search);
    return report.cancel;
  });
  reportFailure(() => report.error ? 'Demand could not be loaded. Try again.' : '', () => {
    if (query !== null) return load(query);
  });
</script>

<Heading title="Missing demand" />
<p class="small">Released next-needed items and saved titles that are missing or uncertain for each account. Users who opt out are excluded.</p>

{#if query === null}
  <div><Button compact href="/settings/admin?demand=1">Show missing demand</Button></div>
{:else if demand}
  {#if demand.users.length}
    <div class="overflow">
      <table class="table">
        <thead>
          <tr>
            <th>User</th>
            <th>Needed title</th>
            <th>Reason</th>
            <th>Availability</th>
            <th>Source coverage</th>
            <th>Request</th>
          </tr>
        </thead>

        <tbody>
          {#each demand.users as person}
            {#each person.items as item}
              <tr>
                <td>
                  <a
                    href={`/library?collection=true&username=${encodeURIComponent(person.username)}`}
                  >{person.username}</a>
                </td>

                <td>
                  <a href={item.href}>{item.neededTitle}</a>

                  {#if item.dateUnknown}
                    <small>· Release date unknown</small>
                  {/if}
                </td>

                <td>{item.reason}</td>
                <td>{item.availability === 'unknown' ? 'Uncertain' : 'Missing for this user'}</td>
                <td>{item.sources.map((source: { name: string; fresh: boolean }) => `${source.name}: ${source.fresh ? 'current' : 'not current'}`).join(', ') || 'No applicable sources'}</td>
                <td>{item.requests.map((request: { state: string }) => request.state).join(', ') || 'No request'}</td>
              </tr>
            {/each}{#if person.pages > 1}
              <tr>
                <td colspan="6">
                  <Pagination
                    page={person.page}
                    pages={person.pages}
                    pageUrl={(number) => `/settings/admin?userId=${person.userId}&itemsPage=${number}`}
                    label={`${person.username} demand pages`}
                  />
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="small">No missing demand on this page.</p>
  {/if}

  <Pagination
    page={demand.page}
    pages={demand.pages}
    pageUrl={(number) => `/settings/admin?page=${number}`}
    label="Demand pages"
  />
{:else if !report.error}
  <p class="small" role="status">Checking personal demand…</p>
{/if}
