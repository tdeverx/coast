<script lang="ts">
  import { tick } from 'svelte';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
  import InviterField from './InviterField.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Field, { type FieldValidation } from '#lib/ui/components/Field.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  import AuthSurface from './AuthSurface.svelte';

  let { value, onchange, validation, detail, inviter, inviterProfile, inviterAvatar, interactive = true }: {
    value: string; onchange: (value: string) => void; validation: FieldValidation; detail?: string; inviter?: string | null; inviterProfile?: string | null; inviterAvatar?: string | null; interactive?: boolean;
  } = $props();
  let input = $state<HTMLInputElement>();
  const accepted = $derived(validation.state === 'verified');
  async function clear() {
    onchange('');
    await tick();
    input?.focus({preventScroll:true});
  }
</script>

<div class="invite-fields">
  <InviterField name={accepted ? inviter : null} avatar={inviterAvatar} profile={inviterProfile} hydrated={interactive}>
    <AuthSurface invite={accepted}>
      <div class="auth-action-frame">
        <Field label="Invite code" hideLabel class="menu-row" {validation}
          requirements={[{icon:'shield',label:'Invite verification',detail:detail || validation.message,met:accepted ? true : validation.state === 'invalid' ? false : undefined}]}>
          <Icon name="ticket"/>
          {#if accepted && interactive}
            <span class="accepted-title">Code accepted</span>
          {:else}
            <input bind:this={input} name="code" {value} oninput={e => onchange(e.currentTarget.value.trim())}
              placeholder="Invite code" required maxlength="43" autocomplete="off" aria-invalid={validation.state === 'invalid' || undefined}/>
          {/if}
        </Field>
        {#if accepted && interactive}
          <input type="hidden" name="code" {value}/>
          <div class="auth-side-action centered"><Button size="icon" emphasis="subtle" icon="minusCircle" danger label="Remove invite code" title="Remove invite code" onclick={clear}/></div>
        {/if}
      </div>
    </AuthSurface>
  </InviterField>
  <div class="invite-spacer" aria-hidden="true">
    <AuthSurface anchor>
      <div class="glass spacer-pill" use:liquidGlass={{ variant: 'clear' }}></div>
    </AuthSurface>
  </div>
</div>

<style>
  .invite-fields :global(.credential-fields.expanded .credential-fields.invite .auth-side-action) {
    margin-inline-start: calc(2 * var(--menu-frame-inset));
  }
  .invite-spacer {
    display: flex;
    justify-content: center;
    margin-block-start: var(--auth-gap);
  }
  .spacer-pill {
    inline-size: 32px;
    block-size: var(--auth-action-gap);
    border-radius: var(--glass-surface-radius);
  }
  .accepted-title { padding-inline-end: var(--control-height); }
</style>
