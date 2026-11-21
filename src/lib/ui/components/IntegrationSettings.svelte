<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import Field from './Field.svelte';
  import { displayLabel } from '#lib/ui/labels.js';
  import { message } from '#lib/ui/client.js';
  import { useClient } from '#lib/ui/client-context.js';
  import type {SourceImpact} from '#lib/collection/source-changes.server.js';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Heading from './Heading.svelte';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import { onDestroy } from 'svelte';

  import ProviderAutomation from './ProviderAutomation.svelte';
  import type { ProviderSchedule } from '#lib/providers/schedule.js';
  import { tmdbCredential } from '#lib/providers/tmdb/credentials.js';

  const { api, change, feedback } = useClient();

  type Instance = {
    id: string;
    provider: string;
    name: string;
    baseUrl: string;
    lanUrl?: string | null;
    managementKeyConfigured?:boolean;
    subtitleAuthority?:'viewer'|'server';
    enabled: boolean;
    allowPrivateNetwork: boolean;
    linkedMediaInstanceId: string | null;
    schedule: ProviderSchedule;
  };
  let {
    providers,
    experimentalGaming = false,
    experimentalComics = false,
  }: { providers: Instance[]; experimentalGaming?: boolean; experimentalComics?: boolean } = $props();
  let open = $state(false),
    editing = $state<Instance | null>(null),
    provider = $state('tmdb'),
    name = $state(''),
    baseUrl = $state(''),
    lanUrl = $state(''),
    subtitleAuthority = $state<'viewer'|'server'>('viewer'),
    removeJellyfinKey = $state(false),
    linked = $state(''),
    privateNetwork = $state(false),
    busy = $state(false),
    error = $state('');
  let changing=$state<Instance|null>(null),impact=$state<SourceImpact|null>(null);
  let deleting = $state<Instance | null>(null);
  type SubtitleReview={itemId:string;sourceId:string;fingerprint:string;label:string;title:string};
  const subtitleReview=createResource<SubtitleReview[]>([]);
  onDestroy(subtitleReview.dispose);
  let reviewInstance=$state<Instance|null>(null),removingSubtitle=$state<SubtitleReview|null>(null);
  async function reviewSubtitles(instance:Instance){
    if(reviewInstance?.id!==instance.id)subtitleReview.replace([]);
    removingSubtitle=null;
    reviewInstance=instance;
    await subtitleReview.load(signal=>api(`providers/${instance.id}/subtitle-review`,undefined,'GET',{signal}));
  }
  async function removeSubtitle() {
    if(!reviewInstance||!removingSubtitle||busy)return;
    const instance=reviewInstance;
    const {itemId,sourceId,fingerprint}=removingSubtitle;
    busy=true;
    try{
      await api(`providers/${instance.id}/subtitle-review`,{itemId,sourceId,fingerprint},'POST');
      feedback.notify('Subtitle removed from Jellyfin.');
      await reviewSubtitles(instance);
    }catch(cause){feedback.failure(message(cause));}
    finally{busy=false;}
  }
  function edit(instance: Instance | null) {
    editing = instance;
    provider = instance?.provider ?? 'tmdb';
    name = instance?.name ?? '';
    baseUrl = instance?.baseUrl ?? '';
    lanUrl = instance?.lanUrl ?? '';
    subtitleAuthority = instance?.subtitleAuthority ?? 'viewer';
    removeJellyfinKey = false;
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
      delete secrets.tmdbCredential;
      await change('providers', {
        ...secrets,
        ...(provider === 'tmdb' ? tmdbCredential(fields.tmdbCredential) : {}),
        id: editing?.id,
        provider,
        name,
        baseUrl: ['jellyfin', 'seerr'].includes(provider) ? baseUrl : undefined,
        lanUrl: provider === 'jellyfin' ? lanUrl : undefined,
        subtitleAuthority: provider === 'jellyfin' ? subtitleAuthority : undefined,
        removeJellyfinKey: provider === 'jellyfin' ? removeJellyfinKey : undefined,
        linkedMediaInstanceId: linked || undefined,
        allowPrivateNetwork: privateNetwork,
      });
      feedback.notify(
        editing ? 'Integration saved.' : ['jellyfin', 'trakt', 'steam'].includes(provider)
          ? 'Integration added. Link your account in Connections.' : 'Integration added.'
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
      feedback.notify(`${instance.name} ${instance.enabled ? 'disabled' : 'enabled'}.`);
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
  async function remove(instance: Instance, approved = false) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      if (!approved) {
        impact = instance.provider === 'jellyfin'
          ? await api(`providers/${instance.id}/instance-source-preview`, undefined, 'GET') : null;
        deleting = instance;
        return;
      }
      await change(`providers/${instance.id}`, { previewId: impact?.id }, 'DELETE');
      deleting = null;
      impact = null;
      feedback.notify(`${instance.name} deleted.`);
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }

  reportFailure(()=>error);
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

  {#each providers as instance (instance.id)}<div class="panel stack">
      <Heading title={instance.name}>
        {#snippet segments()}<span class="badge">{instance.enabled ? 'Enabled' : 'Disabled'}</span
          >{/snippet}
        {#snippet actions()}<Button menu
            label={`${instance.name} integration actions`}
            disabled={busy}
          >
            <Button item icon="settings" keepOpen={false} onclick={() => edit(instance)}
              >Edit integration</Button>
            {#if instance.enabled&&instance.managementKeyConfigured}
              <Button item keepOpen={false} onclick={()=>void reviewSubtitles(instance)}>Review subtitle downloads</Button>
            {/if}
            <Button item
              icon={instance.enabled ? 'pause' : 'play'}
              keepOpen={false}
              onclick={() => void toggle(instance)}
              >{instance.enabled ? 'Disable integration' : 'Enable integration'}</Button>
            <div class="menu-divider" role="separator"></div>
            <Button item danger keepOpen={false} onclick={() => void remove(instance)}
              >Delete integration</Button>
          </Button>{/snippet}
      </Heading>
      <p class="small">{displayLabel(instance.provider)} · {instance.baseUrl}</p>
      <p class="small">
        {instance.provider === 'comic-vine'
          ? instance.enabled ? 'Used on demand for comic search and metadata.' : 'Comic discovery is disabled. Saved metadata and reading progress are retained.'
          : instance.enabled
          ? 'Available to users.'
          : 'Hidden from personal connections. Existing tracking data is retained.'}
        {#if instance.provider !== 'comic-vine'}Disabling stops new provider actions; queued work may fail until enabled again.{/if}
      </p>
      <ProviderAutomation {instance} />
    </div>{/each}
</div>
<Dialog open={!!reviewInstance} onclose={()=>{if(!busy){reviewInstance=null;removingSubtitle=null;subtitleReview.cancel();}}} title="Subtitle downloads">
  <div class="stack">
    {#if removingSubtitle}
      <p>Remove {removingSubtitle.label} for {removingSubtitle.title} from Jellyfin? This removes the subtitle for every viewer. Confirm it is broken before removing it.</p>
      <div class="row">
        <Button danger disabled={busy} onclick={()=>void removeSubtitle()}>Remove subtitle</Button>
        <Button disabled={busy} onclick={()=>{removingSubtitle=null;}}>Cancel</Button>
      </div>
    {:else if subtitleReview.busy}
      <p role="status">Checking subtitle downloads…</p>
    {:else if subtitleReview.error}
      <p role="status">{subtitleReview.error}</p>
    {:else if subtitleReview.data.length}
      <p>These Coast downloads failed to load. A network interruption can also cause a load failure.</p>
      {#each subtitleReview.data as track (`${track.itemId}:${track.sourceId}:${track.fingerprint}`)}
        <div class="spread"><span>{track.title} · {track.label}</span><Button emphasis="subtle" onclick={()=>{removingSubtitle=track;}}>Review removal</Button></div>
      {/each}
    {:else}
      <p>No subtitle downloads need review.</p>
    {/if}
  </div>
</Dialog>
<Dialog open={!!changing} onclose={()=>changing=null} title="Disable this Collection source?">
  <div class="stack"><p>Existing tracking stays in Coast. Remote Trakt entries stay until their owner approves cleanup.</p>

    {#each impact?.accounts??[] as account}<h3>{account.username}</h3><p>{account.removals.length} potential removals{account.uncertain?' · uncertain coverage or delivery':''} · {account.unresolved.length} unresolved identities.</p><ul>{#each account.removals.slice(0,60) as item}<li>{item.title}</li>{/each}</ul>{/each}
    {#if !impact?.accounts.length}<p>No active Trakt Collection export depends on this source.</p>{/if}
    <div class="row"><Button danger disabled={busy} onclick={()=>changing&&toggle(changing,true)}>Disable and leave Trakt entries</Button><Button  disabled={busy} onclick={()=>changing=null}>Keep enabled</Button></div>
  </div>
</Dialog>
<Dialog open={!!deleting} onclose={() => { if (!busy) { deleting = null; impact = null; } }} title="Delete integration?">
  <div class="stack">
    <p>Delete {deleting?.name} and its account connections for everyone? Local titles, tracking and history stay in Coast. To use this integration again, add it and reconnect your accounts.</p>
    {#if deleting?.provider === 'jellyfin'}
      <p>Remote Trakt entries stay until their owner approves cleanup.</p>
      {#each impact?.accounts ?? [] as account}
        <h3>{account.username}</h3>
        <p>{account.removals.length} potential removals{account.uncertain ? ' · uncertain coverage or delivery' : ''} · {account.unresolved.length} unresolved identities.</p>
        <ul>{#each account.removals.slice(0,60) as item}<li>{item.title}</li>{/each}</ul>
      {/each}
    {/if}

    <div class="row">
      <Button danger disabled={busy} onclick={() => deleting && remove(deleting, true)}>Delete integration</Button>
      <Button disabled={busy} onclick={() => { deleting = null; impact = null; }}>Cancel</Button>
    </div>
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

      <Field label="Provider"><select bind:value={provider} disabled={!!editing}
          ><option value="tmdb">TMDB</option><option value="jellyfin">Jellyfin</option><option
            value="trakt">Trakt</option
          ><option value="seerr">Seerr</option>{#if experimentalGaming}<option value="igdb"
              >IGDB</option
            ><option value="steam">Steam</option>{/if}{#if experimentalComics}<option value="comic-vine">Comic Vine</option>{/if}</select
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
      {#if provider === 'jellyfin'}<Field label="LAN URL (optional)"><input
          bind:value={lanUrl}
          type="url"
          placeholder="http://192.168.0.18:8096"
        /><small>Used by the Coast server for this Jellyfin instance. Keep the public URL above. Playback quality limits still apply to every viewer.</small></Field>
        <Field label="Jellyfin server API key"><input name="apiKey" type="password" autocomplete="off" disabled={removeJellyfinKey} />
          <small>{editing?.managementKeyConfigured?'Leave blank to keep the current key. ':'Optional. '}Create a key in Jellyfin Dashboard → API Keys. The key has server-wide admin access. Coast verifies it when you save.</small>
        </Field>
        {#if editing?.managementKeyConfigured}
          <p class="small">Replacing this key requires new codes for unclaimed managed invites. Existing accounts keep their personal connections.</p>
        {/if}
        {#if editing?.managementKeyConfigured}<label class="check"><input type="checkbox" bind:checked={removeJellyfinKey} />Remove the current key</label>{/if}
        <Field label="Subtitle search and downloads">
          <select bind:value={subtitleAuthority} disabled={removeJellyfinKey}>
            <option value="viewer">Use the viewer’s Jellyfin permissions</option>
            <option value="server">Use the Jellyfin server API key</option>
          </select>
          <small>Viewers can only search or download subtitles for media they can play. Jellyfin needs a configured subtitle provider.</small>
        </Field>
      {/if}
      {#if editing && provider !== 'jellyfin'}<p class="small">
          Leave credential fields empty to keep the current credentials.
        </p>{/if}
      {#if provider === 'tmdb'}<Field label="TMDB API key or read access token"><input
            name="tmdbCredential"
            type="password"
            autocomplete="off"
            maxlength="4096"
            required={!editing}
          /><small>From your TMDB account’s API settings.</small></Field>
      {:else if provider === 'steam'}<Field label="Steam Web API key"><input name="apiKey" type="password" autocomplete="off" required={!editing} /><small>From Steam’s Web API key settings. Account linking uses Steam’s sign-in page; private game data remains unavailable.</small></Field>
      {:else if provider === 'comic-vine'}<Field label="Comic Vine API key"><input name="apiKey" type="password" autocomplete="off" required={!editing} /><small>Metadata only; no personal account connection is needed. Comic Vine permits non-commercial use only. <a href="https://comicvine.gamespot.com/api/" target="_blank" rel="noreferrer">API terms and key</a></small></Field>
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
