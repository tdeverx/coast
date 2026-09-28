<script lang="ts">
  import type { MediaRowStyle } from '$lib/ui/types';
  import type { Snippet } from 'svelte';
  import { mediaCategories } from '$lib/media/model';
  import { journalGroups, type JournalEntry } from '$lib/profile/journal';
  import RowTitle from './RowTitle.svelte';
  import ContentRow from './ContentRow.svelte';
  import MediaCard from './MediaCard.svelte';
  let {
    items,
    today,
    layout = 'row',
    preview,
    selection,
  }: {
    items: JournalEntry[];
    selection?: {
      checked: (id: string) => boolean;
      toggle: (id: string) => void;
      disabled?: boolean;
    };
    today: string;
    layout?: 'row' | 'grid';
    preview?: { href: string; filters: Snippet };
  } = $props();
  const groups = $derived(journalGroups(items));
  const visibleGroups = $derived(
    preview && !groups.length ? [{ date: 'unknown', count: 0, runs: [] }] : groups
  );
  const previewTitle = (date: string) =>
    date === today
      ? 'Today'
      : date === new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
        ? 'Yesterday'
        : 'Activity';
  const time = (value: string) =>
    new Date(value).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
  const dayLabel = (date: string) =>
    date === 'unknown'
      ? 'Date unknown'
      : date === today
        ? 'Today'
        : date === new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
          ? 'Yesterday'
          : new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            });
  const sourceLabel = (source: string, category: keyof typeof mediaCategories = 'screen') =>
    source === 'playback'
      ? `${mediaCategories[category].completed} in Coast`
      : source.startsWith('coast')
        ? 'Recorded in Coast'
        : source === 'trakt'
          ? 'Imported from Trakt'
          : source === 'jellyfin'
            ? 'Imported from Jellyfin'
            : 'Imported activity';
</script>

{#snippet entry(item: JournalEntry, style: MediaRowStyle)}<div class="entry">
    <MediaCard {item} {...style} />
    {#if selection}<label class="check"
        ><input
          type="checkbox"
          checked={selection.checked(item.eventId)}
          disabled={selection.disabled}
          onchange={() => selection?.toggle(item.eventId)}
        />Select {item.captionSubtitle || item.title}</label
      >{/if}
    <p class="entry-note">
      {#if item.action === 'unwatch'}Marked unwatched ·
      {:else if item.action === 'progress'}Progress updated{item.positionSeconds != null
          ? ` · ${Math.floor(item.positionSeconds / 60)} min`
          : ''} ·
      {/if}
      {#if item.applied === false}Pending review ·
      {/if}
      {#if item.dateKnown !== false}<time datetime={item.watchedAt}>{time(item.watchedAt)} UTC</time
        >{:else}Date unknown{/if} · {item.action &&
      item.action !== 'watch' &&
      item.source === 'playback'
        ? 'Playback in Coast'
        : sourceLabel(item.source, item.category ?? 'screen')}{#if item.rewatched}<span
          class="rewatch">{mediaCategories[item.category ?? 'screen'].repeat}</span
        >{/if}
    </p>
  </div>{/snippet}
<div class="journal">
  {#each visibleGroups as group}<ContentRow
      title={preview ? previewTitle(group.date) : `${dayLabel(group.date)} activity`}
      href={preview?.href}
      controls={preview?.filters}
      preserveHeight={!!preview}
      size="fanart"
      {layout}
    >
      {#snippet heading()}{#if preview}<RowTitle
            title={previewTitle(group.date)}
            href={preview.href}
          />{:else}<h3>{dayLabel(group.date)}</h3>
          <span class="small muted">{group.count} {group.count === 1 ? 'entry' : 'entries'}</span
          >{/if}{/snippet}
      {#snippet children(style)}
        {#each group.runs as run (run[0].eventId)}
          {#if selection}{#each run as item (item.eventId)}{@render entry(
                item,
                style
              )}{/each}{:else if run.length === 1}{@render entry(run[0], style)}{:else}<div
              class="episode-run"
            >
              <MediaCard
                item={{
                  ...run[0],
                  captionSubtitle: `${run.length} episodes · ${run[0].dateKnown === false ? 'Date unknown' : `${time(run.at(-1)!.watchedAt)}–${time(run[0].watchedAt)} UTC`}`,
                }}
                {...style}
              />
              <details>
                <summary>Show {run.length} episodes</summary>
                <div class="episode-list">
                  {#each run as item (item.eventId)}<a href={`/media/${item.id}`}
                      ><span>{item.captionSubtitle || item.title}</span><small
                        >{item.dateKnown === false ? 'Date unknown' : `${time(item.watchedAt)} UTC`} ·
                        {sourceLabel(item.source, item.category ?? 'screen')}{item.rewatched
                          ? ' · Rewatch'
                          : ''}</small
                      ></a
                    >{/each}
                </div>
              </details>
            </div>{/if}
        {/each}
      {/snippet}
    </ContentRow>{/each}
</div>

<style>
  .journal {
    min-width: 0;
  }
  .journal :global(.content-row:first-child) {
    margin-top: 0;
  }
  .episode-run {
    min-width: 0;
  }
  details {
    margin-top: 10px;
    font-size: 12px;
    color: var(--muted);
  }
  summary {
    cursor: pointer;
    padding-block: 4px;
  }
  .episode-list {
    display: grid;
    gap: 12px;
    margin-top: 14px;
  }
  .episode-list a {
    display: grid;
    gap: 4px;
  }
  .episode-list small {
    font-size: 11px;
    color: var(--quiet);
  }
  .rewatch {
    margin-left: 8px;
    color: var(--muted);
  }
  .entry {
    min-width: 0;
  }
  .entry-note {
    font-size: 12px;
    color: var(--quiet);
    margin-top: 6px;
  }
</style>
