<script lang="ts">
  import type { Snippet } from 'svelte';
  import JellyfinFields from '#lib/auth/ui/JellyfinFields.svelte';
  import ServiceDisclosure from '#lib/auth/ui/ServiceDisclosure.svelte';
  import ServiceHeader from '#lib/auth/ui/ServiceHeader.svelte';
  import SettingsSwitch from '#lib/settings/SettingsSwitch.svelte';
  import OperationProgress from './OperationProgress.svelte';
  import { reportFailure } from '#lib/ui/client-context.js';
  import CollectionProjectionSettings from './CollectionProjectionSettings.svelte';
  import AccessFields from '#lib/providers/trakt/AccessFields.svelte';
  import PairingCode from '#lib/providers/trakt/PairingCode.svelte';
  import { beginTraktActivation } from '#lib/providers/trakt/activation.js';
  import { initialTraktSync, traktPreferences } from '#lib/providers/trakt/access.js';
  import type {SourceImpact} from '#lib/collection/source-changes.server.js';
  import { untrack } from 'svelte';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import { message } from '#lib/ui/client.js';
  import { useClient } from '#lib/ui/client-context.js';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import Dialog from './Dialog.svelte';

  const { api, change, preview, feedback } = useClient();
  const notifyAction=feedback.notify;

  let {
    provider,
    sources = [],
    dynamicCollectionExports = [],
    settingsGroup,
  }: {
    sources?: {id:string;name:string}[];
    dynamicCollectionExports?: string[];
    settingsGroup?: Snippet<[Snippet]>;
    provider: {
      id: string;
      name: string;
      provider: string;
      configured: boolean;
      connection: {
        id: string;
        accountGeneration?: string;
        username: string | null;
        status: string;
        settings: Record<string, unknown>;
      } | null;
    };
  } = $props();
  const serviceId = $props.id();
  let expanded = $state(false);
  let visited = $state(false);
  const service = $derived(provider.provider === 'jellyfin' || provider.provider === 'trakt' ? provider.provider : undefined);
  const serviceIcon = $derived(provider.provider === 'steam' ? 'gamepad' : 'request');
  const connectionNote = $derived(provider.connection?.status === 'connected' ? 'Connected' : 'Not connected');

  function toggleService() {
    expanded = !expanded;
    if (expanded) visited = true;
  }

  let error = $state(''),
    busy = $state(false),
    username = $state(''),
    password = $state(''),
    disconnect = $state(false),
    device = $state<{
      challengeId: string;
      userCode: string;
      verificationUrl: string;
      interval: number;
    } | null>(null),
    pending = $state(false);
  type Scan = {
    state: string;
    processed: number;
    total: number | null;
    phase: string;
    error: string | null;
    attempts: number;
  };
  const scanStatus = createResource<Scan | null>(null);
  const scan = $derived(scanStatus.data);
  const sourceId = $derived(provider.provider === 'jellyfin' && provider.connection?.status === 'connected'
    ? provider.connection.id : undefined);
  const sourceGeneration = $derived(sourceId ? provider.connection?.accountGeneration : undefined);
  let sourceImpact=$state<SourceImpact|null>(null);
  async function prepareDisconnect(){sourceImpact=null;error='';busy=true;try{if(provider.provider==='jellyfin')sourceImpact=await api(`providers/${provider.connection!.id}/source-preview`,undefined,'GET');disconnect=true;}catch(e){error=message(e);}finally{busy=false;}}
  const scanning = $derived(scan?.state === 'pending' || scan?.state === 'running');
  const scanPercent = $derived(
    scan?.total ? Math.min(100, Math.floor((scan.processed / scan.total) * 100)) : null
  );

  $effect(() => {
    const connectionId = sourceId;
    sourceGeneration;
    untrack(() => scanStatus.replace(null));
    if (!connectionId) return;

    let lastRefresh = -Infinity;
    async function poll() {
      if (document.hidden || scanStatus.busy || (!scanning && Date.now() - lastRefresh < 15000)) return;
      try {
        await scanStatus.load(signal => api<Scan | null>(`providers/${connectionId}/scan`, undefined, 'GET', { signal }));
      } finally {
        lastRefresh = Date.now();
      }
    }

    untrack(() => void poll());
    if (preview) return scanStatus.cancel;
    const timer = setInterval(poll, 2000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
      scanStatus.cancel();
    };
  });
  let initialized = '';
  let liveRead=$state(untrack(()=>provider.connection?.settings.liveRead!==false));
  let reconcileTracking=$state(untrack(()=>provider.connection?.settings.reconcileTracking===true));
  let importPlayback = $state(
    untrack(() => provider.connection?.settings.importPlayback !== false)
  );
  const savedSync = $derived(traktPreferences(provider.connection?.settings ?? {}));
  let linkSync = $state(initialTraktSync());
  let traktSync = $state(untrack(() => structuredClone(savedSync)));
  $effect(() => {
    const key = `${provider.connection?.id}:${provider.connection?.status}:${provider.connection?.accountGeneration}:${JSON.stringify(savedSync)}`;
    if (key === initialized) return;
    initialized = key;
    traktSync = structuredClone(savedSync);
    if (provider.provider === 'trakt')
      linkSync = provider.connection?.username ? structuredClone(savedSync) : initialTraktSync();
    liveRead = provider.connection?.settings.liveRead !== false;
    importPlayback = provider.connection?.settings.importPlayback !== false;
    reconcileTracking = provider.connection?.settings.reconcileTracking === true;
  });
  async function action<T = unknown>(path: string, body: unknown = {}, label?: string) {
    if (busy) return;
    error = '';
    busy = true;
    try {
      const result = await change<T>(path, body);
      if (label && !preview) notifyAction(label);
      return { result };
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
  async function connect() {
    await action(
      'providers/jellyfin',
      { instanceId: provider.id, username, password },
      'Jellyfin connected.'
    );
    password = '';
  }
  async function startSteam() {
    const result=await action<{url:string}>('providers/steam/start',{instanceId:provider.id});
    if(result && !preview)window.location.assign(result.result.url);
  }
  let steamImports=$state({importOwned:true,importPlaytime:true,importAchievements:true});
  $effect(()=>{const settings=provider.connection?.settings;steamImports={importOwned:settings?.importOwned!==false,importPlaytime:settings?.importPlaytime!==false,importAchievements:settings?.importAchievements!==false};});
  async function start() {
    if (busy) return;
    busy = true;
    error = '';
    const activate = preview ? undefined : beginTraktActivation();
    try {
      device = await change('providers/trakt/start', { instanceId: provider.id, traktSync: linkSync });
      void activate?.(device);
    } catch (e) {
      void activate?.(null);
      error = message(e);
    } finally {
      busy = false;
    }
  }
  async function finish() {
    if (!device) return;
    const result = await action<{ pending?: boolean }>('providers/trakt/finish', {
      instanceId: provider.id,
      challengeId: device.challengeId,
    });
    pending = result?.result?.pending ?? false;
    if (result && !result.result?.pending) {
      device = null;
      if (!preview) notifyAction('Trakt connected.');
    }
  }
  function saveTraktSync() {
    const account = provider.connection!;
    return action(`providers/${account.id}/sync`, { traktSync, accountGeneration: account.accountGeneration }, 'Sync preferences saved.');
  }
  reportFailure(()=>error);
  reportFailure(()=>scanStatus.error ? `Could not refresh scan progress: ${scanStatus.error}` : scan?.state === 'failed' ? scan.error : '');
</script>

{#snippet controls()}
  {#if provider.connection?.status === 'connected'}<p class="small">
      Connected as {provider.connection.username}
    </p>
    {#if provider.provider === 'jellyfin'}<div class="stack">
        <SettingsSwitch label="Import watched status, resume progress and favourites from Jellyfin" bind:checked={importPlayback} disabled={busy} />
        <p class="small">
          Enabled by default. User activity syncs import playback state from this Jellyfin account when
          enabled. Turning it off keeps previously imported activity.
        </p>
        <div>
          <Button

            disabled={busy}
            onclick={() =>
              action(
                `providers/${provider.connection!.id}/playback-import`,
                {
                  enabled: importPlayback,
                },
                'Playback import preference saved.'
              )}>Save import preference</Button
          >
        </div>
        <p class="small">
          Your administrator’s next scheduled user sync will import existing playback state. Conflicts
          follow your conflict resolution preference; unresolved changes appear in Sync conflicts.
        </p>
        <SettingsSwitch label="Apply Coast tracking when items become available" bind:checked={reconcileTracking} disabled={busy} />
        <p class="small">Fill empty supported fields. Divergent server state follows your conflict preference. This setting is independent of imports.</p>
        <div><Button  disabled={busy} onclick={()=>action(`providers/${provider.connection!.id}/reconciliation`,{enabled:reconcileTracking},'Reconciliation preference saved.')}>Save reconciliation preference</Button></div>
      </div>{/if}
    {#if ['jellyfin','steam'].includes(provider.provider)}<div class="stack"><SettingsSwitch label="Read live activity" bind:checked={liveRead} disabled={busy} /><div><Button disabled={busy} onclick={()=>action(`providers/${provider.connection!.id}/live-read`,{enabled:liveRead},'Live activity preference saved.')}>Save live activity preference</Button></div></div>{/if}
    {#if provider.provider === 'steam'}<div class="stack">
      <SettingsSwitch label="Add newly imported owned games to Collection" bind:checked={steamImports.importOwned} disabled={busy} />
      <SettingsSwitch label="Import Steam playtime totals" bind:checked={steamImports.importPlaytime} disabled={busy} />
      <SettingsSwitch label="Import achievement progress" bind:checked={steamImports.importAchievements} disabled={busy} />
      <p class="small">Ownership availability is read from Steam. It does not establish installation. Turning imports off retains previous data; Coast never writes achievements or creates sessions from playtime totals.</p>
      <div><Button disabled={busy} onclick={()=>action(`providers/${provider.connection!.id}/steam-imports`,steamImports,'Steam import preferences saved.')}>Save import preferences</Button></div>
    </div>{/if}
    {#if provider.provider === 'trakt'}
      <AccessFields bind:sync={traktSync} disabled={busy} group={settingsGroup} />
      <div class="row">
        <Button disabled={busy} onclick={saveTraktSync}>Save sync preferences</Button>
      </div>
      <p class="small">
        Imports retain their Trakt source. Coast remains your authoritative tracker.
      </p>
      {#if savedSync.export.collection && traktSync.export.collection}
        {#key provider.connection.accountGeneration}<CollectionProjectionSettings connectionId={provider.connection.id} settings={provider.connection.settings} {sources} />{/key}
      {:else}
        <p class="small">To manage Trakt Collection exports, enable Export for Collection and save your sync preferences.</p>
      {/if}
    {/if}
    {#if provider.provider === 'jellyfin' && scan}
      <div class="scan-status" role="status" aria-live="polite">
        <div class="spread small">
          <strong>
            {scan.state === 'pending'
              ? scan.attempts
                ? 'Sync waiting to retry'
                : 'Sync queued'
              : scan.state === 'running'
                ? scan.phase === 'reconciling'
                  ? 'Finishing activity sync'
                  : 'Syncing activity'
                : scan.state === 'succeeded'
                  ? 'Activity sync complete'
                  : scan.state === 'failed'
                    ? 'Activity sync failed'
                    : 'Activity sync cancelled'}
          </strong>{#if scan.total !== null}<span
              >{scan.processed.toLocaleString()} / {scan.total.toLocaleString()}{#if scanning && scanPercent !== null}
                · {scanPercent}%{/if}</span
            >{:else if scanning}<span>{scan.processed.toLocaleString()} items processed</span>{/if}
        </div>
        {#if scanning}<OperationProgress label="Activity sync progress" processed={scan.processed} total={scan.total} />{/if}
      </div>
    {/if}

    <div class="row">
      <Button
        emphasis="subtle"
        disabled={busy}
        onclick={() => {
          error = '';
          void prepareDisconnect();
        }}>Disconnect</Button
      >
    </div>{:else if provider.provider === 'jellyfin'}<form
      class="stack"
      onsubmit={(e) => {
        e.preventDefault();
        void connect();
      }}
    >
      {#if dynamicCollectionExports.length}<p class="small">Collection export impact: {dynamicCollectionExports.join(', ')} will include this linked source after your access is assessed. Additions and unavailable identities are unresolved until user sync completes. Existing Trakt entries stay until cleanup is reviewed.</p>{/if}
      {#if settingsGroup}
        {#snippet credentials()}
          <JellyfinFields mode="credentials" bind:jellyfinName={username} bind:jellyfinPassword={password} />
        {/snippet}
        {@render settingsGroup(credentials)}
      {:else}
      <label class="field"
        >Jellyfin username<input bind:value={username} autocomplete="username" required /></label
      ><label class="field"
        >Jellyfin password<input
          type="password"
          bind:value={password}
          autocomplete="current-password"
          maxlength="4096"
        /></label
      >
      {/if}
      <Button type="submit" size="segment" disabled={busy}
        >{busy ? 'Connecting…' : 'Connect Jellyfin'}</Button
      >
    </form>{:else if provider.provider === 'steam'}<p class="small">Link your Steam account using Steam’s sign-in page. Game details must be readable for imports; signing in does not override Steam privacy.</p><Button disabled={busy||!provider.configured} onclick={startSteam}>Connect Steam</Button>{:else if provider.provider === 'trakt'}{#if device}<div>
        <p>
          Open <a class="text-accent" href={device.verificationUrl} target="_blank" rel="noreferrer"
            >Trakt’s activation page</a
          > and enter the code.
        </p>
        <PairingCode code={device.userCode} />
      </div>
      {#if pending}<p class="small">
          Waiting for authorisation. Finish on Trakt, then check again.
        </p>{/if}<Button  disabled={busy} onclick={finish}
        >I’ve authorised Coast</Button
      ><Button emphasis="subtle" disabled={busy} onclick={() => { device = null; pending = false; }}>Start again</Button>
      {:else}<AccessFields bind:sync={linkSync} disabled={busy || !provider.configured} group={settingsGroup} /><Button disabled={busy || !provider.configured} onclick={start}
        >Connect Trakt</Button
      >{/if}{:else}<p class="small">
      Your account is linked through the associated Jellyfin server. Connect Jellyfin to request
      titles.
    </p>{/if}
{/snippet}

{#if settingsGroup}
  <section class="connection-service">
    {#if service}
      <ServiceHeader provider={service} activateLabel={provider.name} id={`${serviceId}-label`} note={connectionNote}
        username={provider.connection?.username ?? ''} expanded={expanded} controls={serviceId}
        onactivate={toggleService} />
    {:else}
      {#snippet serviceRow()}
        <button type="button" class="menu-row service-trigger" aria-expanded={expanded} aria-controls={serviceId}
          onclick={toggleService}>
          <Icon name={serviceIcon} size={16} />
          <span class="service-name">{provider.name}</span>
          <span class="menu-row-note">{connectionNote}</span>
          <span class="service-chevron" class:expanded><Icon name="right" size={16} /></span>
        </button>
      {/snippet}
      {@render settingsGroup(serviceRow)}
    {/if}
    <ServiceDisclosure id={serviceId} {expanded}>
      {#if visited}<div class="panel stack">{@render controls()}</div>{/if}
    </ServiceDisclosure>
  </section>
{:else}
  <section class="panel stack">
  <div class="spread">
    <div class="row">
      <span class="provider-icon"
        ><Icon
          name={provider.provider === 'jellyfin'
            ? 'play'
            : provider.provider === 'trakt'
              ? 'check'
              : 'request'}
        /></span
      >
      <div class="row-text-stack">
        <h3>{provider.name}</h3>
        <p class="small">
          {provider.provider === 'jellyfin'
            ? 'Your media server'
            : provider.provider === 'trakt'
              ? 'Optional tracking sync'
              : provider.provider === 'steam' ? 'Owned games, playtime and achievements' : 'Media requests'}
        </p>
      </div>
    </div>
    <span class="badge" class:available={provider.connection?.status === 'connected'}
      >{provider.connection?.status === 'connected' ? 'Connected' : 'Not connected'}</span
    >
  </div>
    {@render controls()}
  </section>
{/if}
<Dialog bind:open={disconnect} title="Disconnect this account?"
  ><div class="stack">
    <p>
      Your imported tracking data stays in Coast. Pending external actions for this connection will
      be cancelled.
    </p>
    {#if sourceImpact?.accounts.length}<h3>Collection export impact</h3>{#each sourceImpact.accounts as account}<p>{account.removals.length} potential removals{account.uncertain?' · uncertain coverage or delivery':''} · {account.unresolved.length} unresolved identities.</p><ul>{#each account.removals.slice(0,60) as item}<li>{item.title}</li>{/each}</ul>{/each}<p class="small">Remote entries stay. Review Trakt Collection in Connections to approve removal after a fresh remote read.</p>{/if}
    <div class="row">
      <Button
        danger
        disabled={busy}
        onclick={async () => {
          if (
            await action(
              `providers/${provider.connection!.id}/disconnect`,
              {previewId:sourceImpact?.id},
              'Account disconnected. Tracking data retained.'
            )
          )
            disconnect = false;
        }}>Disconnect</Button
      ><Button  onclick={() => (disconnect = false)}>Keep connected</Button>
    </div>
  </div></Dialog
>

<style>
  .connection-service, .service-name { min-inline-size: 0; }
  .service-name { flex: 1; }
  .service-chevron { display: flex; flex: none; transition: transform var(--motion) var(--ease); }
  .service-chevron.expanded { transform: rotate(90deg); }
  @media (prefers-reduced-motion: reduce) { .service-chevron { transition: none; } }
  .scan-status {
    display: grid;
    gap: 10px;
  }
  .scan-status .spread {
    gap: 12px;
    flex-wrap: wrap;
  }
  .provider-icon {
    width: 42px;
    height: 42px;
    border: 1px solid var(--line);
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--surface);
  }
</style>
