<script lang="ts">
  import { useClient } from '#lib/ui/client-context.js';
  import { message } from '#lib/ui/client.js';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Shelf from './Shelf.svelte';

  let { lists, username }: { lists: { id: string; name: string }[]; username: string } = $props();
  const { change, feedback } = useClient();
  const builtins = [
    { id: 'watchlist', name: 'Watchlist' },
    { id: 'favourites', name: 'Favourites' },
  ];
  let create = $state(false), playlist = $state(false), name = $state(''), description = $state('');
  let saving = $state(false);

  async function save() {
    if (saving) return;
    saving = true;
    try {
      await change('lists', { name, description, playlist });
      create = false;
      name = '';
      description = '';
    } catch (cause) {
      feedback.failure(message(cause));
    } finally {
      saving = false;
    }
  }
</script>

{#each builtins as list (list.id)}
  <Shelf source={{ type: 'list', view: list.id, title: list.name, profile: username }} hideEmpty={false} />
{/each}
{#each lists as list (list.id)}
  <Shelf source={{ type: 'list', view: list.id, title: list.name, custom: true, profile: username }} hideEmpty={false} />
{/each}
<div class="list-actions">
  <Button icon="plus" onclick={() => create = true}>Create list</Button>
</div>
<Dialog bind:open={create} title="Create a list">
  <form class="stack" onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <label class="field">Type<select bind:value={playlist}>
      <option value={false}>List</option>
      <option value={true}>Playlist · ordered playback</option>
    </select></label>
    <label class="field">List name<input bind:value={name} required maxlength="120" placeholder="Sunday evenings" /></label>
    <label class="field">Description<textarea bind:value={description} rows="3" maxlength="2000"></textarea></label>
    <Button type="submit" disabled={saving}>Create list</Button>
  </form>
</Dialog>

<style>
  .list-actions { margin-top: var(--gutter); }
</style>
