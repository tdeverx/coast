<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, message } from '$lib/ui/client';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  let { open = $bindable(false) }: { open: boolean } = $props();
  let title = $state(''),
    kind = $state('movie'),
    year = $state<number | undefined>(),
    busy = $state(false),
    error = $state('');
  async function save() {
    busy = true;
    try {
      const item = await api<{ id: string }>('media', { title, kind, year });
      open = false;
      await goto(`/media/${item.id}`, { invalidateAll: true });
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title="Add a title"
  ><form
    class="stack"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <p class="small">Track a title in Coast, even without a metadata service.</p>
    {#if error}<div class="notice error" role="alert">{error}</div>{/if}<label class="field"
      >Title<input bind:value={title} required maxlength="250" /></label
    ><label class="field"
      >Type<select bind:value={kind}
        ><option value="movie">Movie</option><option value="show">Series</option></select
      ></label
    ><label class="field"
      >Release year <small>Optional</small><input
        type="number"
        min="1800"
        max="2200"
        bind:value={year}
      /></label
    ><Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add to watchlist'}</Button>
  </form></Dialog
>
