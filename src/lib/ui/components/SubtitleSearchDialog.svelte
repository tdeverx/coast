<script lang="ts">
  import type { SubtitleControls } from '#lib/playback/subtitle-controls.svelte.js';
  import { subtitleLanguages } from '#lib/playback/subtitles.js';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Field from './Field.svelte';
  let { controls, title, selected }: { controls: SubtitleControls; title: string; selected?: number } = $props();
  let filter = $state(''), exact = $state(false), fullDialogue = $state(false);
  const matches = $derived((controls.results.data ?? []).filter(result =>
    (!exact || result.exact) && (!fullDialogue || !result.forced) && result.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())));
</script>

<Dialog open={controls.advanced} title="Find subtitles" wide onclose={controls.closeAdvanced}>
  <p>{title}{controls.options.data?.version ? ` · ${controls.options.data.version}` : ''}</p>
  <div class="fields">
    <Field label="Language"><select value={controls.language} onchange={event => controls.openLanguage(event.currentTarget.value)}>
      {#each subtitleLanguages as language (language.code)}<option value={language.code}>{language.label}</option>{/each}
    </select></Field>
    <Field label="Filter releases"><input type="search" bind:value={filter} /></Field>
    <label class="check"><input type="checkbox" bind:checked={exact} />Exact matches only</label>
    <label class="check"><input type="checkbox" bind:checked={fullDialogue} />Hide forced tracks</label>
  </div>
  {#if controls.results.busy}<p class="quiet" role="status">Searching OpenSubtitles…</p>
  {:else if controls.results.error}<p class="quiet" role="status">Subtitle search unavailable</p>
  {:else if !matches.length}<p class="quiet" role="status">No subtitles found</p>
  {:else}
    <ul class="results">
      {#each matches as result (result.id)}
        {@const active = controls.chosen?.id === result.id && controls.chosen.index === selected}
        <li><div class="row-text-stack"><strong>{result.name}</strong>
          <small>{[result.format?.toUpperCase(), result.exact ? 'Exact match' : '', result.sdh ? 'SDH' : '', result.forced ? 'Forced' : '', result.translated ? 'Machine translated' : '', result.downloads ? `${result.downloads.toLocaleString()} downloads` : ''].filter(Boolean).join(' · ')}</small></div>
          <Button icon={active ? 'check' : 'download'} emphasis="subtle" disabled={!!controls.downloading || active}
            onclick={() => void controls.download(result)}>{active ? 'Selected' : controls.downloading === result.id ? 'Downloading…' : 'Download'}</Button>
        </li>
      {/each}
    </ul>
  {/if}
</Dialog>

<style>
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 12px; }
  .results { margin: 0; padding: 0; list-style: none; }
  .results li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-block-start: 1px solid var(--line); }
  .results li > div { overflow-wrap: anywhere; }
  .results small { color: var(--muted); }
</style>
