<script lang="ts">
  import Field, { type FieldValidation } from '#lib/ui/components/Field.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  let { mode, serverUrl = $bindable(''), jellyfinName = $bindable(''), jellyfinPassword = $bindable('') }: {
    mode: 'server' | 'credentials'; serverUrl?: string; jellyfinName?: string; jellyfinPassword?: string;
  } = $props();
  const validServer = $derived(URL.canParse(serverUrl) && /^https?:\/\//i.test(serverUrl));
  const urlStatus = $derived.by<FieldValidation>(() => {
    if (validServer) return { state: 'valid', message: 'The server address has a valid format.' };
    return { state: serverUrl ? 'invalid' : 'info', message: 'Enter the full Jellyfin address, including http:// or https://.' };
  });
  const nameStatus = $derived<FieldValidation>(jellyfinName.trim()
    ? { state: 'valid', message: 'Username entered.' }
    : { state: jellyfinName ? 'invalid' : 'info', message: 'Enter the username you use on this Jellyfin server.' });
  const passwordHint = 'Enter your Jellyfin password. Leave this blank if your account has no password.';
</script>
{#if mode === 'server'}
  <Field label="Jellyfin server URL" hideLabel class="menu-row" validation={urlStatus}
    requirements={[{ icon: 'link', label: 'Server address', detail: urlStatus.message, met: serverUrl ? validServer : undefined }]}>
    <Icon name="link" /><input type="url" name="serverUrl" placeholder="Server URL" bind:value={serverUrl} aria-invalid={urlStatus.state === 'invalid' || undefined} required autocomplete="url" />
  </Field>
{:else}
  <Field label="Jellyfin username" hideLabel class="menu-row" validation={nameStatus}
    requirements={[{ icon: 'user', label: 'Account username', detail: nameStatus.message, met: jellyfinName ? !!jellyfinName.trim() : undefined }]}>
    <Icon name="user" /><input name="username" placeholder="Username" bind:value={jellyfinName} aria-invalid={nameStatus.state === 'invalid' || undefined} required maxlength="250" autocomplete="section-jellyfin username" />
  </Field>
  <Field label="Jellyfin password" hideLabel class="menu-row" validation={{ state: 'info', message: passwordHint }}
    requirements={[{ icon: 'key', label: 'Account password', detail: passwordHint, met: undefined }]}>
    <Icon name="key" /><input name="password" type="password" placeholder="Password" maxlength="4096"
      autocomplete="section-jellyfin current-password" bind:value={jellyfinPassword} />
  </Field>
{/if}
