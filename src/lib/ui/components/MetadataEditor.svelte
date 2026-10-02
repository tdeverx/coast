<script lang="ts">
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';

  const { api, change } = useClient();

  type MetadataFields = {
    title?: string | null;
    overview?: string | null;
    posterPath?: string | null;
    backdropPath?: string | null;
  };
  type MetadataResponse = {
    override?: MetadataFields | null;
    preference?: MetadataFields | null;
    locks?: string[];
    snapshots?: { provider: string; updatedAt: string }[];
  };
  let {
    open = $bindable(false),
    mediaId,
    admin = false,
  }: { open: boolean; mediaId: string; admin?: boolean } = $props();
  let loadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle'),
    busy = $state(false),
    error = $state(''),
    title = $state(''),
    overview = $state(''),
    poster = $state(''),
    backdrop = $state(''),
    locks = $state<string[]>([]),
    sources = $state<{ provider: string; updatedAt: string }[]>([]);
  const endpoint = $derived(`media/${mediaId}/${admin ? 'metadata' : 'presentation'}`);
  let generation = 0;
  async function load() {
    const token = ++generation;
    loadState = 'loading';
    error = '';
    try {
      const data = await api<MetadataResponse>(endpoint, undefined, 'GET');
      if (token !== generation) return;
      const values = admin ? data.override : data.preference;
      title = values?.title ?? '';
      overview = values?.overview ?? '';
      poster = values?.posterPath ?? '';
      backdrop = values?.backdropPath ?? '';
      locks = data.locks ?? [];
      sources = data.snapshots ?? [];
      loadState = 'ready';
    } catch (e) {
      if (token === generation) {
        error = message(e);
        loadState = 'error';
      }
    }
  }
  $effect(() => {
    if (open) {
      endpoint;
      void load();
    }
    return () => {
      generation++;
    };
  });
  async function save() {
    busy = true;
    error = '';
    try {
      await change(
        endpoint,
        admin
          ? {
              values: {
                title: title || null,
                overview: overview || null,
                posterPath: poster || null,
                backdropPath: backdrop || null,
              },
              locks,
            }
          : { title: title || null, posterPath: poster || null, backdropPath: backdrop || null }
      );
      open = false;
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title={admin ? 'Shared metadata' : 'Your presentation preferences'}
  ><form
    class="stack"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <p class="small">
      {admin
        ? 'Overrides stay separate from provider snapshots. Lock a field to prevent user presentation preferences from replacing it.'
        : 'These preferences apply only to you. Administrator field locks take precedence.'}
    </p>
    {#if error}<div class="notice error" role="alert">
        {error}
      </div>{/if}{#if loadState !== 'loading' && loadState !== 'ready'}<Button
        variant="secondary"
        onclick={load}>Try again</Button
      >{/if}
    <fieldset
      aria-busy={loadState === 'loading'}
      class="stack"
      disabled={loadState !== 'ready' || busy}
    >
      <label class="field"
        >Preferred title<input
          disabled={!admin && locks.includes('title')}
          bind:value={title}
          placeholder="Use provider title"
        /></label
      >{#if admin}<label class="check"
          ><input type="checkbox" bind:group={locks} value="title" />Lock title</label
        ><label class="field"
          >Overview<textarea rows="4" bind:value={overview} placeholder="Use provider overview"
          ></textarea></label
        >{/if}<label class="field"
        >Poster URL<input
          disabled={!admin && locks.includes('posterPath')}
          type="url"
          bind:value={poster}
          placeholder="https://…"
        /></label
      >{#if admin}<label class="check"
          ><input type="checkbox" bind:group={locks} value="posterPath" />Lock poster</label
        >{/if}<label class="field"
        >Backdrop URL<input
          disabled={!admin && locks.includes('backdropPath')}
          type="url"
          bind:value={backdrop}
          placeholder="https://…"
        /></label
      >{#if admin}<label class="check"
          ><input type="checkbox" bind:group={locks} value="backdropPath" />Lock backdrop</label
        >{#if sources.length}<div>
            <h3>Provider snapshots</h3>
            {#each sources as source}<p class="small" style="margin-top:8px">
                {source.provider} · {new Date(source.updatedAt).toLocaleDateString()}
              </p>{/each}
          </div>{/if}{/if}<Button type="submit" disabled={busy}
        >{busy ? 'Saving…' : 'Save preferences'}</Button
      >{#if !admin}<Button
          variant="ghost"
          onclick={async () => {
            try {
              await change(`media/${mediaId}/presentation`, {}, 'DELETE');
              open = false;
            } catch (e) {
              error = message(e);
            }
          }}>Reset to shared metadata</Button
        >{/if}
    </fieldset>
  </form></Dialog
>

<style>
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
</style>
