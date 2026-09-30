<script lang="ts">
  import { displayLabel } from '$lib/ui/labels';
  import { change, message } from '$lib/ui/client';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  type Instance = {
    id: string;
    provider: string;
    name: string;
    baseUrl: string;
    enabled: boolean;
    allowPrivateNetwork: boolean;
    linkedMediaInstanceId: string | null;
  };
  let {
    providers,
    experimentalFeatures = false,
  }: { providers: Instance[]; experimentalFeatures?: boolean } = $props();
  let open = $state(false),
    editing = $state<Instance | null>(null),
    provider = $state('tmdb'),
    name = $state(''),
    baseUrl = $state(''),
    linked = $state(''),
    privateNetwork = $state(false),
    busy = $state(false),
    error = $state('');
  function edit(instance: Instance | null) {
    editing = instance;
    provider = instance?.provider ?? 'tmdb';
    name = instance?.name ?? '';
    baseUrl = instance?.baseUrl ?? '';
    linked = instance?.linkedMediaInstanceId ?? '';
    privateNetwork = instance?.allowPrivateNetwork ?? false;
    error = '';
    open = true;
  }
  async function save(form: HTMLFormElement) {
    busy = true;
    error = '';
    try {
      const fields = Object.fromEntries(new FormData(form));
      const secrets = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== '')
      );
      await change('providers', {
        ...secrets,
        id: editing?.id,
        provider,
        name,
        baseUrl: ['jellyfin', 'seerr'].includes(provider) ? baseUrl : undefined,
        linkedMediaInstanceId: linked || undefined,
        allowPrivateNetwork: privateNetwork,
      });
      open = false;
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
  async function toggle(instance: Instance) {
    error = '';
    try {
      await change(`providers/${instance.id}/${instance.enabled ? 'disable' : 'enable'}`, {});
    } catch (e) {
      error = message(e);
    }
  }
</script>

<div class="stack form-width">
  <p>Configure shared services here. Users link their own accounts in Connections.</p>
  {#if error && !open}<div class="notice error" role="alert">{error}</div>{/if}
  {#each providers as instance}<div class="panel stack">
      <div class="spread">
        <div>
          <h3>{instance.name}</h3>
          <p class="small">{displayLabel(instance.provider)} · {instance.baseUrl}</p>
        </div>
        <span class="badge">{instance.enabled ? 'Enabled' : 'Disabled'}</span>
      </div>
      <div class="row">
        <Button variant="secondary" onclick={() => edit(instance)}>Edit</Button><Button
          variant="ghost"
          onclick={() => toggle(instance)}>{instance.enabled ? 'Disable' : 'Enable'}</Button
        >
      </div>
    </div>{/each}
  <Button icon="plus" onclick={() => edit(null)}>Add an integration</Button>
</div>
<Dialog bind:open title={editing ? 'Edit integration' : 'Add an integration'}>
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      void save(event.currentTarget);
    }}
  >
    {#if error}<div class="notice error" role="alert">{error}</div>{/if}
    <label class="field"
      >Provider<select bind:value={provider} disabled={!!editing}
        ><option value="tmdb">TMDB</option><option value="jellyfin">Jellyfin</option><option
          value="trakt">Trakt</option
        ><option value="seerr">Seerr</option>{#if experimentalFeatures}<option value="igdb"
            >IGDB</option
          >{/if}</select
      ></label
    >
    <label class="field"
      >Display name<input
        bind:value={name}
        required
        maxlength="100"
        placeholder={provider === 'jellyfin' ? 'Home library' : provider.toUpperCase()}
      /></label
    >
    {#if provider === 'jellyfin' || provider === 'seerr'}<label class="field"
        >Server URL<input
          bind:value={baseUrl}
          type="url"
          readonly={!!editing}
          placeholder={provider === 'jellyfin' ? 'http://jellyfin:8096' : 'http://seerr:5055'}
          required
        />{#if editing}<small>Add a new integration to connect a different server.</small
          >{/if}</label
      ><label class="check"
        ><input bind:checked={privateNetwork} type="checkbox" />Allow this server’s private network
        address</label
      >{/if}
    {#if editing && provider !== 'jellyfin'}<p class="small">
        Leave credential fields empty to keep the current credentials.
      </p>{/if}
    {#if provider === 'tmdb'}<label class="field"
        >TMDB API read access token<input
          name="accessToken"
          type="password"
          autocomplete="off"
          required={!editing}
        /><small>From your TMDB account’s API settings.</small></label
      >
    {:else if provider === 'trakt' || provider === 'igdb'}<label class="field"
        >{provider === 'igdb' ? 'Twitch client ID' : 'Application client ID'}<input
          name="clientId"
          autocomplete="off"
          required={!editing}
        /></label
      ><label class="field"
        >{provider === 'igdb' ? 'Twitch client secret' : 'Application client secret'}<input
          name="clientSecret"
          type="password"
          autocomplete="off"
          required={!editing}
        /></label
      >
      {#if provider === 'igdb'}<small
          >From your Twitch developer application. Coast verifies these credentials with IGDB.</small
        >{/if}
    {:else if provider === 'seerr'}<label class="field"
        >Seerr API key<input
          name="apiKey"
          type="password"
          autocomplete="off"
          required={!editing}
        /></label
      ><label class="field"
        >Associated Jellyfin server<select bind:value={linked} required
          ><option value="">Choose a server</option
          >{#each providers.filter((p) => p.provider === 'jellyfin') as instance}<option
              value={instance.id}>{instance.name}</option
            >{/each}</select
        ></label
      >{/if}
    <Button type="submit" disabled={busy}
      >{busy ? 'Verifying…' : editing ? 'Save integration' : 'Add integration'}</Button
    >
  </form>
</Dialog>
