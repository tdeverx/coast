<script lang="ts">
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { reportFailure } from '#lib/ui/client-context.js';
  import Brand from '#lib/ui/components/Brand.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import AccountFields from '#lib/ui/components/AccountFields.svelte';
  import type { ActionData } from './$types';

  let {form} = $props();
  type Verified = NonNullable<Extract<NonNullable<ActionData>,{invite:unknown}>['invite']>;
  let verified = $state<Verified|null>(null);
  let code = $state('');
  let busy = $state(false);
  let codeForm = $state<HTMLFormElement>();
  const invite = $derived(form && 'invite' in form ? form.invite ?? verified : verified);

  onMount(() => {
    const codeFromLink = new URLSearchParams(location.hash.slice(1)).get('invite');
    if (!codeFromLink) return;
    const url = new URL(location.href);
    url.hash = '';
    replaceState(url,history.state);
    const input = codeForm?.elements.namedItem('code');
    if (input instanceof HTMLInputElement) {
      code = codeFromLink;
      input.value = codeFromLink;
      codeForm?.requestSubmit();
    }
  });
  reportFailure(() => form && 'error' in form ? form.error : '');
</script>

<svelte:head><title>Join Coast by invitation</title></svelte:head>
<div class="auth-page">
  <div class="auth-card">
    <div class="row brand"><Brand /></div>
    <h1>Join Coast.</h1>
    {#if invite}
      <p>{invite.inviter ? `${invite.inviter} invited you to Coast.` : 'Your invitation is ready.'}</p>
      {#if invite.preset || invite.server || invite.libraryOnly || invite.membershipDays}
        <ul>
          {#if invite.preset}<li>{invite.preset}</li>{/if}
          {#if invite.server}<li>Jellyfin access on {invite.server}</li>{/if}
          {#if invite.libraryOnly}<li>Browse the libraries assigned to your account</li>{/if}
          {#if invite.membershipDays}<li>{invite.membershipDays} days of membership</li>{/if}
        </ul>
      {/if}
      <form method="POST" action="?/claim" class="stack" use:enhance={() => {
        verified = invite; busy = true;
        return async ({update}) => { try {await update({reset:false});} finally {busy=false;} };
      }}>
        <input name="code" type="hidden" value={invite.code} />
        <AccountFields />
        {#if invite.account === 'choice'}<label class="row"><input type="checkbox" name="existingJellyfin" /> Connect an existing Jellyfin account</label>{/if}
        {#if invite.inviter}<label class="row"><input type="checkbox" name="addInviter" checked /> Add {invite.inviter} as a friend</label>{/if}
        <Button type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</Button>
        <a href="/invite">Use a different code</a>
      </form>
    {:else}
      <form bind:this={codeForm} method="POST" action="?/verify" class="stack" use:enhance={() => {
        busy = true;
        return async ({update}) => { try {await update();} finally {busy=false;} };
      }}>
        <label class="field">Invite code<input name="code" bind:value={code} required maxlength="43" autocomplete="off" /></label>
        <Button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</Button>
      </form>
    {/if}
    <div class="auth-footer"><a href="/login">Already have an account? Sign in</a></div>
  </div>
</div>
