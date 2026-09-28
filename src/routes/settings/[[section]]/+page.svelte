<script lang="ts">
  import PageHeader from '$lib/ui/components/PageHeader.svelte';
  import RowHeader from '$lib/ui/components/RowHeader.svelte';
  import JobsSettings from '$lib/ui/components/JobsSettings.svelte';
  import IntegrationSettings from '$lib/ui/components/IntegrationSettings.svelte';
  import ConflictList from '$lib/ui/components/ConflictList.svelte';
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { change, message } from '$lib/ui/client';
  import Button from '$lib/ui/components/Button.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import ConnectionCard from '$lib/ui/components/ConnectionCard.svelte';
  import QueueList from '$lib/ui/components/QueueList.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  let { data } = $props();
  let error = $state(''),
    success = $state(''),
    busy = $state(false),
    prefs = $state(untrack(() => ({ ...data.defaults, ...page.data.user?.settings }))),
    policy = $state(untrack(() => (data.config ? structuredClone(data.config) : null))),
    deleteId = $state('');
  const conflictServices = $derived(
    data.providers.filter(
      (p) => p.enabled && p.provider !== 'tmdb' && p.connection?.status === 'connected'
    )
  );
  const titles: Record<string, string> = {
    appearance: 'Appearance',
    playback: 'Playback',
    account: 'Account',
    connections: 'Connections',
    pending: 'Sync conflicts',
    jobs: 'Jobs & schedules',
    admin: 'Overview',
    integrations: 'Integrations',
    users: 'Accounts',
    policies: 'Policies',
    activity: 'Activity & diagnostics',
  };
  const links = [
    ['appearance', 'Appearance'],
    ['playback', 'Playback'],
    ['account', 'Account'],
    ['connections', 'Connections'],
    ['pending', 'Sync conflicts'],
  ];
  const adminLinks = [
    ['jobs', 'Jobs & schedules'],
    ['admin', 'Overview'],
    ['integrations', 'Integrations'],
    ['users', 'Accounts'],
    ['policies', 'Policies'],
    ['activity', 'Activity & diagnostics'],
  ];
  $effect(() => {
    if (data.config) policy = structuredClone(data.config);
  });
  async function save(path: string, body: unknown, label = 'Saved.', method = 'POST') {
    busy = true;
    error = '';
    success = '';
    try {
      await change(path, body, method);
      success = label;
      return true;
    } catch (e) {
      error = message(e);
      return false;
    } finally {
      busy = false;
    }
  }
  const values = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));
</script>

<svelte:head><title>{titles[data.section]} · Coast</title></svelte:head>
<div class="content page">
  <PageHeader title="Settings" description="Manage your preferences, connections and account." />
  <div class="settings-grid">
    <nav class="settings-nav" aria-label="Settings">
      <span class="group">You</span>{#each links as [key, label]}<a
          class:active={data.section === key}
          aria-current={data.section === key ? 'page' : undefined}
          href={key === 'appearance' ? '/settings' : `/settings/${key}`}>{label}</a
        >{/each}{#if page.data.user?.role === 'admin'}<span class="group">Administration</span
        >{#each adminLinks as [key, label]}<a
            class:active={data.section === key}
            aria-current={data.section === key ? 'page' : undefined}
            href="/settings/{key}">{label}</a
          >{/each}{/if}
    </nav>
    <section class="settings-main">
      <RowHeader title={titles[data.section]} />
      {#if error}<div class="notice error" role="alert" style="margin-bottom:20px">
          {error}
        </div>{/if}{#if success}<div
          class="notice success"
          role="status"
          style="margin-bottom:20px"
        >
          {success}
        </div>{/if}
      {#if data.section === 'appearance'}<form
          class="stack form-width"
          onsubmit={(e) => {
            e.preventDefault();
            void save('settings', prefs);
          }}
        >
          <div class="setting">
            <div>
              <h3>Full-width content</h3>
              <p>Let your library make the most of the screen. Heroes always stay edge-to-edge.</p>
            </div>
            <input type="checkbox" aria-label="Full-width content" bind:checked={prefs.fullWidth} />
          </div>
          <div class="setting">
            <div>
              <h3>Prefer original titles</h3>
              <p>Use a title’s original language where it is available.</p>
            </div>
            <input
              type="checkbox"
              aria-label="Prefer original titles"
              bind:checked={prefs.originalTitles}
            />
          </div>
          <label class="field"
            >Region<select bind:value={prefs.region}
              ><option value="GB">United Kingdom</option><option value="US">United States</option
              ><option value="CA">Canada</option><option value="AU">Australia</option><option
                value="DE">Germany</option
              ><option value="FR">France</option><option value="JP">Japan</option><option value="IN"
                >India</option
              ></select
            ><small>Used for age certificates and regional metadata.</small></label
          >
          <div class="setting">
            <div>
              <h3>Silence optional notifications</h3>
              <p>
                Keep optional updates in your inbox. Important administrator notices still appear.
              </p>
            </div>
            <input
              type="checkbox"
              aria-label="Silence optional notifications"
              bind:checked={prefs.notificationsSilenced}
            />
          </div>
          <div class="row">
            <Button type="submit" disabled={busy}>Save preferences</Button><Button
              variant="ghost"
              onclick={async () => {
                if (await save('settings/reset', {}, 'Administrator defaults restored.'))
                  prefs = { ...data.defaults };
              }}>Reset to administrator defaults</Button
            >
          </div>
        </form>
      {:else if data.section === 'playback'}<form
          class="stack form-width"
          onsubmit={(e) => {
            e.preventDefault();
            void save('settings', prefs);
          }}
        >
          <div class="setting">
            <div>
              <h3>Always enable subtitles</h3>
              <p>Choose a matching subtitle track whenever one is available.</p>
            </div>
            <input
              type="checkbox"
              aria-label="Always enable subtitles"
              bind:checked={prefs.subtitlesAlways}
            />
          </div>
          <label class="field"
            >Preferred subtitle languages<input
              value={prefs.subtitleLanguages?.join(', ') ?? 'en'}
              onchange={(e) =>
                (prefs.subtitleLanguages = e.currentTarget.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean))}
              placeholder="en, fr"
            /><small>Language codes in preference order, separated by commas.</small></label
          >
          <div class="setting">
            <div>
              <h3>Ask before playback</h3>
              <p>Choose subtitle preferences before starting a title.</p>
            </div>
            <input
              type="checkbox"
              aria-label="Ask before playback"
              bind:checked={prefs.subtitlePrompt}
            />
          </div>
          <p class="small">
            Quality and delivery follow the administrator’s server policy. You can choose an
            available edition on a title’s details page.
          </p>
          <Button type="submit" disabled={busy}>Save playback preferences</Button>
        </form>
      {:else if data.section === 'account'}<div class="stack form-width">
          <div class="panel">
            <h3>{page.data.user?.username}</h3>
            <p class="small">
              {page.data.user?.email ?? 'No email address'} · {page.data.user?.role === 'admin'
                ? 'Administrator'
                : 'Coast account'}
            </p>
          </div>
          <h3>Change password</h3>
          <form
            class="stack"
            onsubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              if (
                await save(
                  'settings/password',
                  values(form),
                  'Password updated. Sign in again with your new password.'
                )
              )
                form.reset();
            }}
          >
            <label class="field"
              >Current password<input
                type="password"
                name="currentPassword"
                autocomplete="current-password"
                required
              /></label
            ><label class="field"
              >New password<input
                type="password"
                name="password"
                autocomplete="new-password"
                minlength="12"
                required
              /></label
            ><Button type="submit" disabled={busy}>Update password</Button>
          </form>
          <div class="divider"></div>
          <h3>About Coast</h3>
          <p class="small">
            Coast 0.1.0 · AGPL-3.0-only<br />Your installation owns your tracking data. No telemetry
            is sent to Coast developers.
          </p>
          <p class="small">
            Metadata supplied by TMDB when configured. This product is not endorsed or certified by
            TMDB.
          </p>
        </div>
      {:else if data.section === 'connections'}<div class="stack form-width">
          <p>Connect the accounts you use. Your tracking stays in Coast when you disconnect.</p>
          <form
            class="stack"
            onsubmit={(event) => {
              event.preventDefault();
              void save('settings', prefs);
            }}
          >
            <label
              >Conflict resolution
              <select bind:value={prefs.syncConflictWinner}>
                <option value="manual">Manual — review every conflict</option>
                <option value="coast">Coast wins automatically</option>
                {#each conflictServices as service}
                  <option value={service.connection!.id}
                    >{service.name}{service.connection!.username
                      ? ` · ${service.connection!.username}`
                      : ''} wins automatically</option
                  >
                {/each}
                {#if !['manual', 'coast'].includes(prefs.syncConflictWinner) && !conflictServices.some((p) => p.connection!.id === prefs.syncConflictWinner)}
                  <option value={prefs.syncConflictWinner}
                    >Preferred account unavailable — manual review</option
                  >
                {/if}
              </select>
            </label>
            <p class="small">
              The winner replaces conflicting values in Coast and other enabled sync destinations.
              Your choice applies when syncing; conflicts the preferred account cannot resolve stay
              in Sync conflicts. Sync permissions and enabled categories still apply.
            </p>
            <div>
              <Button type="submit" variant="primary" disabled={busy}>Save preference</Button>
            </div>
          </form>
          {#each data.providers.filter((p) => p.provider !== 'tmdb') as p}<ConnectionCard
              provider={p}
            />{/each}{#if !data.providers.some((p) => p.provider !== 'tmdb')}<EmptyState
              title="Connect your world."
              description="An administrator can add Jellyfin, Trakt, and Seerr integrations. Then you can link your own accounts here."
              icon="server"
              >{#if page.data.user?.role === 'admin'}<Button href="/settings/integrations"
                  >Add an integration</Button
                >{/if}</EmptyState
            >{/if}
        </div>
      {:else if data.section === 'jobs'}<JobsSettings
          providers={data.providers}
          actions={data.actions}
        />
      {:else if data.section === 'pending'}<p class="small" style="margin-bottom:20px">
          Choose which service should win when saved changes disagree. Background sync is managed by
          your administrator.
        </p>
        <ConflictList conflicts={data.conflicts} />
      {:else if data.section === 'admin'}<div class="stack">
          <div class="health-grid">
            <div class="panel">
              <Icon name="server" />
              <h3>Database</h3>
              <strong class="text-accent">{data.health?.database.status}</strong>
              <p class="small">{data.health?.database.latencyMs} ms response</p>
            </div>
            <div class="panel">
              <Icon name="clock" />
              <h3>External actions</h3>
              <strong>{data.actions.filter((a) => a.state === 'pending').length} pending</strong>
              <p class="small">
                {data.actions.filter((a) => a.state === 'failed').length} need attention
              </p>
            </div>
            <div class="panel">
              <Icon name="shield" />
              <h3>Private by default</h3>
              <strong>No telemetry</strong>
              <p class="small">Your installation, your data</p>
            </div>
          </div>
          <RowHeader title="Integration health"
            >{#snippet actions()}<a class="small text-accent" href="/settings/integrations"
                >Manage integrations</a
              >{/snippet}</RowHeader
          >
          {#if data.providers.length}<div class="panel">
              {#each data.providers as p}<div class="spread integration-row">
                  <span>{p.name}</span><span class="badge"
                    >{p.configured ? 'Configured' : 'Needs setup'}</span
                  >
                </div>{/each}
            </div>{:else}<p class="small">
              No services are connected yet. You can still track titles in Coast.
            </p>{/if}
          <h3>Requests needing attention</h3>
          {#if data.requests.filter((r) => r.request.state === 'pending').length}<div
              class="overflow"
            >
              <table class="table">
                <thead
                  ><tr><th>Title</th><th>User</th><th>Destination</th><th>Action</th></tr></thead
                ><tbody
                  >{#each data.requests.filter((r) => r.request.state === 'pending') as r}<tr
                      ><td>{r.title}</td><td>{r.username}</td><td>{r.destination}</td><td
                        ><div class="row">
                          <Button
                            variant="secondary"
                            onclick={() =>
                              save(
                                `requests/${r.request.id}`,
                                { action: 'approve' },
                                'Approval queued.'
                              )}>Approve</Button
                          ><Button
                            variant="ghost"
                            onclick={() =>
                              save(
                                `requests/${r.request.id}`,
                                { action: 'decline' },
                                'Decline queued.'
                              )}>Decline</Button
                          >
                        </div></td
                      ></tr
                    >{/each}</tbody
                >
              </table>
            </div>{:else}<p class="small">No requests need attention.</p>{/if}
          <h3>Failed actions</h3>
          <QueueList
            actions={data.actions.filter((a) => a.state === 'failed')}
            emptyTitle="No failed jobs"
            emptyDescription="Jobs that need attention will appear here."
          />
          <h3>Send an important notice</h3>
          <form
            class="stack form-width"
            onsubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                body = values(form);
              if (
                await save(
                  'notifications/broadcast',
                  { ...body, locked: body.locked === 'on' },
                  'Notice delivered.'
                )
              )
                form.reset();
            }}
          >
            <label class="field">Title<input name="title" required maxlength="160" /></label><label
              class="field"
              >Message<textarea name="body" rows="3" maxlength="2000"></textarea></label
            ><label class="field"
              >Presentation<select name="level"
                ><option value="normal">Normal — toast and inbox</option><option value="persistent"
                  >Persistent — requires dismissal</option
                ><option value="silent">Silent — inbox only</option></select
              ></label
            ><label class="check"
              ><input type="checkbox" name="locked" />Prevent silencing this notice</label
            ><Button type="submit" disabled={busy}>Send notice</Button>
          </form>
        </div>
      {:else if data.section === 'integrations'}<IntegrationSettings providers={data.providers} />
      {:else if data.section === 'users'}<div class="stack">
          <div class="overflow">
            <table class="table">
              <thead
                ><tr
                  ><th>Username</th><th>Role</th><th>Email</th><th>Linked accounts</th><th></th></tr
                ></thead
              ><tbody
                >{#each data.users as user}<tr
                    ><td>{user.username}</td><td>{user.role}</td><td>{user.email ?? '—'}</td><td
                      >{#each data.supportConnections.filter((connection) => connection.userId === user.id) as connection}<div
                        >
                          <strong>{connection.provider}</strong> · {connection.username ??
                            'Unlinked'}
                          <p class="small">
                            {connection.status} · {new Date(
                              connection.updatedAt
                            ).toLocaleDateString()}
                          </p>
                        </div>{/each}</td
                    ><td
                      >{#if user.id !== page.data.user?.id}<Button
                          variant="ghost"
                          onclick={() => (deleteId = user.id)}>Delete</Button
                        >{/if}</td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
          <h3>Create a Coast account</h3>
          <form
            class="stack form-width"
            onsubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                body = values(form);
              if (
                await save(
                  'admin/users',
                  { ...body, email: body.email || undefined },
                  'Account created.'
                )
              )
                form.reset();
            }}
          >
            <label class="field"
              >Username<input name="username" required minlength="3" maxlength="32" /></label
            ><label class="field"
              >Password<input
                name="password"
                type="password"
                required
                minlength="12"
                autocomplete="new-password"
              /></label
            ><label class="field"
              >Email <small>Optional</small><input name="email" type="email" /></label
            ><label class="field"
              >Role<select name="role"
                ><option value="user">User</option><option value="admin">Administrator</option
                ></select
              ></label
            ><Button type="submit" disabled={busy}>Create account</Button>
          </form>
        </div>
      {:else if data.section === 'policies' && policy}<form
          class="stack form-width"
          onsubmit={(e) => {
            e.preventDefault();
            void save('settings/system', policy);
          }}
        >
          <h3>Sessions</h3>
          <label class="field"
            >Session lifetime in days<input
              type="number"
              min="1"
              max="365"
              bind:value={policy.sessionLifetimeDays}
            /><small>Activity refreshes an active session.</small></label
          >
          <h3>Playback</h3>
          <label class="field"
            >Delivery policy<select bind:value={policy.playbackDelivery}
              ><option value="direct-and-relay">Allow direct and relayed/transcoded playback</option
              ><option value="relay-only">Relay/transcode only</option></select
            ></label
          ><label class="field"
            >Maximum bitrate (Mbps)<input
              type="number"
              min="1"
              max="1000"
              bind:value={policy.maxBitrateMbps}
            /></label
          ><label class="check"
            ><input type="checkbox" bind:checked={policy.allowTranscoding} />Allow Jellyfin
            transcoding</label
          ><label class="field"
            >Default subtitle mode<select bind:value={policy.subtitleDefault}
              ><option value="off">Off</option><option value="preferred">Preferred languages</option
              ><option value="always">Always enable</option></select
            ></label
          ><label class="field"
            >Default subtitle languages<input
              value={policy.subtitleLanguages.join(', ')}
              onchange={(e) => {
                if (!policy) return;
                policy.subtitleLanguages = e.currentTarget.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
              }}
            /></label
          >
          <h3>Metadata</h3>
          <label class="field"
            >Shared metadata source<select bind:value={policy.metadataSource}
              ><option value="local-preferred">Prefer local server metadata</option><option
                value="tmdb-only">TMDB exclusively</option
              ></select
            ></label
          >
          <label class="check"
            ><input type="checkbox" bind:checked={policy.cacheTmdbArtwork} />Cache TMDB artwork on
            this server</label
          >
          <p class="small muted">
            Off by default. Save local copies of TMDB images when viewed. Jellyfin images always
            come from your media server; browser caching still applies. Turning this off bypasses
            saved TMDB copies and stops new disk writes.
          </p>
          <h3>Integrations & network</h3>
          <label class="check"
            ><input type="checkbox" bind:checked={policy.enableTrakt} />Allow Trakt synchronisation</label
          ><label class="check"
            ><input type="checkbox" bind:checked={policy.enableRequests} />Allow media requests</label
          ><label class="field"
            >Allowed provider ports<input
              value={policy.allowedProviderPorts.join(', ')}
              onchange={(e) => {
                if (!policy) return;
                policy.allowedProviderPorts = e.currentTarget.value
                  .split(',')
                  .map((s) => Number(s.trim()))
                  .filter(Number.isFinite);
              }}
            /></label
          ><label class="field"
            >Server allowlist<textarea
              rows="3"
              value={policy.serverAllowlist.join('\n')}
              onchange={(e) => {
                if (!policy) return;
                policy.serverAllowlist = e.currentTarget.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean);
              }}
            ></textarea><small>One hostname per line. Leave empty to use approved instances.</small
            ></label
          >
          <h3>Notifications</h3>
          <label class="field"
            >Default presentation<select bind:value={policy.notificationLevel}
              ><option value="silent">Inbox only</option><option value="normal"
                >Toast and inbox</option
              ><option value="persistent">Requires dismissal</option></select
            ></label
          ><label class="check"
            ><input type="checkbox" bind:checked={policy.allowNotificationSilencing} />Allow users
            to silence optional notifications</label
          ><Button type="submit" disabled={busy}>Save system policies</Button>
        </form>
      {:else if data.section === 'activity'}<p class="small" style="margin-bottom:24px">
          Administrator diagnostics include application and playback failures. Sensitive credentials
          are redacted.
        </p>
        {#if data.diagnostics.length}<div class="stack">
            {#each data.diagnostics as event}<details class="panel">
                <summary
                  ><strong>{event.kind}</strong> · {event.message}<small
                    style="display:block;margin-top:6px"
                    >{new Date(event.createdAt).toLocaleString()}</small
                  ></summary
                >
                <pre>{JSON.stringify(event.detail, null, 2)}</pre>
              </details>{/each}
          </div>{:else}<EmptyState
            title="No diagnostics to review."
            description="Application and playback errors will appear here when they need your attention."
            icon="shield"
          />{/if}{/if}
    </section>
  </div>
</div>
<Dialog onclose={() => (deleteId = '')} open={!!deleteId} title="Delete this Coast account?"
  ><div class="stack">
    <p>
      This removes the Coast account and its local tracking data. Linked service accounts will
      remain intact.
    </p>
    <p class="small">External account deletion is not supported by the current adapters.</p>
    <div class="row">
      <Button
        variant="danger"
        onclick={async () => {
          if (await save(`admin/users/${deleteId}`, {}, 'Account deleted.', 'DELETE'))
            deleteId = '';
        }}>Delete Coast account</Button
      ><Button variant="secondary" onclick={() => (deleteId = '')}>Cancel</Button>
    </div>
  </div></Dialog
>

<style>
  .settings-main {
    min-width: 0;
    max-width: 1100px;
  }
  .setting {
    display: flex;
    align-items: center;
    gap: 28px;
    padding: 0 0 24px;
    border-bottom: 1px solid var(--line-soft);
  }
  .setting > div {
    flex: 1;
  }
  .setting h3 {
    font-size: 13px;
  }
  .setting p {
    font-size: 11px;
    margin-top: 6px;
    line-height: 1.7;
  }
  .setting input {
    flex: none;
  }
  .health-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .health-grid .panel {
    display: grid;
    gap: 10px;
  }
  .health-grid .panel :global(svg) {
    color: var(--muted);
  }
  .health-grid strong {
    font-size: 18px;
    font-weight: 550;
    text-transform: capitalize;
  }
  .health-grid h3 {
    font-size: 11px;
    color: var(--muted);
  }
  .integration-row + .integration-row {
    margin-top: 20px;
  }
  .integration-row span:first-child {
    font-size: 12px;
  }
  pre {
    font-size: 10px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: #0004;
    padding: 16px;
    border-radius: 8px;
    margin-top: 20px;
  }
  summary {
    font-size: 11px;
    color: var(--muted);
  }
  @media (max-width: 800px) {
    .health-grid {
      grid-template-columns: 1fr;
    }
    .health-grid .panel {
      padding: 20px;
    }
    .setting {
      gap: 16px;
    }
  }
</style>
