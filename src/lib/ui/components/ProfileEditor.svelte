<script lang="ts">
  import FormActions from './FormActions.svelte';
  import Field from './Field.svelte';
  import RowFeedback from './RowFeedback.svelte';
  import { createOperation } from '$lib/ui/operation.svelte';
  import type { ProfileSettings } from '$lib/server/db/schema';
  import { useClient } from '$lib/ui/client-context';
  import AvatarPicker from './AvatarPicker.svelte';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';

  const { api, change } = useClient();
  const operation = createOperation();
  const busy = $derived(operation.busy);

  let {
    open = $bindable(false),
    profile,
    username,
  }: { open: boolean; profile: ProfileSettings; username: string } = $props();
  let displayName = $state(''),
    bio = $state(''),
    avatar = $state<string | null>(null),
    error = $state(''),

    reading = $state(false);
  let iconChoices=$state<{id:string;provider:string;name:string}[]>([]);
  $effect(() => {
    if (open) {
      displayName = profile.displayName ?? '';
      bio = profile.bio ?? '';
      avatar = profile.avatar ?? null;
      error = '';iconChoices=[];
      const controller=new AbortController();
      void api<typeof iconChoices>('profile/avatars',undefined,'GET',{signal:controller.signal}).then(choices=>{if(!controller.signal.aborted)iconChoices=choices;}).catch(()=>{});
      return ()=>{controller.abort();};
    }
  });
  async function save() {
    if (busy) return;

    error = '';
    const completed = await operation.run(async () => {
      await change('profile', { action: 'edit', displayName, bio, avatar });
      open = false;
    });
    if (!completed) error = operation.error;
  }
</script>

<Dialog bind:open title="Edit profile">
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    {#if error}<RowFeedback error={error} tag="p" class="notice error" />{/if}
    {#if open}<AvatarPicker bind:avatar bind:reading name={displayName || username} disabled={busy} choices={iconChoices} />{/if}
    <Field label="Display name" class=""><input
        bind:value={displayName}
        maxlength="60"
        placeholder={username}
        autocomplete="nickname"
      /></Field>
    <Field label="Bio" class=""><textarea
        bind:value={bio}
        maxlength="240"
        rows="3"
        placeholder="A little about your taste in stories."
      ></textarea></Field>
    <p class="small">{bio.length}/240</p>
    <FormActions cancel={() => open = false}>
      <Button type="submit" disabled={busy || reading}>{reading ? 'Preparing avatar…' : busy ? 'Saving…' : 'Save profile'}</Button>
    </FormActions>
  </form>
</Dialog>

<style>
 textarea {width:100%;resize:vertical;}
</style>
