<script lang="ts">
  import Button from '$lib/ui/components/Button.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import { change, message, api } from '$lib/ui/client';
  import { createOperation } from '$lib/ui/operation.svelte';

  let { workId, title, partyAllowed = false, open = $bindable(false) }: {
    workId: string; title: string; partyAllowed?: boolean; open?: boolean;
  } = $props();
  const operation = createOperation();
  let date = $state(''), party = $state(false), friendsError = $state('');
  let friends = $state.raw<{ userId: string; username: string }[]>([]), selected = $state<string[]>([]);
  $effect(() => {
    if (!open) return;
    workId;
    date = ''; party = false; selected = []; friends = []; friendsError = ''; operation.error = '';
  });
  $effect(() => {
    if (!open || !partyAllowed || !party) return;
    const controller = new AbortController();
    void api<typeof friends>('social/friends?state=accepted', undefined, 'GET', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) friends = value; })
      .catch(cause => { if (!controller.signal.aborted) friendsError = message(cause); });
    return () => controller.abort();
  });
  function save(event: SubmitEvent) {
    event.preventDefault();
    void operation.run(async () => {
      await change('planning', { workId, startsAt: new Date(date).toISOString(), party: partyAllowed && party, friends: partyAllowed && party ? selected : [] });
      open = false;
    });
  }
</script>

<Dialog bind:open title={`Plan · ${title}`}>
  <form class="stack" onsubmit={save}>
    <label class="field">Date and time<input type="datetime-local" bind:value={date} required /></label>
    {#if partyAllowed}<label class="check"><input type="checkbox" bind:checked={party} />Plan a party</label>{/if}
    {#if party}
      <fieldset class="stack">
        <legend>Friends</legend>
        {#each friends as friend}<label class="check"><input type="checkbox" bind:group={selected} value={friend.userId} />{friend.username}</label>{/each}
      </fieldset>
      {#if friendsError}<p class="notice error" role="alert">{friendsError}</p>{/if}
    {/if}
    {#if operation.error}<p class="notice error" role="alert">{operation.error}</p>{/if}
    <Button type="submit" disabled={operation.busy}>Save</Button>
  </form>
</Dialog>
