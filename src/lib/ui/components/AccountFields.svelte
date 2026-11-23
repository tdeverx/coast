<script lang="ts">
 import { safeParse } from 'valibot';
 import { passwordRequirements, passwordSchema, usernameRequirements } from '#lib/auth/registration.js';
 import { slideFade } from '#lib/ui/slide-fade.js';
 import Field, { type FieldValidation } from './Field.svelte';
 import Icon from './Icon.svelte';
 let { menuRows = false, progressive = false, signIn = false, disabled = false, showDisplayName = true, registrationDefaults, signInReady = $bindable(false), registerReady = $bindable(false) }: {
   menuRows?: boolean; progressive?: boolean; signIn?: boolean; disabled?: boolean; showDisplayName?: boolean; signInReady?: boolean; registerReady?: boolean;
   registrationDefaults?: { username: string; password: string };
 } = $props();
 const hintId = $props.id();
 const usernameHint = usernameRequirements.map(rule => rule.detail).join(' ');
 const passwordHint = 'Use 8 to 128 characters. Include one uppercase letter, one lowercase letter, and one symbol.';
 const fieldClass = $derived(menuRows ? 'menu-row' : 'field');
 let username = $state(''), password = $state(''), displayName = $state(''), confirmation = $state('');
 let passwordInput = $state<HTMLInputElement>(), confirmationInput = $state<HTMLInputElement>();
 const usernameReady = $derived(username.trim().length > 0 && username.length <= 32);
 const passwordLocked = $derived(disabled || (progressive && signIn && !usernameReady));
 const usernameChecks = $derived(progressive && !signIn && !disabled ? usernameRequirements.map(rule => ({
   ...rule, met: safeParse(rule.schema, username).success,
 })) : undefined);
 const usernameValid = $derived(usernameChecks?.every(rule => rule.met) === true);
 const passwordCheck = $derived(progressive && !signIn && !disabled ? safeParse(passwordSchema, password) : undefined);
 const passwordIssue = $derived(passwordCheck && !passwordCheck.success ? passwordCheck.issues[0].message : '');
 const passwordMatches = $derived(confirmation === password);
 let previousSignIn: boolean | undefined;
 $effect(() => {
   if (signIn !== previousSignIn && (previousSignIn !== undefined || registrationDefaults && !signIn)) {
     const defaults = signIn ? undefined : registrationDefaults;
     username = defaults?.username ?? '';
     password = confirmation = defaults?.password ?? '';
     displayName = '';
   }
   previousSignIn = signIn;
 });
 $effect(() => {
   registerReady = !disabled && usernameValid && passwordCheck?.success === true && passwordMatches;
   signInReady = signIn && !passwordLocked && password.length > 0 && password.length <= 128;
 });
 $effect(() => {
   if (progressive) passwordInput?.setCustomValidity(password ? passwordIssue : '');
 });
 $effect(()=>{confirmationInput?.setCustomValidity(confirmation && !passwordMatches ? 'Passwords must match.' : '');});

 function validationFor(value: string, valid: boolean, guidance: string, accepted: string, issue = guidance): FieldValidation | null | undefined {
   if (!menuRows || !progressive) return undefined;
   if (signIn || disabled) return null;
   if (!value) return { state: 'info', message: guidance };
   return valid ? { state: 'valid', message: accepted } : { state: 'invalid', message: issue };
 }

</script>
{#snippet displayNameField()}
  <Field label="Display name" hideLabel={menuRows} class={fieldClass}>
    {#if menuRows}<Icon name="userCheck" />{/if}
    <input name="displayName" bind:value={displayName} required maxlength="60" autocomplete="nickname" placeholder={menuRows ? 'Display name' : undefined} />
  </Field>
{/snippet}
{#snippet confirmPasswordField()}
  <Field label="Confirm password" hideLabel={menuRows} class={fieldClass}
    requirements={[{ icon: 'key', label: 'Password match', detail: 'Re-enter your password exactly, including capital letters and symbols.', met: confirmation ? passwordMatches : undefined }]}
    validation={validationFor(confirmation, passwordMatches, 'Re-enter your password.', 'Passwords match.', 'Passwords must match.')}>
    {#if menuRows}<Icon name="key" />{/if}
    <input name="passwordConfirmation" type="password" bind:this={confirmationInput} bind:value={confirmation} required minlength="8" maxlength="128"
      autocomplete="new-password" placeholder={menuRows ? 'Confirm password' : undefined} />
  </Field>
{/snippet}

<Field label="Username" hint={menuRows || signIn ? undefined : usernameHint} hideLabel={menuRows} class={fieldClass}
  requirements={usernameChecks}
  validation={validationFor(username, usernameValid, usernameHint, 'Username format is valid.', usernameChecks?.find(rule => !rule.met)?.detail)}>
  {#if menuRows}<Icon name="user" />{/if}
  <input name="username" bind:value={username} {disabled} required minlength={signIn ? undefined : 3} maxlength="32" pattern={signIn ? undefined : '[A-Za-z0-9][A-Za-z0-9_.\\-]{2,31}'} autocomplete="username"
    onchange={event => { username = event.currentTarget.value; }}
    placeholder={menuRows ? 'Username' : undefined} title={menuRows && !signIn ? usernameHint : undefined} aria-describedby={menuRows && !signIn ? `${hintId}-username` : undefined} />
</Field>
{#if showDisplayName && !progressive && !signIn}
  {@render displayNameField()}
{:else if showDisplayName && usernameValid}
  <fieldset class="progressive-field" transition:slideFade
    onoutrostart={event => { event.currentTarget.disabled = true; }}
    onintrostart={event => { event.currentTarget.disabled = false; }}>
    {@render displayNameField()}
  </fieldset>
{/if}
<Field label="Password" hint={menuRows || signIn ? undefined : passwordHint} hideLabel={menuRows} class={fieldClass}
  requirements={menuRows && progressive && !signIn && !disabled ? passwordRequirements.map(rule => ({
    ...rule, met: safeParse(rule.schema, password).success,
  })) : undefined}
  validation={validationFor(password, passwordCheck?.success === true, passwordHint, 'Password meets the requirements.', passwordIssue || passwordHint)}>
  {#if menuRows}<Icon name="key" />{/if}
  <input name="password" type="password" bind:this={passwordInput} bind:value={password} disabled={passwordLocked} required minlength={signIn ? undefined : 8} maxlength="128" autocomplete={signIn ? 'current-password' : 'new-password'}
    onchange={event => { password = event.currentTarget.value; }}
    placeholder={menuRows ? 'Password' : undefined} title={menuRows && !signIn ? passwordHint : undefined} aria-describedby={menuRows && !signIn ? `${hintId}-password` : undefined} />
</Field>
{#if !progressive && !signIn}
  {@render confirmPasswordField()}
{:else if passwordCheck?.success}
  <fieldset class="progressive-field" transition:slideFade
    onoutrostart={event => { event.currentTarget.disabled = true; }}
    onintrostart={event => { event.currentTarget.disabled = false; }}>
    {@render confirmPasswordField()}
  </fieldset>
{/if}
{#if menuRows && !signIn}
  <span class="sr-only" id={`${hintId}-username`}>{usernameHint}</span>
  <span class="sr-only" id={`${hintId}-password`}>{passwordHint}</span>
{/if}

<style>
  .progressive-field {
    display: grid;
    min-inline-size: 0;
    margin-inline: 0;
    padding: 0;
    border: 0;
  }
</style>
