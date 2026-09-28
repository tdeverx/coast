<script lang="ts">
  import { onMount } from 'svelte';
  import { api, change, message } from '$lib/ui/client';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import Dialog from './Dialog.svelte';
  let {
    provider,
  }: {
    provider: {
      id: string;
      name: string;
      provider: string;
      configured: boolean;
      connection: {
        id: string;
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
    device = $state<{ userCode: string; verificationUrl: string; interval: number } | null>(null),
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
  let importPlayback = $state(false);
  let sync = $state<Record<string, boolean>>({ ...defaultSync });
  $effect(() => {
    const key = `${provider.connection?.id}:${provider.connection?.status}`;
    if (key === initialized) return;
    initialized = key;
    importPlayback = provider.connection?.settings.importPlayback === true;
    sync = {
      ...defaultSync,
      ...(provider.connection?.settings.sync as Record<string, boolean>),
    };
  });
  async function action<T = unknown>(path: string, body: unknown = {}) {
    error = '';
    busy = true;
    try {
      return await change<T>(path, body);
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
  async function connect() {
    await action('providers/jellyfin', { instanceId: provider.id, username, password });
    password = '';
  }
  async function start() {
    busy = true;
    error = '';
    try {
      device = await api('providers/trakt/start', { instanceId: provider.id });
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
    pending = result?.pending ?? false;
    if (result && !result.pending) device = null;
  }
  const labels: Record<string, string> = {
    history: 'Watch history',
    progress: 'Viewing progress',
    collection: 'Provider collection state',
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
              : 'Media requests'}
        </p>
      </div>
    </div>
    <span class="badge" class:available={provider.connection?.status === 'connected'}
      >{provider.connection?.status === 'connected' ? 'Connected' : 'Not connected'}</span
    >
  </div>
  {#if error}<div class="notice error" role="alert">
      {error}
    </div>{/if}{#if provider.connection?.status === 'connected'}<p class="small">
      Connected as {provider.connection.username}
    </p>
    {#if provider.provider === 'jellyfin'}<div class="stack">
        <label class="check"
          ><input type="checkbox" bind:checked={importPlayback} disabled={busy} />Import watched
          status, resume progress and favourites from Jellyfin</label
        >
        <p class="small">
          Optional and off by default. Library scans import playback state from this Jellyfin
          account when enabled. Turning it off keeps previously imported activity.
        </p>
        <div>
          <Button
            variant="secondary"
            disabled={busy}
            onclick={() =>
              action(`providers/${provider.connection!.id}/playback-import`, {
                enabled: importPlayback,
              })}>Save import preference</Button
          >
        </div>
        <p class="small">
          Your administrator’s next scheduled scan will import existing playback state. Conflicts
          follow your conflict resolution preference; unresolved changes appear in Sync conflicts.
        </p>
      </div>{/if}
    {#if provider.provider === 'trakt'}<div class="sync-options">
        {#each Object.entries(labels) as [key, label]}<label class="check"
            ><input type="checkbox" bind:checked={sync[key]} />{label}</label
          >{/each}
      </div>
      <div class="row">
        <Button
          variant="secondary"
          disabled={busy}
          onclick={() => action(`providers/${provider.connection!.id}/sync`, sync)}
          >Save sync preferences</Button
        >
      </div>
      <p class="small">
        Imports retain their Trakt source. Coast remains your authoritative tracker.
      </p>{/if}
    {#if provider.provider === 'jellyfin' && scan}
      <div class="scan-status" role="status" aria-live="polite">
        <div class="spread small">
          <strong>
            {scan.state === 'pending'
              ? scan.attempts
                ? 'Scan waiting to retry'
                : 'Scan queued'
              : scan.state === 'running'
                ? scan.phase === 'reconciling'
                  ? 'Finishing library scan'
                  : 'Scanning library'
                : scan.state === 'succeeded'
                  ? 'Library scan complete'
                  : scan.state === 'failed'
                    ? 'Library scan failed'
                    : 'Library scan cancelled'}
          </strong>{#if scan.total !== null}<span
              >{scan.processed.toLocaleString()} / {scan.total.toLocaleString()}{#if scanning && scanPercent !== null}
                · {scanPercent}%{/if}</span
            >{:else if scanning}<span>{scan.processed.toLocaleString()} items processed</span>{/if}
        </div>
        {#if scanning}<progress
            aria-label="Library scan progress"
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
      <Button variant="ghost" disabled={busy} onclick={() => (disconnect = true)}>Disconnect</Button
      >
    </div>{:else if provider.provider === 'jellyfin'}<form
      class="stack"
      onsubmit={(e) => {
        e.preventDefault();
        void connect();
      }}
    >
      <label class="field"
        >Jellyfin username<input bind:value={username} autocomplete="username" required /></label
      ><label class="field"
        >Jellyfin password<input
          type="password"
          bind:value={password}
          autocomplete="current-password"
          required
        /></label
      ><Button variant="secondary" type="submit" disabled={busy}
        >{busy ? 'Connecting…' : 'Connect Jellyfin'}</Button
      >
    </form>{:else if provider.provider === 'trakt'}{#if device}<div class="notice">
        <p>
          Open <a class="text-accent" href={device.verificationUrl} target="_blank" rel="noreferrer"
            >Trakt’s activation page</a
          > and enter:
        </p>
        <strong class="device-code">{device.userCode}</strong>
      </div>
      {#if pending}<p class="small">
          Waiting for authorisation. Finish on Trakt, then check again.
        </p>{/if}<Button variant="secondary" disabled={busy} onclick={finish}
        >I’ve authorised Coast</Button
      >{:else}<Button variant="secondary" disabled={busy || !provider.configured} onclick={start}
        >Connect Trakt</Button
      >{/if}{:else}<p class="small">
      Your account is linked through the associated Jellyfin server. Connect Jellyfin to request
      titles.
    </p>{/if}
</section>
<Dialog bind:open={disconnect} title="Disconnect this account?"
  ><div class="stack">
    <p>
      Your imported tracking data stays in Coast. Pending external actions for this connection will
      be cancelled.
    </p>
    <div class="row">
      <Button
        variant="danger"
        onclick={async () => {
          await action(`providers/${provider.connection!.id}/disconnect`);
          disconnect = false;
        }}>Disconnect</Button
      ><Button variant="secondary" onclick={() => (disconnect = false)}>Keep connected</Button>
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
    font-size: 26px;
    letter-spacing: 0.15em;
    color: var(--ink);
    margin-top: 15px;
  }
  @media (max-width: 500px) {
    .sync-options {
      grid-template-columns: 1fr;
    }
  }
</style>
