<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
 import {deserialize, enhance} from '$app/forms';
 import { safeParse } from 'valibot';
 import { inviteCode as inviteCodeSchema } from '#lib/auth/invites.js';
 import type { Snippet } from 'svelte';
 import AccountFields from '#lib/ui/components/AccountFields.svelte';
 import Button from '#lib/ui/components/Button.svelte';
 import type { FieldValidation } from '#lib/ui/components/Field.svelte';
 import Icon from '#lib/ui/components/Icon.svelte';
 import InviteCodeField from '#lib/auth/ui/InviteCodeField.svelte';
 import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
 import { slideFade } from '#lib/ui/slide-fade.js';
 import LoginBackdrop from '#lib/auth/ui/LoginBackdrop.svelte';
 import OnboardingPreview from './OnboardingPreview.svelte';
 import SegmentPanels from '#lib/auth/ui/SegmentPanels.svelte';
 import type { PageProps } from './$types';
 let {data,form}:PageProps=$props();let busy=$state(false);
 let signInReady = $state(false);
 const registrationDefaults = { username: 'coast_preview', password: 'PreviewOnly!' };
 let enteredInvite = $derived(data.previewInviteCode);
 let inviteResult = $state<(FieldValidation & { code: string })>();
 let selectedMode = $state<'login' | 'register'>();
 let pointerField = $state<HTMLInputElement>();
 let registration = $derived(data.registrationMode);
 let provider = $derived(data.registrationProvider);
 let allowTrakt = $derived(data.enableTrakt);
 let jellyfinAvailable = $state(true);
 let allowCustomJellyfinUrl = $derived(data.allowCustomJellyfinUrl);
 let inviteAccount = $state<'coast' | 'managed' | 'choice' | 'library'>('coast');
 let loginResult = $state('rejected');
 let nextImport = $state<'success' | 'failure' | 'reconnect'>('success');
 const mode = $derived(selectedMode ?? form?.mode ?? 'login');
 const registering = $derived(mode === 'register');
 const invited = $derived(registering && registration === 'invite');
 const inviteKind = $derived(invited ? inviteAccount : 'coast');
 const managed = $derived(inviteKind === 'managed' || inviteKind === 'library');
 const customJellyfinUrl = $derived(allowCustomJellyfinUrl && inviteKind === 'coast');
 const requiredProvider = $derived(inviteKind === 'coast' ? provider : 'jellyfin');
 const promptForJellyfin = $derived(!managed && (!invited || requiredProvider === 'jellyfin' || requiredProvider === 'either'));
 const onboarding = $derived(form?.onboarding && {
   name: form.onboarding.name, jellyfinChoice: inviteKind === 'choice', jellyfinAvailable,
   libraryOnly: inviteKind === 'library', managed, requiredProvider,
   showJellyfin: inviteKind === 'choice' || (promptForJellyfin && (jellyfinAvailable || customJellyfinUrl)), customJellyfinUrl, showTrakt: allowTrakt && inviteKind !== 'library',
 });
 const inviteRequired = $derived(!onboarding && registering && registration === 'invite');
 const inviteValue = $derived(enteredInvite.trim());
 const inviteFormat = $derived(safeParse(inviteCodeSchema, inviteValue));
 const inviteLocked = $derived(inviteRequired && (inviteResult?.code !== inviteValue || inviteResult.state !== 'verified'));
 const inviteStatus = $derived.by<FieldValidation>(() => {
   if (!inviteValue) return { state: 'info', message: 'Enter your invite code to unlock the account fields.' };
   if (!inviteFormat.success) return { state: 'invalid', message: 'Paste the full code from your invitation.' };
   if (inviteResult?.code === inviteValue) return inviteResult;
   return { state: 'pending', message: 'Checking the invite code.' };
 });

 $effect(() => {
   if (!inviteRequired) {
     enteredInvite = data.previewInviteCode;
     inviteResult = undefined;
     return;
   }
   if (!inviteFormat.success) return;
   const code = inviteFormat.output;
   const controller = new AbortController();
   inviteResult = { code, state: 'pending', message: 'Checking the invite code.' };
   const timer = window.setTimeout(async () => {
     const body = new FormData();
     body.set('code', code);
     try {
       const response = await fetch('?/verifyInvite', {
         method: 'POST', body, signal: controller.signal,
         headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
       });
       const result = deserialize(await response.text());
       if (controller.signal.aborted) return;
       if (result.type === 'success' && result.data?.inviteValid === true) {
         inviteResult = { code, state: 'verified', message: 'Invite code verified.' };
       } else {
         const message = result.type === 'failure' && typeof result.data?.inviteError === 'string' ? result.data.inviteError : 'Could not verify the invite code.';
         inviteResult = { code, state: 'invalid', message };
       }
     } catch {
       if (!controller.signal.aborted) inviteResult = { code, state: 'invalid', message: 'Could not verify the invite code.' };
     }
   }, 300);
   return () => {
     window.clearTimeout(timer);
     controller.abort();
   };
 });
  reportFailure(()=>form?.error);

 function returnToLogin() {
   selectedMode = 'login';
   form = null;
 }
</script>
<svelte:head><title>{onboarding ? 'Set up your account · Coast' : registering ? 'Sign up · Coast' : 'Sign in · Coast'}</title></svelte:head>
<svelte:window onkeydown={event => { if (event.key === 'Tab') pointerField = undefined; }} />
<div class="auth-page">
<LoginBackdrop artwork={data.artwork}>
{#snippet children(sample)}
{#snippet fieldGroup(rows: Snippet)}
  <AuthSurface>{@render rows()}</AuthSurface>
{/snippet}

<details class="preview-settings">
  <summary><Icon name="sliders" size={16} />Preview settings</summary>
  <fieldset disabled={busy}>
    <div class="setting"><label for="preview-registration">Registration</label><select id="preview-registration" bind:value={registration}><option value="invite">Invite only</option><option value="open">Open</option></select></div>
    <div class="setting"><label for="preview-provider">Required connection</label><select id="preview-provider" bind:value={provider}><option value="none">None</option><option value="jellyfin">Jellyfin</option><option value="trakt">Trakt</option><option value="either">Jellyfin or Trakt</option></select></div>
    <div class="setting"><label for="preview-invite-account">Invite account</label><select id="preview-invite-account" bind:value={inviteAccount} disabled={registration !== 'invite'}><option value="coast">Coast account</option><option value="managed">Managed Jellyfin</option><option value="choice">New or existing Jellyfin</option><option value="library">Library only</option></select></div>
    <div class="setting"><label for="preview-login-result">Sign-in result</label><select id="preview-login-result" bind:value={loginResult}><option value="rejected">Rejected</option><option value="pending">Needs onboarding</option><option value="returning">Returning account</option><option value="library">Library-only account</option></select></div>
    <div class="setting"><label for="preview-import-result">Next import</label><select id="preview-import-result" bind:value={nextImport}><option value="success">Success</option><option value="failure">Needs retry</option><option value="reconnect">Needs reconnect</option></select></div>
    <label class="check"><input type="checkbox" bind:checked={jellyfinAvailable} />Jellyfin server available</label>
    <label class="check"><input type="checkbox" bind:checked={allowCustomJellyfinUrl} />Allow custom Jellyfin URLs</label>
    <label class="check"><input type="checkbox" bind:checked={allowTrakt} />Allow Trakt</label>
  </fieldset>
</details>
<div class="auth-card">
 {#if form?.destination}
 <div class="destination" transition:slideFade>
   <h1>{form.destination}</h1><p role="status">Preview sign-in complete.</p>
   <Button size="segment" onclick={returnToLogin}>Return to login</Button>
 </div>
 {:else}
 <SegmentPanels index={onboarding ? 1 : 0}>
 {#snippet children(screen)}
 {#if screen === 1}
   {#if onboarding}
     {#key [onboarding.libraryOnly, onboarding.jellyfinChoice, onboarding.requiredProvider, onboarding.managed, onboarding.showJellyfin, onboarding.customJellyfinUrl, onboarding.showTrakt].join('/')}
       <OnboardingPreview {invited} account={onboarding} {sample} group={fieldGroup} bind:nextImport onfinish={returnToLogin} />
     {/key}
   {/if}
 {:else}
 <h1 class="sr-only">{registering ? 'Sign up' : 'Sign in'}</h1>
 <form method="POST" action={`?/${mode}`} class="stack" data-pointer-focus={pointerField ? '' : undefined}
   onpointerdown={event => {
     const target = event.target;
     pointerField = target instanceof Element ? target.closest('label.menu-row')?.querySelector('input') ?? undefined : undefined;
   }}
   onfocusin={event => { if (event.target !== pointerField) pointerField = undefined; }}
   onfocusout={event => { if (event.target === pointerField) pointerField = undefined; }}
   use:enhance={({ cancel }) => {
   const submittedMode = mode;
   const submittedInvite = inviteValue;
   if (submittedMode === 'login' ? !signInReady : inviteLocked) {
     cancel();
     return;
   }
   busy = true;
   form = null;
   return async ({ result, update }) => {
     try {
       if (submittedMode === 'register' && inviteRequired && submittedInvite === inviteValue && result.type === 'failure' && typeof result.data?.inviteError === 'string') {
         inviteResult = { code: submittedInvite, state: 'invalid', message: result.data.inviteError };
       }
       if (mode === submittedMode) await update({ reset: false, invalidateAll: false });
     } finally {
       busy = false;
     }
   };
 }}>
  <input type="hidden" name="previewRegistration" value={registration} />
  <input type="hidden" name="previewLogin" value={loginResult} />
  <SegmentPanels vertical index={registering ? 1 : 0}>
  {#snippet children(panel)}
  {@const isRegister = panel === 1}
  <div class="account-panel" class:invite-accent={isRegister && inviteStatus.state === 'verified'}>
  <div>
    {#if isRegister && registration === 'invite'}
      <fieldset class="invite-fields" transition:slideFade
        onoutrostart={event => { event.currentTarget.disabled = true; }}
        onintrostart={event => { event.currentTarget.disabled = false; }}>
        <InviteCodeField value={enteredInvite} onchange={value => enteredInvite=value} validation={inviteStatus} inviter={data.previewInviter?.name ?? 'coast_preview_host'} inviterProfile={data.previewInviter?.profile} inviterAvatar={data.previewInviter?.avatar}/>
      </fieldset>
    {/if}
    {#snippet credentials()}
      <AccountFields menuRows progressive showDisplayName={false} {registrationDefaults} signIn={!isRegister} disabled={isRegister && inviteLocked} bind:signInReady />
    {/snippet}
    {@render fieldGroup(credentials)}
  </div>
  <div class="auth-actions">
    <AuthSurface anchor><Button size="segment" onclick={() => {
      selectedMode = isRegister ? 'login' : 'register';
      form = null;
    }}>{isRegister ? 'Sign in' : 'Sign up'}</Button></AuthSurface>
    <AuthSurface anchor><Button size="segment" type="submit" icon="arrow" label="Continue" title="Continue" disabled={busy || (isRegister ? inviteLocked : !signInReady)}/></AuthSurface>
  </div>
  </div>
  {/snippet}
  </SegmentPanels>
 </form>
 {/if}
 {/snippet}
 </SegmentPanels>
 {/if}
</div>
{/snippet}
</LoginBackdrop>
</div>

<style>
  .auth-page, .auth-card {
    position: relative;
  }
  .auth-page { grid-template-rows: auto minmax(min-content, 1fr); gap: 12px; padding-top: 12px; overflow-x: clip; }
  .preview-settings { position: relative; justify-self: start; max-width: 100%; font-size: var(--text-sm); }
  .preview-settings summary { display: flex; align-items: center; gap: 6px; width: fit-content; padding: 8px 12px; border-radius: 999px; background: var(--surface); cursor: pointer; }
  .preview-settings summary::-webkit-details-marker { display: none; }
  .preview-settings fieldset { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 8px; padding: 12px; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--menu-row-radius, 8px); }
  .preview-settings .setting { display: grid; gap: 4px; }
  .destination { display: grid; justify-items: center; gap: 12px; }
  form.stack {
    max-width: var(--auth-width);
    margin-inline: auto;
    row-gap: var(--auth-gap);
  }
  @media (forced-colors: none) {
    form[data-pointer-focus] :global(label.menu-row:has(> input:focus-visible)) {
      outline: none;
    }
  }
  .invite-fields {
    min-inline-size: 0;
    margin: 0 0 var(--auth-gap);
    padding: 0;
    border: 0;
  }
  .account-panel { display: grid; gap: var(--auth-gap); }
</style>
