<script lang="ts">
  import { useRetention } from '#lib/ui/retention.js';
  import Field from '#lib/ui/components/Field.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import { message } from '#lib/ui/client.js';
  import { useClient, reportFailure } from '#lib/ui/client-context.js';
  import { createOperation } from '#lib/ui/operation.svelte.js';

  let { workId, title, partyAllowed = false, open = $bindable(false) }: {
    workId: string; title: string; partyAllowed?: boolean; open?: boolean;
  } = $props();
  const operation = createOperation(useRetention());
  const {api,change}=useClient();
  let generation=0;
  let date = $state(''), party = $state(false), friendsError = $state('');
  let friends = $state.raw<{ userId: string; username: string }[]>([]), selected = $state<string[]>([]);
  $effect(() => {
    if (!open) return;
    workId;
    date = ''; party = false; selected = []; friends = []; friendsError = ''; operation.error = '';
    generation++;
    return()=>{generation++;};
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
    const current=generation;
    void operation.run(async () => {
      try{await change('planning', { workId, startsAt: new Date(date).toISOString(), party: partyAllowed && party, friends: partyAllowed && party ? selected : [] });}
      catch(cause){if(current===generation)throw cause;return false;}
      if(current===generation)open = false;
    });
  }
  reportFailure(()=>friendsError || operation.error);
</script>

<Dialog bind:open title={`Plan · ${title}`}>
  <form class="stack" onsubmit={save}>
    <Field label="Date and time"><input type="datetime-local" bind:value={date} required /></Field>
    {#if partyAllowed}<label class="check"><input type="checkbox" bind:checked={party} />Plan a party</label>{/if}
    {#if party}
      <fieldset class="stack">
        <legend>Friends</legend>
        {#each friends as friend}<label class="check"><input type="checkbox" bind:group={selected} value={friend.userId} />{friend.username}</label>{/each}
      </fieldset>

    {/if}

    <Button type="submit" disabled={operation.busy}>Save</Button>
  </form>
</Dialog>
