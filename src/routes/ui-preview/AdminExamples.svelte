<script lang="ts">
  import AccountFields from '$lib/ui/components/AccountFields.svelte';
  import Brand from '$lib/ui/components/Brand.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Field from '$lib/ui/components/Field.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import RowFeedback from '$lib/ui/components/RowFeedback.svelte';
  import type { BenchmarkRun } from '$lib/benchmarks/model';

  let { name, scenario }: { name: string; scenario: string } = $props();
  const instance = $props.id();
  let enabled = $state(true), partyEnabled = $state(true), dirty = $state(false), saved = $state(''), revealed = $state(true);
  const busy = $derived(scenario === 'busy' || scenario === 'saving');
  const failure = $derived(scenario === 'error');
  $effect(() => {
    name; scenario;
    enabled = true; partyEnabled = true; dirty = false; saved = ''; revealed = scenario !== 'hidden';
  });
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || failure) return;
    dirty = false;
    saved = 'Preview saved. No account or installation settings were changed.';
  }
  const benchmarkHistory = $derived.by(() => {
    const run: BenchmarkRun = {
      id: '00000000-0000-4000-8000-000000000081', actionId: null, userId: null,
      state: scenario === 'running' ? 'running' : scenario === 'error' ? 'failed' : 'completed',
      workloadVersion: 'coast-local-v2', createdAt: '2026-10-16T10:00:00Z',
      startedAt: '2026-10-16T10:00:01Z', finishedAt: scenario === 'running' ? null : '2026-10-16T10:00:02Z',
      context: {
        build: 'Preview build', runtime: 'Bun preview', platform: 'darwin', arch: 'arm64', osRelease: 'Preview',
        cpuModel: 'Preview processor', cpuCount: 8, hostMemoryBytes: 16 * 1024 ** 3,
        memoryLimit: null, cpuLimit: null, database: 'PostgreSQL preview', databaseSettings: {},
        backgroundJobs: 0, dataset: { works: 1200, users: 12 }, datasetFingerprint: 'preview', environmentFingerprint: 'preview',
      },
      measurements: scenario === 'running' || scenario === 'error' ? null : {
        wallMs: 835, cpuUserMs: 52, cpuSystemMs: 8,
        memoryBefore: { rss: 120 * 1024 ** 2, heapUsed: 24 * 1024 ** 2, external: 2 * 1024 ** 2 },
        memoryAfter: { rss: 122 * 1024 ** 2, heapUsed: 25 * 1024 ** 2, external: 2 * 1024 ** 2 },
        peakObservedRss: 124 * 1024 ** 2, peakObservedHeap: 26 * 1024 ** 2,
        probes: { 'Database round trip': { samplesMs: [0.4, 0.5, 0.6, 0.4, 0.5], medianMs: 0.5, p95Ms: 0.6, rows: 1 },
          'Collection page': { samplesMs: [2, 2.5, 3, 2.5, 2.6], medianMs: 2.5, p95Ms: 3, rows: 60 } },
        datasetChanged: false, backgroundActivity: false,
      },
      comparisonKey: 'preview', errors: scenario === 'error' ? ['Benchmark interrupted. Run a new benchmark.'] : [],
    };
    return { runs: scenario === 'empty' ? [] : [run], total: scenario === 'empty' ? 0 : 1, page: 1, pages: 1, activeId: scenario === 'running' ? run.id : null };
  });
</script>

{#if name === 'auth'}
  {#if scenario === 'password'}
    <div class="panel stack form-width"><h3>Change password</h3><p class="small">Use at least 8 characters with uppercase, lowercase and a special character. Changing your password signs you out on every device and revokes your API tokens.</p><form class="stack" onsubmit={submit}><Field label="Current password"><input type="password" autocomplete="current-password" required /></Field><Field label="New password"><input type="password" autocomplete="new-password" minlength="8" required /></Field><Button type="submit">Update password</Button>{#if saved}<RowFeedback message={saved} />{/if}</form></div>
  {:else}
  <div class="auth-page"><div class="auth-card">
    <div class="row brand"><Brand /></div>
    <h1>{scenario === 'register' ? 'Join Coast.' : scenario === 'setup' ? 'A home for your stories.' : scenario === 'password' ? 'Change password' : 'Welcome back.'}</h1>
    <p>{scenario === 'register' ? 'Create your account, then connect your services to import your progress.' : scenario === 'setup' ? 'Create your administrator account to start tracking what you love. Your data stays with you.' : scenario === 'password' ? 'Use at least 8 characters with uppercase, lowercase and a special character.' : 'Pick up where you left off.'}</p>
    <form class="stack" onsubmit={submit}>
      {#if failure}<RowFeedback error="The username or password could not be verified." tag="p" class="notice error" />{/if}
      {#if scenario === 'register' || scenario === 'setup'}
        <AccountFields />
        {#if scenario === 'setup'}<Field label="Email" hint="Optional"><input type="email" autocomplete="email" /></Field>{/if}
      {:else if scenario === 'password'}
        <Field label="Current password"><input type="password" autocomplete="current-password" required /></Field>
        <Field label="New password"><input type="password" autocomplete="new-password" minlength="8" required /></Field>
      {:else}
        <Field label="Username"><input autocomplete="username" required maxlength="32" /></Field>
        <Field label="Password"><input type="password" autocomplete="current-password" required maxlength="128" /></Field>
      {/if}
      <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : scenario === 'register' ? 'Create account' : scenario === 'setup' ? 'Create your Coast' : scenario === 'password' ? 'Update password' : 'Sign in'}</Button>
      {#if saved}<RowFeedback message={saved} />{/if}
    </form>
    <div class="auth-footer">{#if scenario === 'setup'}Self-hosted. No telemetry. Yours to keep.{:else}<a href={scenario === 'register' ? '/login' : '/register'} onclick={event => event.preventDefault()}>{scenario === 'register' ? 'Already have an account? Sign in' : 'Create an account'}</a>{/if}</div>
  </div></div>
  {/if}
{:else if name === 'settings'}
  <form class="stack form-width" onsubmit={submit}>
    <fieldset class="panel stack" disabled={busy}>
      <div class="setting"><div><h3>Liquid glass</h3><p id={`${instance}-description`}>Use refracted glass where supported and its paired blur fallback elsewhere.</p></div><input type="checkbox" aria-label="Liquid glass" aria-describedby={`${instance}-description`} bind:checked={enabled} onchange={() => dirty = true} /></div>
      <div class="setting"><div><h3>Parties</h3><p id={`${instance}-party`}>Invite friends and keep playback in sync.</p>{#if scenario === 'unavailable'}<p id={`${instance}-reason`} class="small muted">Requires Social. Your choice is remembered.</p>{/if}</div><input type="checkbox" aria-label="Parties" disabled={scenario === 'unavailable'} aria-describedby={`${instance}-party${scenario === 'unavailable' ? ` ${instance}-reason` : ''}`} bind:checked={partyEnabled} onchange={() => dirty = true} /></div>
    </fieldset>
    <div class="save-controls">
      {#if failure}<RowFeedback error="Your changes have not been saved." tag="div" class="notice error" />{/if}
      <div class="row"><Button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save preferences'}</Button><Button emphasis="subtle" disabled={busy || !dirty} onclick={() => { enabled = true; partyEnabled = true; dirty = false; saved = ''; }}>Discard changes</Button></div>
      <p class="small" role="status" aria-live="polite">{busy ? 'Saving your changes…' : dirty ? 'Unsaved changes' : saved || 'Up to date'}</p>
    </div>
  </form>
{:else if name === 'operational-progress'}
  <div class="scan-status" role="status" aria-live="polite">
    <div class="spread small"><strong>{scenario === 'complete' ? 'Activity sync complete' : scenario === 'waiting' ? 'Sync waiting to retry' : failure ? 'Activity sync failed' : scenario === 'empty' ? 'No items to import' : 'Syncing activity'}</strong><span>{scenario === 'unknown' ? '12 items processed' : scenario === 'empty' ? '0 / 0' : scenario === 'complete' ? '40 / 40' : '12 / 40 · 30%'}</span></div>
    {#if scenario !== 'complete' && scenario !== 'empty' && !failure}<progress aria-label="Activity sync progress" max="100" value={scenario === 'unknown' ? undefined : 30}></progress>{/if}
    {#if failure}<RowFeedback error="Reconnect this account to resume activity sync." tag="p" class="small text-danger" />{/if}
  </div>
{:else if name === 'admin-table'}
  <div class="stack">
    <Heading title="Accounts" />
    {#if scenario === 'empty'}<p class="small">No matching accounts.</p>{:else}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (The horizontal scroll region needs keyboard access.) -->
      <div class="overflow" tabindex="0" role="region" aria-label="Accounts table"><table class="table"><caption class="sr-only">Coast accounts and linked services</caption><thead><tr><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Email</th><th scope="col">Linked accounts</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>
        {#each ['Alice', 'Sam'] as username}<tr><td>{username}</td><td>{username === 'Alice' ? 'admin' : 'user'}</td><td>Active<p class="small">Coast password</p></td><td>—</td><td><strong>Home</strong> · {username}<p class="small">Connected · 16/10/2026</p></td><td><Button emphasis="subtle" onclick={() => saved = `${username} selected. No account was changed.`}>Edit</Button></td></tr>{/each}
      </tbody></table></div>
    {/if}
    {#if saved}<RowFeedback message={saved} />{/if}
    <div class="health-grid"><div class="panel"><Icon name="server" /><h3>Database</h3><strong class="text-accent">Healthy</strong><p class="small">2 ms response</p></div><div class="panel"><Icon name="clock" /><h3>External actions</h3><strong>2 pending</strong><p class="small">0 need attention</p></div><div class="panel"><Icon name="shield" /><h3>Private by default</h3><strong>No telemetry</strong><p class="small">Your installation, your data</p></div></div>
  </div>
{:else if name === 'diagnostics'}
  {#if scenario === 'empty'}<EmptyState title="No diagnostics to review." description="Application and playback errors will appear here when they need your attention." icon="shield" />{:else}
    <div class="stack"><details class="panel"><summary>Audit activity</summary><div class="stack"><p>Diagnostic logging changed from info to debug · 16/10/2026, 10:00</p></div></details><details class="panel"><summary><strong>provider_request</strong> · A connected service is temporarily unavailable.<small class="diagnostic-date">16/10/2026, 10:01</small></summary><pre>{JSON.stringify({ level: 'warn', correlationId: 'preview-only', provider: 'Preview service', retryable: true }, null, 2)}</pre></details></div>
  {/if}
{:else if name === 'secret-output'}
  <div class="panel stack form-width">
    {#if revealed}<p role="status">{scenario === 'invite' ? 'Copy this code — shown once' : 'Copy this token now. It will not be shown again.'}</p><Field label={scenario === 'invite' ? 'Invite link' : 'API token'}><input readonly autocomplete="off" spellcheck={false} value={scenario === 'invite' ? 'https://coast.example/register#invite=synthetic-invite' : 'coast_preview_only_not_a_real_token'} onfocus={event => event.currentTarget.select()} /></Field><Button emphasis="subtle" onclick={() => revealed = false}>Hide</Button>{:else}<p class="small">The one-time value is hidden.</p>{/if}
  </div>
{:else if name === 'benchmark'}
  {#await import('$lib/benchmarks/BenchmarkSettings.svelte')}
    <RowFeedback message="Loading benchmark example…" />
  {:then module}<module.default history={benchmarkHistory} />{:catch}<RowFeedback error="The benchmark example could not load." />{/await}
{:else}<EmptyState title="No example available" description="Choose a registered example from the UI reference." />{/if}

<style>
  .setting { display:flex; align-items:center; gap:28px; padding:0 0 16px; border-bottom:1px solid var(--line); }
  .setting:last-child { padding-bottom:0; border-bottom:0; }
  .setting > div { flex:1; }
  .setting h3 { font-size:var(--text-sm); }
  .setting p { font-size:var(--text-sm); margin-top:6px; line-height:var(--leading-relaxed); }
  .setting input { flex:none; }
  .save-controls { display:grid; gap:12px; }
  fieldset { min-width:0; border:1px solid var(--line); }
  fieldset:disabled { opacity:0.75; }
  .scan-status { display:grid; gap:10px; }
  .scan-status .spread { gap:12px; flex-wrap:wrap; }
  progress { width:100%; height:6px; border:0; border-radius:99px; overflow:hidden; accent-color:var(--ink); }
  progress:indeterminate { background:linear-gradient(90deg,var(--line) 25%,var(--muted) 50%,var(--line) 75%); background-size:200% 100%; animation:scan-pending 1.8s linear infinite; }
  progress:indeterminate::-webkit-progress-bar { background:transparent; }
  progress::-webkit-progress-bar { background:var(--line); border-radius:99px; }
  progress::-webkit-progress-value { background:var(--ink); border-radius:99px; }
  progress::-moz-progress-bar { background:var(--ink); border-radius:99px; }
  @keyframes scan-pending { to { background-position:-200% 0; } }
  .health-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
  .health-grid .panel { display:grid; gap:10px; }
  .health-grid .panel :global(svg) { color:var(--muted); }
  .health-grid strong { font-size:var(--text-xl); font-weight:var(--weight-semibold); text-transform:capitalize; }
  .health-grid h3 { font-size:var(--text-sm); color:var(--muted); }
  .diagnostic-date { display:block; margin-top:6px; }
  pre { font-size:var(--text-sm); white-space:pre-wrap; overflow-wrap:anywhere; background:color-mix(in srgb,var(--canvas) calc(68 / 255 * 100%),transparent); padding:16px; border-radius:8px; margin-top:20px; }
  summary { font-size:var(--text-sm); color:var(--muted); }
  @media (max-width:800px) { .health-grid { grid-template-columns:1fr; } .health-grid .panel { padding:20px; } .setting { gap:16px; } }
  @media (prefers-reduced-motion:reduce) { progress:indeterminate { animation:none; } }
</style>
