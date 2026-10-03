<script lang="ts">
  import RowFeedback from './RowFeedback.svelte';
  import { createOperation } from '$lib/ui/operation.svelte';
  import Field from './Field.svelte';
  import FormActions from './FormActions.svelte';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  import { useClient } from '$lib/ui/client-context';

  const { change } = useClient();
  const operation = createOperation();
  const busy = $derived(operation.busy);

  let {
    open = $bindable(false),
    mediaId,
    title,
    note,
  }: { open: boolean; mediaId: string; title: string; note: string } = $props();
  let draft = $state(''),
    error = $state('');
  $effect(() => {
    if (open) {
      draft = note;
      error = '';
    }
  });
  async function save() {
    if (busy) return;

    error = '';
    const completed = await operation.run(async () => {
      await change('profile', { action: 'feature', mediaId, note: draft });
      open = false;
    });
    if (!completed) error = operation.error;
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
    {#if error}<RowFeedback error={error} tag="p" class="" />{/if}<Field label="Why this one?" class=""><textarea
        bind:value={draft}
        maxlength="300"
        rows="3"
        placeholder="An optional note about why this is a favourite."
      ></textarea></Field>
    <p class="small">Featured separately from your profile background.</p>
    <FormActions cancel={() => open = false}><Button type="submit" disabled={busy}>Save feature</Button></FormActions>
  </form></Dialog
>

<style>
  textarea {
    width: 100%;
    resize: vertical;
  }
</style>
