<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance, deserialize, applyAction } from '$app/forms';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { safeParse } from 'valibot';
  import { inviteCode } from '#lib/auth/invites.js';
  import type { previewInvite } from '#lib/server/auth/invites.server.js';
  import { reportFailure } from '#lib/ui/client-context.js';
  import AccountFields from '#lib/ui/components/AccountFields.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import type {FieldValidation} from '#lib/ui/components/Field.svelte';
  import InviteCodeField from './InviteCodeField.svelte';
  import AuthSurface from './AuthSurface.svelte';

  type Invite = Awaited<ReturnType<typeof previewInvite>>;
  let { registering = false, gated = false, verified, error }: {
    registering?: boolean; gated?: boolean; verified?: Invite; error?: string;
  } = $props();
  let code = $state(''), checked = $state<Invite>(), failure = $state('');
  let hydrated = $state(false), busy = $state(false), signInReady = $state(false), registerReady = $state(false);
  let pointerField = $state<HTMLInputElement>();
  const needsInvite = $derived(registering && (gated || !!code));
  const invite = $derived(checked?.code === code ? checked : verified?.code === code || !hydrated ? verified : undefined);
  const locked = $derived(needsInvite && !invite);
  const status = $derived<FieldValidation>(invite ? {state:'verified',message:'Invite code verified.'}
    : !code ? {state:'info',message:'Enter your invite code to unlock the account fields.'}
    : failure ? {state:'invalid',message:failure}
    : safeParse(inviteCode,code).success ? {state:'pending',message:'Checking the invite code.'}
    : {state:'invalid',message:'Paste the full code from your invitation.'});

  const inviteDetails = $derived(invite ? [
    invite.preset,
    invite.server && 'Jellyfin access on ' + invite.server,
    invite.libraryOnly && 'Access to your assigned libraries',
    invite.membershipDays && invite.membershipDays + ' days of membership',
  ].filter(Boolean).join(' · ') : '');

  onMount(() => {
    const url = new URL(location.href);
    const linked = new URLSearchParams(url.hash.slice(1)).get('invite');
    if (linked) { url.hash = ''; void goto(url,{shallow:true,replace:true,state:page.state}); }
    code = linked ?? verified?.code ?? '';
    hydrated = true;
  });
  $effect(() => {
    const candidate = code;
    checked = undefined; failure = '';
    if (!hydrated || !needsInvite || verified?.code === candidate || !safeParse(inviteCode,candidate).success) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const body = new FormData(); body.set('code',candidate);
        const response = await fetch('/invite?/verify',{method:'POST',body,signal:controller.signal,headers:{accept:'application/json','x-sveltekit-action':'true'}});
        const result = deserialize(await response.text());
        if (controller.signal.aborted) return;
        if (result.type === 'success' && result.data?.invite) checked = result.data.invite as Invite;
        else failure = result.type === 'failure' ? String(result.data?.error ?? 'Could not verify the invitation.') : 'Could not verify the invitation.';
      } catch { if (!controller.signal.aborted) failure = 'Could not verify the invitation. Try again.'; }
    },300);
    return () => {clearTimeout(timer); controller.abort();};
  });
  reportFailure(() => error);
  const verifyOnly = $derived(!hydrated && locked);
  const next = $derived(page.url.searchParams.get('next'));
</script>

<svelte:window onkeydown={e => {if (e.key === 'Tab') pointerField = undefined;}} />
<div class="auth-stack" class:auth-with-side-actions={needsInvite} class:invite-accent={!!invite}>
  <h1 class="sr-only">{registering ? 'Sign up' : 'Sign in'}</h1>
  <form method="POST" action={verifyOnly ? '/invite?/verify' : needsInvite ? '/invite?/claim' : undefined}
    class="access-form" data-pointer-focus={pointerField ? '' : undefined}
    onpointerdown={event => {pointerField = event.target instanceof Element ? event.target.closest('label.menu-row')?.querySelector('input') ?? undefined : undefined;}}
    onfocusout={() => pointerField = undefined}
    use:enhance={({cancel}) => {
      if (busy || (registering ? locked || !registerReady : !signInReady)) {cancel();return;}
      busy = true;
      return async ({result,update}) => {
        try {
          if (result.type === 'failure' && typeof result.data?.error === 'string') {
            failure = result.data.error;
            if (failure.includes('invite code')) checked = undefined;
          }
          // /register can claim through /invite. Apply feedback to this page too.
          if (result.type === 'failure') await applyAction(result);
          else await update({reset:false});
        } finally {busy = false;}
      };
    }}>
    {#if needsInvite}
      <div class="invite-section">
        <InviteCodeField value={hydrated ? code : verified?.code ?? ''} onchange={value => code=value}
          validation={status} detail={inviteDetails} inviter={invite?.inviter} inviterProfile={invite?.inviterProfile} inviterAvatar={invite?.inviterAvatar} interactive={hydrated}/>
      </div>
    {/if}
    {#if !verifyOnly}
      <AuthSurface>
        <AccountFields menuRows progressive={hydrated} showDisplayName={false} signIn={!registering} disabled={locked} bind:signInReady bind:registerReady />
      </AuthSurface>
    {/if}
    {#if error}<p class="small" role="alert">{error}</p>{/if}
    <div class="auth-actions">
      <AuthSurface anchor><Button size="segment" href={(registering ? '/login' : '/register') + (next ? '?next=' + encodeURIComponent(next) : '')}>
        {registering ? 'Sign in' : 'Sign up'}
      </Button></AuthSurface>
      <AuthSurface anchor><Button size="segment" type="submit" icon="arrow" label={verifyOnly ? 'Verify invite' : 'Continue'} title={verifyOnly ? 'Verify invite' : 'Continue'} disabled={busy || hydrated && (registering ? locked || !registerReady : !signInReady)}/></AuthSurface>
    </div>
  </form>
</div>
<style>
  .access-form { display:grid; gap:var(--auth-gap); }
  @media (forced-colors:none) {
    form[data-pointer-focus] :global(label.menu-row:has(>input:focus-visible)) { outline:none; }
  }
</style>
