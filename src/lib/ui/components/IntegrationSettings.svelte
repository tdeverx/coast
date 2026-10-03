<script lang="ts">
  import Field from './Field.svelte';
  import RowFeedback from './RowFeedback.svelte';
  import { displayLabel } from '$lib/ui/labels';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import type {SourceImpact} from '$lib/collection/source-changes.server';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Heading from './Heading.svelte';

  import ProviderAutomation from './ProviderAutomation.svelte';
  import type { ProviderSchedule } from '$lib/providers/schedule';

  const { api, change } = useClient();

  type Instance = {
    id: string;
    provider: string;
    name: string;
    baseUrl: string;
    enabled: boolean;
    allowPrivateNetwork: boolean;
    linkedMediaInstanceId: string | null;
    schedule: ProviderSchedule;
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
  let changing=$state<Instance|null>(null),impact=$state<SourceImpact|null>(null);
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
    if (busy) return;
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
      notifyAction(
        editing ? 'Integration saved.' : 'Integration added. Link your account in Connections.'
      );
      open = false;
      form.reset();
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
  async function toggle(instance: Instance,approved=false) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      if(instance.provider==='jellyfin'&&instance.enabled&&!approved){impact=await api(`providers/${instance.id}/instance-source-preview`,undefined,'GET');changing=instance;return;}
      await change(`providers/${instance.id}/${instance.enabled ? 'disable' : 'enable'}`, {previewId:impact?.id});
      changing=null;impact=null;
      notifyAction(`${instance.name} ${instance.enabled ? 'disabled' : 'enabled'}.`);
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="stack form-width">
  <Heading title="Integrations"
    >{#snippet actions()}<Button
        emphasis="subtle"
        disabled={busy}
        icon="plus"
        onclick={() => edit(null)}>Add integration</Button
      >{/snippet}</Heading
  >
  <p class="small">
    <a class="text-accent" href="/settings/connections">Link your account in Connections</a>
    · <a class="text-accent" href="/settings/jobs">Manage schedules</a>
  </p>
  {#if error && !open}<RowFeedback error={error} tag="div" class="notice error" />{/if}
  {#each providers as instance (instance.id)}<div class="panel stack">
      <Heading title={instance.name}>
        {#snippet filters()}<span class="badge">{instance.enabled ? 'Enabled' : 'Disabled'}</span
          >{/snippet}
        {#snippet actions()}<Button menu
            label={`${instance.name} integration actions`}
            disabled={busy}
          >
            <Button item icon="settings" keepOpen={false} onclick={() => edit(instance)}
              >Edit integration</Button>
            <Button item
              icon={instance.enabled ? 'pause' : 'play'}
              keepOpen={false}
              onclick={() => void toggle(instance)}
              >{instance.enabled ? 'Disable integration' : 'Enable integration'}</Button>
          </Button>{/snippet}
      </Heading>
      <p class="small">{displayLabel(instance.provider)} · {instance.baseUrl}</p>
      <p class="small">
        {instance.enabled
          ? 'Available to users.'
          : 'Hidden from personal connections. Existing tracking data is retained.'} Disabling stops new
        provider actions; queued work may fail until enabled again.
      </p>
      <ProviderAutomation {instance} />
    </div>{/each}
</div>
<Dialog open={!!changing} onclose={()=>changing=null} title="Disable this Collection source?">
  <div class="stack"><p>Existing tracking stays in Coast. Remote Trakt entries stay until their owner approves cleanup.</p>
    {#if error}<RowFeedback error={error} tag="p" class="notice error" />{/if}
    {#each impact?.accounts??[] as account}<h3>{account.username}</h3><p>{account.removals.length} potential removals{account.uncertain?' · uncertain coverage or delivery':''} · {account.unresolved.length} unresolved identities.</p><ul>{#each account.removals.slice(0,60) as item}<li>{item.title}</li>{/each}</ul>{/each}
    {#if !impact?.accounts.length}<p>No active Trakt Collection export depends on this source.</p>{/if}
    <div class="row"><Button danger disabled={busy} onclick={()=>changing&&toggle(changing,true)}>Disable and leave Trakt entries</Button><Button  disabled={busy} onclick={()=>changing=null}>Keep enabled</Button></div>
  </div>
</Dialog>
<Dialog bind:open title={editing ? 'Edit integration' : 'Add an integration'}>
  {#key `${open}:${editing?.id ?? 'new'}:${provider}`}
    <form
      class="stack"
      onsubmit={(event) => {
        event.preventDefault();
        void save(event.currentTarget);
      }}
    >
      {#if error}<RowFeedback error={error} tag="div" class="notice error" />{/if}
      <Field label="Provider"><select bind:value={provider} disabled={!!editing}
          ><option value="tmdb">TMDB</option><option value="jellyfin">Jellyfin</option><option
            value="trakt">Trakt</option
          ><option value="seerr">Seerr</option>{#if experimentalFeatures}<option value="igdb"
              >IGDB</option
            ><option value="steam">Steam</option>{/if}</select
        ></Field>
      <Field label="Display name"><input
          bind:value={name}
          required
          maxlength="100"
          placeholder={provider === 'jellyfin' ? 'Home library' : provider.toUpperCase()}
        /></Field>
      {#if provider === 'jellyfin' || provider === 'seerr'}<Field label="Server URL"><input
            bind:value={baseUrl}
            type="url"
            readonly={!!editing}
            placeholder={provider === 'jellyfin' ? 'http://jellyfin:8096' : 'http://seerr:5055'}
            required
          />{#if editing}<small>Add a new integration to connect a different server.</small
            >{/if}</Field><label class="check"
          ><input bind:checked={privateNetwork} type="checkbox" />Allow this server’s private
          network address</label
        >{/if}
      {#if editing && provider !== 'jellyfin'}<p class="small">
          Leave credential fields empty to keep the current credentials.
        </p>{/if}
      {#if provider === 'tmdb'}<Field label="TMDB API read access token"><input
            name="accessToken"
            type="password"
            autocomplete="off"
            required={!editing}
          /><small>From your TMDB account’s API settings.</small></Field>
      {:else if provider === 'steam'}<Field label="Steam Web API key"><input name="apiKey" type="password" autocomplete="off" required={!editing} /><small>From Steam’s Web API key settings. Account linking uses Steam’s sign-in page; private game data remains unavailable.</small></Field>
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
      {:else if provider === 'seerr'}<Field label="Seerr API key"><input
            name="apiKey"
            type="password"
            autocomplete="off"
            required={!editing}
          /></Field><Field label="Associated Jellyfin server"><select bind:value={linked} required
            ><option value="">Choose a server</option
            >{#each providers.filter((p) => p.provider === 'jellyfin') as instance}<option
                value={instance.id}>{instance.name}</option
              >{/each}</select
          ></Field>{/if}
      <Button type="submit" disabled={busy}
        >{busy ? 'Saving…' : editing ? 'Save integration' : 'Add integration'}</Button
      >
    </form>
  {/key}
</Dialog>
