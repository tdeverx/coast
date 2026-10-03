<script lang="ts">
 import Field from './Field.svelte';
 let password=$state(''),confirmation=$state(''),confirmationInput:HTMLInputElement;
 $effect(()=>{confirmationInput?.setCustomValidity(confirmation && confirmation!==password?'Passwords must match.':'');});
</script>
<Field label="Username" hint="3–32 letters, numbers, dots, underscores or hyphens."><input name="username" required minlength="3" maxlength="32" pattern={'[A-Za-z0-9][A-Za-z0-9_.\\-]{2,31}'} autocomplete="username" /></Field>
<Field label="Display name"><input name="displayName" required maxlength="60" autocomplete="nickname" /></Field>
<Field label="Password" hint="Use 8–128 characters with uppercase, lowercase and a special character."><input name="password" type="password" bind:value={password} required minlength="8" maxlength="128" autocomplete="new-password" /></Field>
<Field label="Confirm password"><input name="passwordConfirmation" type="password" bind:this={confirmationInput} bind:value={confirmation} required minlength="8" maxlength="128" autocomplete="new-password" /></Field>
