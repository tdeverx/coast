<script lang="ts">
  import type { TraktSync } from './access.js';

  let { sync = $bindable(), disabled = false, form = false }: { sync: TraktSync; disabled?: boolean; form?: boolean } = $props();
  const rows = [
    { label: 'Watch history', import: 'history', export: 'history' },
    { label: 'Viewing progress', import: 'progress', export: 'progress' },
    { label: 'Collection', import: 'collection', export: 'collection' },
    { label: 'Ratings', import: 'ratings', export: 'ratings' },
    { label: 'Watchlist', import: 'watchlist', export: 'watchlist' },
    { label: 'Custom lists', import: 'lists', export: 'lists' },
    { label: 'Live activity', import: 'live', export: 'scrobble' },
    { label: 'Recommendations', import: 'recommendations' },
  ] as const;
</script>

<table aria-label="Trakt sync preferences">
  <thead><tr><th scope="col">Activity</th><th scope="col">Import</th><th scope="col">Export</th></tr></thead>
  <tbody>
    {#each rows as row (row.label)}
      <tr>
        <th scope="row">{row.label}</th>
        <td><label class="check"><input type="checkbox" name={form ? `import.${row.import}` : undefined} bind:checked={sync.import[row.import]} {disabled} aria-label={`Import ${row.label.toLowerCase()} from Trakt`} /></label></td>
        <td>
          {#if 'export' in row}
            <label class="check"><input type="checkbox" name={form ? `export.${row.export}` : undefined} bind:checked={sync.export[row.export]} {disabled} aria-label={row.export === 'scrobble' ? 'Export live scrobbles and check-ins to Trakt' : `Export ${row.label.toLowerCase()} to Trakt`} /></label>
          {:else}<span aria-label="Unavailable">—</span>{/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
<p class="small">Live activity export sends scrobbles and check-ins. Trakt can turn completed sessions into watch history.</p>

<style>
  table { width: 100%; border-collapse: collapse; }
  th, td { padding-block: var(--space-2, 0.5rem); }
  th { text-align: start; }
  th:not(:first-child), td { text-align: center; }
  .check { display: inline-flex; margin: 0; }
</style>
