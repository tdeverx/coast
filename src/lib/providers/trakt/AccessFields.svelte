<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  import Toggle from '#lib/ui/components/Toggle.svelte';
  import type { TraktSync } from './access.js';

  let { sync = $bindable(), disabled = false, form = false, group }: {
    sync: TraktSync; disabled?: boolean; form?: boolean; group?: Snippet<[Snippet]>;
  } = $props();
  const rows = [
    { label: 'Watch history', icon: 'history', import: 'history', export: 'history' },
    { label: 'Viewing progress', icon: 'play', import: 'progress', export: 'progress' },
    { label: 'Paused and dropped shows', icon: 'pause', import: 'trackingStatus', export: 'trackingStatus',
      detail: 'Trakt records paused and dropped shows as dropped.' },
    { label: 'Show rewatch dates', icon: 'refresh', import: 'rewatch', export: 'rewatch',
      detail: 'Exporting show rewatch dates requires Trakt VIP.' },
    { label: 'Collection', icon: 'collection', import: 'collection', export: 'collection' },
    { label: 'Ratings', icon: 'star', import: 'ratings', export: 'ratings' },
    { label: 'Watchlist', icon: 'bookmark', import: 'watchlist', export: 'watchlist' },
    { label: 'Custom lists', icon: 'list', import: 'lists', export: 'lists' },
    { label: 'Live activity', icon: 'broadcast', import: 'live', export: 'scrobble',
      detail: 'Live activity export sends scrobbles and check-ins. Trakt can turn completed sessions into watch history.' },
    { label: 'Recommendations', icon: 'heart', import: 'recommendations' },
  ] as const;
  type Activity = (typeof rows)[number];
  type ExportableActivity = Extract<Activity, { export: string }>;
  const exportLabel = (row: ExportableActivity) => row.export === 'scrobble'
    ? 'Export live scrobbles and check-ins to Trakt'
    : `Export ${row.label.toLowerCase()} to Trakt`;
</script>

{#snippet mark()}
  <span class="check-mark" aria-hidden="true"><Icon name="check" size={12}/></span>
{/snippet}

{#snippet activity(row: Activity)}
  <div class="activity">
    <Icon name={row.icon} size={16} />
    <span>{row.label}</span>
    {#if 'detail' in row}
      <div class="sync-info-slot">
        <Button menu align="end" icon="info" iconSize={16} label={`About ${row.label}`} triggerClass="icon-button field-info">
          <Button item text={row.detail} />
        </Button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet importCheck(row: Activity)}
  <label class="menu-icon-action sync-check">
    <input type="checkbox" name={form ? `import.${row.import}` : undefined} bind:checked={sync.import[row.import]} {disabled}
      aria-label={`Import ${row.label.toLowerCase()} from Trakt`} />
    {@render mark()}
  </label>
{/snippet}

{#snippet exportCheck(row: ExportableActivity)}
  <label class="menu-icon-action sync-check">
    <input type="checkbox" name={form ? `export.${row.export}` : undefined} bind:checked={sync.export[row.export]} {disabled}
      aria-label={exportLabel(row)} />
    {@render mark()}
  </label>
{/snippet}

{#if group}
  {#snippet directionRows()}
    {#each rows as row (row.import)}
      {@const importing = sync.import[row.import]}
      {@const exporting = 'export' in row && sync.export[row.export]}
      <div class="menu-row sync-row" class:disabled>
        {@render activity(row)}
        <span class="menu-row-note sync-mode">{importing ? exporting ? 'Both' : 'Import' : exporting ? 'Export' : 'Off'}</span>
        <div class="sync-switches">
          <Toggle label={`Import ${row.label.toLowerCase()} from Trakt`} name={form ? `import.${row.import}` : undefined}
            {disabled} bind:checked={sync.import[row.import]} />
          {#if 'export' in row}
            <Toggle label={exportLabel(row)} name={form ? `export.${row.export}` : undefined}
              {disabled} bind:checked={sync.export[row.export]} />
          {:else}
            <Toggle label="Export recommendations to Trakt" disabled />
          {/if}
        </div>
      </div>
    {/each}
  {/snippet}
  {@render group(directionRows)}
{:else}
  <table data-field class:disabled aria-label="Trakt sync preferences">
    <colgroup><col/><col class="direction"/><col class="direction"/></colgroup>
    <thead><tr><th scope="col">Activity</th><th scope="col">Import</th><th scope="col">Export</th></tr></thead>
    <tbody>
      {#each rows as row (row.label)}
        <tr>
          <th scope="row">{@render activity(row)}</th>
          <td>{@render importCheck(row)}</td>
          <td>
            {#if 'export' in row}
              {@render exportCheck(row)}
            {:else}<span class="menu-row-note" aria-label="Export unavailable">—</span>{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
<style>
  .sync-switches {
    --toggle-on-tint: color-mix(in srgb, var(--trakt-purple) 60%, transparent);
    display: grid;
    grid-template-columns: repeat(2, calc(2 * var(--icon-control)));
    place-items: center;
    gap: var(--menu-item-inset);
    flex: none;
  }
  .sync-row { padding-block: calc(var(--menu-item-inset) - var(--menu-inset)); }
  .sync-row.disabled:hover { background: transparent; color: var(--menu-row-ink); }
  .sync-row .activity { flex: 1; min-inline-size: 0; }
  .sync-mode { flex: 0 0 6ch; text-align: end; }
  table {
    width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0 var(--menu-inset);
    color: var(--menu-row-ink);
    font-size: var(--text-sm);
    line-height: var(--leading-menu);
  }
  .direction { width: calc(var(--control-height) + var(--menu-item-inset)); }
  th { text-align: start; }
  th:first-child { padding-inline: var(--menu-item-inset); }
  th:not(:first-child), td { text-align: center; }
  th { font-weight: var(--weight-semibold); }
  thead th { padding-block: var(--menu-inset); color: var(--muted); }
  tbody :is(th, td) { transition: background var(--fast); }
  tbody th { border-start-start-radius: var(--menu-row-radius); border-end-start-radius: var(--menu-row-radius); }
  tbody td:last-child { border-start-end-radius: var(--menu-row-radius); border-end-end-radius: var(--menu-row-radius); }
  table:not(.disabled) tbody tr:hover > :is(th, td) { background: var(--control-hover-fill); }
  .activity { display: flex; align-items: center; gap: var(--menu-item-inset); }
  .activity > :global(svg) { flex: none; }
  .activity span { overflow-wrap: anywhere; }
  .sync-info-slot {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    inline-size: var(--control-height);
    block-size: var(--leading-menu);
    margin-inline-start: calc((var(--icon-inline) - var(--control-height)) / 2);
  }
  .sync-check { cursor: pointer; }
  .sync-check:has(input:disabled) { cursor: default; opacity: var(--control-disabled-opacity); }
  .sync-check input {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }
  .check-mark {
    display: grid;
    place-items: center;
    inline-size: var(--icon-inline);
    block-size: var(--icon-inline);
    border: var(--menu-rule-width) solid var(--quiet);
    border-radius: var(--segment-inset);
    pointer-events: none;
  }
  .check-mark :global(svg) { visibility: hidden; }
  input:checked + .check-mark { color: var(--ink); border-color: var(--muted); background: var(--control-hover-fill); }
  input:checked + .check-mark :global(svg) { visibility: visible; }
  input:not(:disabled):is(:hover, :focus-visible) + .check-mark { border-color: var(--ink); }
  input:focus-visible + .check-mark { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (forced-colors: active) {
    .check-mark { display: none; }
    .sync-check input { position: static; inline-size: var(--icon-inline); block-size: var(--icon-inline); opacity: 1; }
  }
</style>
