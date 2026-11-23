<script lang="ts">
  import { onDestroy } from 'svelte';
  import { subtitleLanguages, type SubtitleOptions, type SubtitleTrack } from '#lib/playback/subtitles.js';
  import type { SubtitleControls } from '#lib/playback/subtitle-controls.svelte.js';
  import Button from './Button.svelte';

  let { controls, tracks, selected, search = true, disabled = false, onselect }: {
    controls: SubtitleControls; tracks?: SubtitleTrack[]; selected?: number; search?: boolean; disabled?: boolean;
    onselect: (index: number, options?: SubtitleOptions) => void;
  } = $props();
  const installed = $derived(tracks ?? controls.options.data?.tracks ?? []);
  const preferred = $derived(subtitleLanguages.find(language => language.code === controls.options.data?.preferred));
  const remaining = $derived(subtitleLanguages.filter(language => language !== preferred));
  const canSelect = $derived(tracks !== undefined || !!controls.options.data?.source);
  onDestroy(() => controls.closeMenu());
  function select(index: number) {
    onselect(index, controls.options.data ?? undefined);
  }
</script>

{#snippet languageRow(language: typeof subtitleLanguages[number])}
  <Button menu label={language.label} panel submenuIcon="search" openOnHover={false}
    onopen={() => controls.openLanguage(language.code)} onclose={() => controls.closeLanguage(language.code)}>
    {#if controls.language !== language.code || controls.results.busy}
      <div class="menu-label" role="status">Searching OpenSubtitles…</div>
    {:else if controls.results.error}
      <div class="menu-label" role="status">Subtitle search unavailable</div>
    {:else if controls.results.data?.length}
      {#each controls.results.data.slice(0, 5) as result (result.id)}
        {@const active = controls.chosen?.id === result.id && controls.chosen.index === selected}
        <Button item selection="radio" checked={active}
          keepOpen disabled={!!controls.downloading || active} onclick={() => void controls.download(result)}>
          <span class="release menu-row-copy"><span>{result.name}</span>
            <small>{controls.downloading === result.id ? 'Downloading…' : [result.exact ? 'Exact match' : '', result.sdh ? 'SDH' : '', result.forced ? 'Forced' : ''].filter(Boolean).join(' · ')}</small>
          </span>
        </Button>
      {/each}
    {:else if controls.results.data}
      <div class="menu-label" role="status">No subtitles found</div>
    {/if}
    {#if controls.language === language.code && !controls.results.busy}
      {#if controls.results.error || controls.results.data}<div class="menu-divider" role="separator"></div>{/if}
      <Button item icon="search" onclick={() => controls.openAdvanced(language.code)}>Advanced search…</Button>
    {/if}
  </Button>
{/snippet}

<Button menu label="Subtitles" icon="subtitles" panel upward {disabled}
  disabledReason="No subtitle tracks available."
  onopen={() => { if (tracks === undefined) void controls.openOptions(); }} onclose={controls.closeMenu}>
  {#if controls.options.busy && tracks === undefined}
    <div class="menu-label" role="status">Loading subtitles…</div>
  {:else if controls.options.error && tracks === undefined}
    <div class="menu-label" role="status">Subtitle tracks unavailable</div>
  {:else}
    <Button item selection="radio" checked={selected === -1} keepOpen disabled={!canSelect} onclick={() => select(-1)}>Off</Button>
    {#each installed as track (track.index)}
      <Button item selection="radio" checked={selected === track.index} keepOpen onclick={() => select(track.index)}>{track.label}</Button>
    {/each}
  {/if}
  {#if search}
    <div class="menu-divider" role="separator"></div>
    <Button menu label="Find more" icon="search" panel onopen={() => void controls.openOptions()} onclose={controls.closeMenu}>
      {#if controls.options.busy}
        <div class="menu-label" role="status">Loading subtitle languages…</div>
      {:else if controls.options.error}
        <div class="menu-label" role="status">Subtitle search unavailable</div>
      {:else if controls.options.data?.scope}
        {#if preferred}
          {@render languageRow(preferred)}
          <div class="menu-divider" role="separator"></div>
        {/if}
        {#each remaining as language (language.code)}{@render languageRow(language)}{/each}
      {:else if controls.options.data?.unavailable}
        <div class="menu-label">{controls.options.data.unavailable}</div>
      {/if}
    </Button>
  {/if}
</Button>

<style>
  .release > span { overflow: hidden; text-overflow: ellipsis; }
  .release small:empty { display: none; }
</style>
