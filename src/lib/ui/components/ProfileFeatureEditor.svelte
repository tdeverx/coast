<script lang="ts">
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  import { change, message } from '$lib/ui/client';
  let {
    open = $bindable(false),
    mediaId,
    title,
    note,
  }: { open: boolean; mediaId: string; title: string; note: string } = $props();
  let draft = $state(''),
    busy = $state(false),
    error = $state('');
  $effect(() => {
    if (open) {
      draft = note;
      error = '';
    }
  });
  async function save() {
    busy = true;
    try {
      await change('profile', { action: 'feature', mediaId, note: draft });
      open = false;
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title={`Feature ${title}`}
  ><form
    class="stack"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    {#if error}<p role="alert">{error}</p>{/if}<label
      >Why this one?<textarea
        bind:value={draft}
        maxlength="300"
        rows="3"
        placeholder="An optional note about why this is a favourite."
      ></textarea></label
    >
    <p class="small">Featured separately from your profile background.</p>
    <div class="row">
      <Button type="submit" variant="primary" disabled={busy}>Save feature</Button><Button
        variant="ghost"
        onclick={() => (open = false)}>Cancel</Button
      >
    </div>
  </form></Dialog
>

<style>
  textarea {
    width: 100%;
    resize: vertical;
  }
</style>
