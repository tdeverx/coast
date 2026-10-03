<script lang="ts">
  import RowFeedback from './RowFeedback.svelte';
  import CollectionProjectionSettings from './CollectionProjectionSettings.svelte';
  import type {SourceImpact} from '$lib/collection/source-changes.server';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { onMount, untrack } from 'svelte';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import Dialog from './Dialog.svelte';

  const { api, change } = useClient();

  let {
    provider,
    sources = [],
    dynamicCollectionExports = [],
  }: {
    sources?: {id:string;name:string}[];
    dynamicCollectionExports?: string[];
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
  let error = $state(''),
    busy = $state(false),
    username = $state(''),
    password = $state(''),
    disconnect = $state(false),
    device = $state<{
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
  let scan = $state<Scan | null>(null);
  let scanError = $state('');
  let sourceImpact=$state<SourceImpact|null>(null);
  async function prepareDisconnect(){sourceImpact=null;error='';busy=true;try{if(provider.provider==='jellyfin')sourceImpact=await api(`providers/${provider.connection!.id}/source-preview`,undefined,'GET');disconnect=true;}catch(e){error=message(e);}finally{busy=false;}}
  const scanning = $derived(scan?.state === 'pending' || scan?.state === 'running');
  const scanPercent = $derived(
    scan?.total ? Math.min(100, Math.floor((scan.processed / scan.total) * 100)) : null
  );
  async function refreshScan() {
    if (provider.provider !== 'jellyfin' || provider.connection?.status !== 'connected') return;
    try {
      scan = await api<Scan | null>(`providers/${provider.connection.id}/scan`, undefined, 'GET');
      scanError = '';
    } catch (e) {
      scanError = message(e);
    }
  }
  onMount(() => {
    let lastRefresh = 0;
    let refreshing = false;
    async function poll() {
      if (refreshing || document.hidden || (!scanning && Date.now() - lastRefresh < 15000)) return;
      refreshing = true;
      try {
        await refreshScan();
        lastRefresh = Date.now();
      } finally {
        refreshing = false;
      }
    }
    void poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  });
  let initialized = '';
  const defaultSync = {
    history: false,
    progress: false,
    collection: false,
    ratings: false,
    watchlist: false,
    lists: false,
    scrobble: false,
  };
  let liveRead=$state(untrack(()=>provider.connection?.settings.liveRead!==false));
  let reconcileTracking=$state(untrack(()=>provider.connection?.settings.reconcileTracking===true));
  let importPlayback = $state(
    untrack(() => provider.connection?.settings.importPlayback !== false)
  );
  let sync = $state<Record<string, boolean>>({ ...defaultSync });
  $effect(() => {
    const key = `${provider.connection?.id}:${provider.connection?.status}:${provider.connection?.accountGeneration}`;
    if (key === initialized) return;
    initialized = key;
    liveRead=provider.connection?.settings.liveRead!==false;
    importPlayback = provider.connection?.settings.importPlayback !== false;
    reconcileTracking = provider.connection?.settings.reconcileTracking === true;
    sync = {
      ...defaultSync,
      ...(provider.connection?.settings.sync as Record<string, boolean>),
    };
  });
  async function action<T = unknown>(path: string, body: unknown = {}, label?: string) {
    if (busy) return;
    error = '';
    busy = true;
    try {
      const result = await change<T>(path, body);
      if (label) notifyAction(label);
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
    if(result)window.location.assign(result.result.url);
  }
  let steamImports=$state({importOwned:true,importPlaytime:true,importAchievements:true});
  $effect(()=>{const settings=provider.connection?.settings;steamImports={importOwned:settings?.importOwned!==false,importPlaytime:settings?.importPlaytime!==false,importAchievements:settings?.importAchievements!==false};});
  async function start() {
    busy = true;
    error = '';
    try {
      device = await change('providers/trakt/start', { instanceId: provider.id });
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
  async function finish() {
    const result = await action<{ pending?: boolean }>('providers/trakt/finish', {
      instanceId: provider.id,
    });
    pending = result?.result?.pending ?? false;
    if (result && !result.result?.pending) {
      device = null;
      notifyAction('Trakt connected.');
    }
  }
  const labels: Record<string, string> = {
    history: 'Watch history',
    progress: 'Viewing progress',
    collection: 'Import Trakt Collection as Collected items',
    ratings: 'Ratings',
    watchlist: 'Watchlist',
    lists: 'Custom lists',
    scrobble: 'Live scrobbling',
  };
</script>

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
      <div>
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
  {#if error && !disconnect}<RowFeedback error={error} tag="div" class="notice error" />{/if}{#if provider.connection?.status === 'connected'}<p class="small">
      Connected as {provider.connection.username}
    </p>
    {#if provider.provider === 'jellyfin'}<div class="stack">
        <label class="check"
          ><input type="checkbox" bind:checked={importPlayback} disabled={busy} />Import watched
          status, resume progress and favourites from Jellyfin</label
        >
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
        <label class="check"><input type="checkbox" bind:checked={reconcileTracking} disabled={busy} />Apply Coast tracking when items become available</label>
        <p class="small">Fill empty supported fields. Divergent server state follows your conflict preference. This setting is independent of imports.</p>
        <div><Button  disabled={busy} onclick={()=>action(`providers/${provider.connection!.id}/reconciliation`,{enabled:reconcileTracking},'Reconciliation preference saved.')}>Save reconciliation preference</Button></div>
      </div>{/if}
    {#if provider.provider === 'steam'}<div class="stack">
      <label class="check"><input type="checkbox" bind:checked={steamImports.importOwned} disabled={busy} />Add newly imported owned games to Collection</label>
      <label class="check"><input type="checkbox" bind:checked={steamImports.importPlaytime} disabled={busy} />Import Steam playtime totals</label>
      <label class="check"><input type="checkbox" bind:checked={steamImports.importAchievements} disabled={busy} />Import achievement progress</label>
      <p class="small">Ownership availability is read from Steam. It does not establish installation. Turning imports off retains previous data; Coast never writes achievements or creates sessions from playtime totals.</p>
      <div><Button disabled={busy} onclick={()=>action(`providers/${provider.connection!.id}/steam-imports`,steamImports,'Steam import preferences saved.')}>Save import preferences</Button></div>
    </div>{/if}
    {#if provider.provider === 'trakt'}<div class="sync-options">
        <label class="check"><input type="checkbox" bind:checked={liveRead} disabled={busy} />Read live watching activity</label>
        {#each Object.entries(labels) as [key, label]}<label class="check"
            ><input type="checkbox" bind:checked={sync[key]} disabled={busy} />{label}</label
          >{/each}
      </div>
      <div class="row">
        <Button

          disabled={busy}
          onclick={() =>
            action(`providers/${provider.connection!.id}/sync`, {...sync,liveRead}, 'Sync preferences saved.')}
          >Save sync preferences</Button
        >
      </div>
      <p class="small">
        Imports retain their Trakt source. Coast remains your authoritative tracker.
      </p>
      {#key provider.connection.accountGeneration}<CollectionProjectionSettings connectionId={provider.connection.id} settings={provider.connection.settings} {sources} />{/key}{/if}
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
        {#if scanning}<progress
            aria-label="Activity sync progress"
            max="100"
            value={scanPercent ?? undefined}
          ></progress>{/if}
        {#if scan.error && scan.state !== 'succeeded'}<p class="small text-danger">
            {scan.error}
          </p>{/if}
      </div>
    {/if}
    {#if scanError}<p class="small text-danger" role="alert">
        Could not refresh scan progress: {scanError}
      </p>{/if}
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
      {#if dynamicCollectionExports.length}<p class="notice">Collection export impact: {dynamicCollectionExports.join(', ')} will include this linked source after your access is assessed. Additions and unavailable identities are unresolved until user sync completes. Existing Trakt entries stay until cleanup is reviewed.</p>{/if}
      <label class="field"
        >Jellyfin username<input bind:value={username} autocomplete="username" required /></label
      ><label class="field"
        >Jellyfin password<input
          type="password"
          bind:value={password}
          autocomplete="current-password"
          maxlength="4096"
        /></label
      ><Button  type="submit" disabled={busy}
        >{busy ? 'Connecting…' : 'Connect Jellyfin'}</Button
      >
    </form>{:else if provider.provider === 'steam'}<p class="small">Link your Steam account using Steam’s sign-in page. Game details must be readable for imports; signing in does not override Steam privacy.</p><Button disabled={busy||!provider.configured} onclick={startSteam}>Connect Steam</Button>{:else if provider.provider === 'trakt'}{#if device}<div class="notice">
        <p>
          Open <a class="text-accent" href={device.verificationUrl} target="_blank" rel="noreferrer"
            >Trakt’s activation page</a
          > and enter:
        </p>
        <strong class="device-code">{device.userCode}</strong>
      </div>
      {#if pending}<p class="small">
          Waiting for authorisation. Finish on Trakt, then check again.
        </p>{/if}<Button  disabled={busy} onclick={finish}
        >I’ve authorised Coast</Button
      >{:else}<Button  disabled={busy || !provider.configured} onclick={start}
        >Connect Trakt</Button
      >{/if}{:else}<p class="small">
      Your account is linked through the associated Jellyfin server. Connect Jellyfin to request
      titles.
    </p>{/if}
</section>
<Dialog bind:open={disconnect} title="Disconnect this account?"
  ><div class="stack">
    {#if error}<RowFeedback error={error} tag="p" class="notice error" />{/if}
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
  .scan-status {
    display: grid;
    gap: 10px;
  }
  .scan-status .spread {
    gap: 12px;
    flex-wrap: wrap;
  }
  progress {
    width: 100%;
    height: 6px;
    border: 0;
    border-radius: 99px;
    overflow: hidden;
    accent-color: var(--ink);
  }
  progress:indeterminate {
    background: linear-gradient(90deg, var(--line) 25%, var(--muted) 50%, var(--line) 75%);
    background-size: 200% 100%;
    animation: scan-pending 1.8s linear infinite;
  }
  progress:indeterminate::-webkit-progress-bar {
    background: transparent;
  }
  @keyframes scan-pending {
    to {
      background-position: -200% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    progress:indeterminate {
      animation: none;
    }
  }
  progress::-webkit-progress-bar {
    background: var(--line);
    border-radius: 99px;
  }
  progress::-webkit-progress-value {
    background: var(--ink);
    border-radius: 99px;
  }
  progress::-moz-progress-bar {
    background: var(--ink);
    border-radius: 99px;
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
  .sync-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .device-code {
    display: block;
    font-size: var(--text-2xl);
    letter-spacing: var(--tracking-wide);
    color: var(--ink);
    margin-top: 15px;
  }
  @media (max-width: 500px) {
    .sync-options {
      grid-template-columns: 1fr;
    }
  }
</style>
