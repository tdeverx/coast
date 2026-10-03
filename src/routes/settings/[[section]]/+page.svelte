<script lang="ts">
  import { collectionCategories, collectionRules } from '$lib/collection/preferences';
  import {audiences,socialSections,socialCategories,type Audience} from '$lib/social/model';
  import {
    personalSettings as links,
    administratorSettings as adminLinks,
    settingsTitles as titles,
    settingsDescriptions as descriptions,
    preferenceFields,
    policyFields,
    policyGroups,
    selectSettings,
  } from '$lib/settings/sections';
  import Heading from '$lib/ui/components/Heading.svelte';
  import JobsSettings from '$lib/ui/components/JobsSettings.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  import IntegrationSettings from '$lib/ui/components/IntegrationSettings.svelte';
  import ConflictList from '$lib/ui/components/ConflictList.svelte';
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';

  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { change, message } from '$lib/ui/client';
  import Button from '$lib/ui/components/Button.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import ConnectionCard from '$lib/ui/components/ConnectionCard.svelte';
  import QueueList from '$lib/ui/components/QueueList.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  let { data } = $props();
  let inviteCode=$state('');
  let error = $state(''),
    success = $state(''),
    busy = $state(false),
    prefs = $state(untrack(() => structuredClone({ ...data.defaults, ...page.data.user?.settings }))),
    policy = $state(untrack(() => (data.config ? structuredClone(data.config) : null))),
    deleteId = $state(''),
    resetOpen = $state(false),
    subtitleLanguagesText = $state(untrack(() => prefs.subtitleLanguages.join(', '))),
    policyLanguagesText = $state(untrack(() => policy?.subtitleLanguages.join(', ') ?? '')),
    portsText = $state(untrack(() => policy?.allowedProviderPorts.join(', ') ?? '')),
    allowlistText = $state(untrack(() => policy?.serverAllowlist.join('\n') ?? ''));
  const splitValues = (text: string, separator: string) =>
    text
      .split(separator)
      .map((value) => value.trim())
      .filter(Boolean);
  let editing = $state<{
    id: string;
    username: string;
    email: string;
    role: 'admin' | 'user';
    disabled: boolean;
    password: string;
  } | null>(null);
  let initializedSection = untrack(() => data.section);
  const fields = $derived(
    data.section === 'policies'
      ? policyFields
      : data.section === 'activity'
        ? ['diagnosticLevel']
        : data.section === 'users'
          ? ['jellyfinAutoCreateUsers', 'jellyfinSyncAdmins']
          : (preferenceFields[data.section as keyof typeof preferenceFields] ?? [])
  );
  let saved = $state(
    untrack(() =>
      JSON.stringify(
        selectSettings(
          ['policies', 'activity', 'users'].includes(data.section) ? (policy ?? {}) : prefs,
          fields
        )
      )
    )
  );
  const draft = $derived({
    ...selectSettings(
      ['policies', 'activity', 'users'].includes(data.section) ? (policy ?? {}) : prefs,
      fields
    ),
    ...(data.section === 'playback'
      ? { subtitleLanguages: splitValues(subtitleLanguagesText, ',') }
      : {}),
    ...(data.section === 'policies'
      ? {
          subtitleLanguages: splitValues(policyLanguagesText, ','),
          allowedProviderPorts: splitValues(portsText, ',').map(Number),
          serverAllowlist: splitValues(allowlistText, '\n'),
        }
      : {}),
  });
  const dirty = $derived(fields.length > 0 && JSON.stringify(draft) !== saved);
  function restoreDraft() {
    prefs = structuredClone({ ...data.defaults, ...page.data.user?.settings });
    policy = data.config ? structuredClone(data.config) : null;
    subtitleLanguagesText = prefs.subtitleLanguages.join(', ');
    policyLanguagesText = policy?.subtitleLanguages.join(', ') ?? '';
    portsText = policy?.allowedProviderPorts.join(', ') ?? '';
    allowlistText = policy?.serverAllowlist.join('\n') ?? '';
    saved = JSON.stringify(
      selectSettings(
        ['policies', 'activity', 'users'].includes(data.section) ? (policy ?? {}) : prefs,
        fields
      )
    );
    error = '';
    success = '';
  }
  beforeNavigate(({ cancel, to }) => {
    if (to?.url.pathname === page.url.pathname) return;
    if (busy || (dirty && !window.confirm('Discard unsaved settings?'))) cancel();
  });
  const conflictServices = $derived(
    data.providers.filter(
      (p) =>
        p.enabled && !['tmdb', 'igdb'].includes(p.provider) && p.connection?.status === 'connected'
    )
  );
  $effect(() => {
    // Background refreshes must not erase unsaved edits on the current page.
    if (data.section === initializedSection) return;
    initializedSection = data.section;
    untrack(restoreDraft);
  });
  async function saveDraft() {
    const submitted = $state.snapshot(draft);
    if (
      await save(
        ['policies', 'activity', 'users'].includes(data.section) ? 'settings/system' : 'settings',
        submitted,
        data.section === 'activity'
          ? 'Diagnostic logging updated. Changes are active now.'
          : data.section === 'policies'
            ? 'System policies saved. Changes are active now.'
            : data.section === 'users'
              ? 'Jellyfin sign-in policies saved.'
              : 'Preferences saved.'
      )
    ) {
      restoreDraft();
      success =
        data.section === 'activity'
          ? 'Diagnostic logging updated. Changes are active now.'
          : data.section === 'policies'
            ? 'System policies saved. Changes are active now.'
            : data.section === 'users'
              ? 'Jellyfin sign-in policies saved.'
              : 'Preferences saved.';
    }
  }
  async function save(path: string, body: unknown, label = 'Saved.', method = 'POST') {
    if (busy) return false;
    busy = true;
    error = '';
    success = '';
    try {
      await change(path, body, method);
      success = label;
      if (!fields.length) notifyAction(label);
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

{#snippet saveControls(label: string)}
  <div class="save-controls">
    {#if error}<div class="notice error" role="alert">
        {error} Your changes have not been saved.
      </div>{/if}
    <div class="row">
      <Button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : label}</Button>
      <Button emphasis="subtle" disabled={busy || !dirty} onclick={restoreDraft}
        >Discard changes</Button
      >
    </div>
    <p class="small" role="status" aria-live="polite">
      {busy ? 'Saving your changes…' : dirty ? 'Unsaved changes' : success || 'Up to date'}
    </p>
  </div>
{/snippet}

<svelte:head><title>{titles[data.section]} · Coast</title></svelte:head>
<div class="content page">
  <Heading variant="page" title="Settings" description="Manage your preferences, connections and account." />
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
          >{/each}<a href="/ui-preview">UI reference</a>{/if}
    </nav>
    <section class="settings-main" aria-label={titles[data.section]}>
      <Heading title={titles[data.section]} />


      <p class="section-description small">{descriptions[data.section]}</p>
      {#if error && !fields.length && !['account', 'users'].includes(data.section) && !deleteId && !resetOpen}<div
          class="notice error"
          role="alert"
          style="margin-bottom:20px"
        >
          {error}
        </div>{/if}
      {#if data.section === 'collection'}
        <form class="stack form-width" onsubmit={event=>{event.preventDefault();void saveDraft();}}>
        <p class="small">Explicitly collected items always stay in Collection. These rules only control automatic membership.</p>
        {#each collectionCategories as category}
          <fieldset class="panel stack" disabled={busy}>
            <legend class="sr-only">{category.label}</legend><h3>{category.label}</h3>
            {#each collectionRules as rule}
              <label class="check"><input type="checkbox" bind:checked={prefs.collection[category.value][rule.value]} />{rule.label}</label>
            {/each}
          </fieldset>
        {/each}
        {@render saveControls('Save Collection preferences')}
        </form>
      {:else if data.section==='privacy'}
  <form class="stack form-width" onsubmit={event=>{event.preventDefault();void saveDraft();}}><fieldset class="panel stack" disabled={busy}><legend class="sr-only">Privacy & social</legend>
  <label class="field">Profile audience<select bind:value={prefs.social.audience}>{#each audiences as audience}<option value={audience}>{audience}</option>{/each}</select></label>
  <p class="small">A private profile is hidden from everyone else. Other sections can have their own audience.</p>
  {#each socialSections as section}<label class="field">{section}<select value={prefs.social.sections?.[section]??'default'} onchange={event=>{const value=event.currentTarget.value;prefs.social={...prefs.social,sections:{...prefs.social.sections,[section]:value==='default'?undefined:value as Audience}};}}><option value="default">Use profile audience</option>{#each audiences as audience}<option value={audience}>{audience}</option>{/each}</select></label>{/each}
  {#each socialCategories as category}<label class="field">{category} sharing<select value={prefs.social.categories?.[category]??'public'} onchange={event=>{prefs.social={...prefs.social,categories:{...prefs.social.categories,[category]:event.currentTarget.value as Audience}};}}>{#each audiences as audience}<option value={audience}>{audience==='public'?'Use section audience':audience}</option>{/each}</select></label>{/each}
  <Heading title="Social notifications" />
  {#each ['friend-accepted','recommendation','reaction','synced-invite'] as const as kind}<label class="check"><input type="checkbox" checked={prefs.social.notifications?.[kind]!==false} onchange={event=>{prefs.social={...prefs.social,notifications:{...prefs.social.notifications,[kind]:event.currentTarget.checked}};}} />{kind==='synced-invite'?'Synced session invitations':kind}</label>{/each}
  <p class="small">Incoming friend requests appear in Friends.</p>
  {@render saveControls('Save privacy preferences')}
  </fieldset></form>
{:else if data.section === 'appearance'}<form
          class="stack form-width"
          onsubmit={(e) => {
            e.preventDefault();
            void saveDraft();
          }}
        >
          <fieldset class="panel stack" disabled={busy}>
            <legend class="sr-only">Display</legend>
            <h3>Display</h3>
            <div class="setting">
              <div>
                <h3>Full-width content</h3>
                <p>
                  Let your library make the most of the screen. Heroes always stay edge-to-edge.
                </p>
              </div>
              <input
                type="checkbox"
                aria-label="Full-width content"
                bind:checked={prefs.fullWidth}
              />
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
          </fieldset>
          <fieldset class="panel stack" disabled={busy}>
            <legend class="sr-only">Regional metadata</legend>
            <h3>Regional metadata</h3>
            <label class="field"
              >Region<select bind:value={prefs.region}
                ><option value="GB">United Kingdom</option><option value="US">United States</option
                ><option value="CA">Canada</option><option value="AU">Australia</option><option
                  value="DE">Germany</option
                ><option value="FR">France</option><option value="JP">Japan</option><option
                  value="IN">India</option
                ></select
              ><small>Used for age certificates and regional metadata.</small></label
            >
          </fieldset>
          <fieldset class="panel stack" disabled={busy}>
            <legend class="sr-only">Notifications</legend>
            <h3>Notifications</h3>
            <label class="check"><input type="checkbox" bind:checked={prefs.shareDemand} />Share missing demand with administrators</label>
            <p class="small">Administrators can see your needed titles and request status. This does not change profile visibility.</p>
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
                disabled={!data.allowNotificationSilencing}
                bind:checked={prefs.notificationsSilenced}
              />
            </div>
            {#if !data.allowNotificationSilencing}<p class="small">
                Your administrator requires optional notifications to remain visible.
              </p>{/if}
          </fieldset>
          {@render saveControls('Save preferences')}
        </form>
      {:else if data.section === 'playback'}<form
          class="stack form-width"
          onsubmit={(e) => {
            e.preventDefault();
            void saveDraft();
          }}
        >
          <fieldset class="panel stack" disabled={busy}>
            <legend class="sr-only">Subtitles</legend>
            <h3>Subtitles</h3>
            {#if data.experimentalFeatures}<label class="field">Listen threshold (%)<input type="number" min="1" max="100" step="1" bind:value={prefs.listenThreshold} /><small>Count a listen after this percentage is actually played. Captured when playback starts.</small></label>{/if}
            <div class="setting">
              <div>
                <h3>Always enable subtitles</h3>
                <p>
                  Enable your preferred track, or the first available track if no language matches.
                </p>
              </div>
              <input
                type="checkbox"
                aria-label="Always enable subtitles"
                bind:checked={prefs.subtitlesAlways}
              />
            </div>
            <label class="field"
              >Preferred subtitle languages<input
                bind:value={subtitleLanguagesText}
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
              When Always enable is off, the administrator’s default subtitle mode applies.
            </p>
          </fieldset>
          <p class="small">
            Quality and delivery follow the administrator’s server policy. You can choose an
            available edition on a title’s details page.
          </p>
          {@render saveControls('Save playback preferences')}
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
          <div class="panel stack">
            {#if data.hasLocalPassword}<h3>Change password</h3>
              <p class="small">
                Use at least 12 characters. Changing your password signs you out on every device.
              </p>
              <form
                class="stack"
                onsubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  if (busy) return;
                  busy = true;
                  error = '';
                  success = '';
                  try {
                    await change('settings/password', values(form));
                    form.reset();
                    busy = false;
                    await goto('/login?passwordChanged=1', {
                      invalidateAll: true,
                    });
                  } catch (e) {
                    error = message(e);
                  } finally {
                    busy = false;
                  }
                }}
              >
                {#if error && !resetOpen}<p class="notice error" role="alert">
                    {error}
                  </p>{/if}
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
              </form>{:else}<h3>Jellyfin sign-in</h3>
              <p class="small">
                Change your Jellyfin password through your Jellyfin service. An administrator can
                add a separate Coast password if you need local sign-in.
              </p>{/if}
          </div>
          <div class="panel stack">
            <h3>Restore preferences</h3>
            <p class="small">
              Reset appearance, notifications, playback and conflict resolution to the installation
              defaults. Your profile, tracking data and linked accounts stay in place.
            </p>
            <div>
              <Button

                disabled={busy}
                onclick={() => {
                  error = '';
                  resetOpen = true;
                }}>Restore defaults…</Button
              >
            </div>
          </div>
          <div class="panel stack">
            <h3>About Coast</h3>
            <p class="small">
              Coast 0.1.0 · AGPL-3.0-only<br />Your installation owns your tracking data. No
              telemetry is sent to Coast developers.
            </p>
            <p class="small">
              Metadata supplied by TMDB when configured. This product is not endorsed or certified
              by TMDB.
            </p>
          </div>
        </div>
      {:else if data.section === 'connections'}<div class="stack form-width">
          <p class="small">
            Your tracking stays in Coast when you disconnect. <a
              class="text-accent"
              href="/settings/pending">Review sync conflicts</a
            >
          </p>
          <form
            class="panel stack"
            onsubmit={(event) => {
              event.preventDefault();
              void saveDraft();
            }}
          >
            <h3>Conflict resolution</h3>
            <label class="field"
              >Preferred winner
              <select bind:value={prefs.syncConflictWinner} disabled={busy}>
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
            {@render saveControls('Save conflict preference')}
          </form>
          {#each data.providers.filter((p) => p.enabled && !['tmdb', 'igdb'].includes(p.provider)) as p (p.id)}<ConnectionCard
              provider={p}
              dynamicCollectionExports={data.providers.filter(source=>source.provider==='trakt'&&source.connection?.status==='connected'&&(source.connection.settings.collectionProjection as {enabled?:boolean;scope?:string;source?:string;availableOnly?:boolean})?.enabled&&(source.connection.settings.collectionProjection as {scope?:string}).scope!=='fixed'&&((source.connection.settings.collectionProjection as {source?:string}).source==='server'||(source.connection.settings.collectionProjection as {availableOnly?:boolean}).availableOnly)).map(source=>source.name)}
              sources={data.providers.filter(source=>source.provider==='jellyfin'&&source.connection?.status==='connected').map(source=>({id:source.connection!.id,name:source.name}))}
            />{/each}{#if !data.providers.some((p) => p.enabled && !['tmdb', 'igdb'].includes(p.provider))}<EmptyState
              title="Connect your world."
              description="An administrator can add Jellyfin, Trakt, and Seerr integrations. Then you can link your own accounts here."
              icon="server"
              >{#if page.data.user?.role === 'admin'}<Button href="/settings/integrations"
                  >Add an integration</Button
                >{/if}</EmptyState
            >{/if}
        </div>
      {:else if data.section === 'jobs'}<JobsSettings
          timing={data.jobTiming}
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
          <Heading title="Integration health"
            >{#snippet actions()}<a class="small text-accent" href="/settings/integrations"
                >Manage integrations</a
              >{/snippet}</Heading
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
          <Heading title="Missing demand" />
          <p class="small">Released next-needed items and saved titles that are missing or uncertain for each account. Users who opt out are excluded.</p>
          {#await data.demand}<p class="small" role="status">Checking personal demand…</p>{:then demand}
            {#if demand?.users.length}<div class="overflow"><table class="table"><thead><tr><th>User</th><th>Needed title</th><th>Reason</th><th>Availability</th><th>Source coverage</th><th>Request</th></tr></thead><tbody>
              {#each demand.users as person}{#each person.items as item}<tr><td><a href={`/library?collection=true&username=${encodeURIComponent(person.username)}`}>{person.username}</a></td><td><a href={item.href}>{item.neededTitle}</a>{#if item.dateUnknown}<small> · Release date unknown</small>{/if}</td><td>{item.reason}</td><td>{item.availability==='unknown'?'Uncertain':'Missing for this user'}</td><td>{item.sources.map((source:{name:string;fresh:boolean})=>`${source.name}: ${source.fresh?'current':'not current'}`).join(', ')||'No applicable sources'}</td><td>{item.requests.map((request:{state:string})=>request.state).join(', ')||'No request'}</td></tr>{/each}{#if person.pages>1}<tr><td colspan="6"><Pagination page={person.page} pages={person.pages} pageUrl={number=>`/settings/admin?userId=${person.userId}&itemsPage=${number}`} label={`${person.username} demand pages`} /></td></tr>{/if}{/each}
            </tbody></table></div>{:else}<p class="small">No missing demand on this page.</p>{/if}
            {#if demand}<Pagination page={demand.page} pages={demand.pages} pageUrl={number=>`/settings/admin?page=${number}`} label="Demand pages" />{/if}
          {:catch}<p class="notice error" role="alert">Demand could not be loaded. Try again.</p>{/await}
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

                            disabled={busy}
                            onclick={() =>
                              save(
                                `requests/${r.request.id}`,
                                { action: 'approve' },
                                'Approval queued.'
                              )}>Approve</Button
                          ><Button
                            emphasis="subtle"
                            disabled={busy}
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
      {:else if data.section === 'integrations'}<IntegrationSettings
          providers={data.providers}
          experimentalFeatures={data.config?.experimentalFeatures ?? false}
        />
      {:else if data.section === 'users'}<div class="stack">
          {#if policy}<form
              class="panel stack form-width"
              onsubmit={(event) => {
                event.preventDefault();
                void saveDraft();
              }}
            >
              <h3>Jellyfin sign-in</h3>
              <p class="small">
                Only enabled Jellyfin services verified by an administrator can be used to sign in.
              </p>
              <label class="check"
                ><input
                  type="checkbox"
                  bind:checked={policy.jellyfinAutoCreateUsers}
                  disabled={busy}
                />Create Coast accounts on first Jellyfin sign-in</label
              >
              <p class="small">
                Creates a separate Coast account and connects it to Jellyfin. Existing linked
                accounts are reused. Jellyfin validates its own passwords; Coast does not store
                them.
              </p>
              <label class="check"
                ><input
                  type="checkbox"
                  bind:checked={policy.jellyfinSyncAdmins}
                  disabled={busy}
                />Sync administrator roles from Jellyfin at sign-in</label
              >
              <p class="small">
                Grants or removes Coast administrator access to match Jellyfin at each Jellyfin
                sign-in. Disabled Coast accounts stay disabled. Keep an active Coast administrator
                before demoting the last one.
              </p>
              {@render saveControls('Save sign-in policies')}
            </form>{/if}
          <div class="overflow">
            <table class="table">
              <thead
                ><tr
                  ><th>Username</th><th>Role</th><th>Status</th><th>Email</th><th
                    >Linked accounts</th
                  ><th></th></tr
                ></thead
              ><tbody
                >{#each data.users as user}<tr
                    ><td>{user.username}</td><td>{user.role}</td><td
                      >{user.disabled ? 'Disabled' : 'Active'}
                      <p class="small">
                        {user.hasLocalPassword ? 'Coast password' : 'Jellyfin sign-in'}
                      </p></td
                    ><td>{user.email ?? '—'}</td><td
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
                      ><Button
                        emphasis="subtle"
                        disabled={busy}
                        onclick={() => {
                          error = '';
                          editing = {
                            id: user.id,
                            username: user.username,
                            email: user.email ?? '',
                            role: user.role,
                            disabled: user.disabled,
                            password: '',
                          };
                        }}>Edit</Button
                      >{#if user.id !== page.data.user?.id}<Button
                          emphasis="subtle"
                          onclick={() => {
                            error = '';
                            deleteId = user.id;
                          }}>Delete</Button
                        >{/if}</td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
          <div class="panel stack form-width">
            <h3>Invite someone</h3><p class="small">Single-use codes let someone register and import their Jellyfin progress before accessing Coast.</p>
            <form class="stack" onsubmit={async(e)=>{e.preventDefault();try{const result=await change<{code:string}>('admin/invites',{days:Number(new FormData(e.currentTarget).get('days'))});inviteCode=result.code;}catch(cause){error=message(cause);}}}>
              <label class="field">Expires after<select name="days"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></label><Button type="submit">Create invite code</Button>
            </form>
            {#if inviteCode}<label class="field">Copy this code — shown once<input readonly value={inviteCode} onclick={(e)=>e.currentTarget.select()} /></label><a href="/register">Registration page</a>{/if}
            {#each data.invites as invite}<div class="spread"><span class="small">{invite.usedAt?`Used by ${invite.username||'deleted account'}`:invite.revokedAt?'Revoked':`Expires ${new Date(invite.expiresAt).toLocaleString()}`}</span>{#if !invite.usedAt&&!invite.revokedAt}<Button emphasis="subtle" onclick={()=>save(`admin/invites/${invite.id}`,{},'Invite revoked.','DELETE')}>Revoke</Button>{/if}</div>{/each}
          </div>
          <div class="panel stack form-width">
            <h3>Create a Coast account</h3>
            <p class="small">
              Users can manage their own tracking and connections. Administrators can also change
              installation policies and manage every account.
            </p>
            <form
              class="stack"
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
              {#if error && !deleteId}<p class="notice error" role="alert">
                  {error}
                </p>{/if}
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
        </div>
      {:else if data.section === 'policies' && policy}<form
          class="stack form-width"
          onsubmit={(e) => {
            e.preventDefault();
            void saveDraft();
          }}
        >
          <nav class="policy-links" aria-label="Policy groups">
            {#each policyGroups as [key, label]}<a class="badge" href="#{key}">{label}</a>{/each}
          </nav>
          <fieldset class="panel stack" id="features" disabled={busy}>
            <legend class="sr-only">Experimental features</legend>
            <h3>Experimental features</h3>
            <label class="field">Website access<select bind:value={policy.siteAccess}><option value="private">Private · sign-in required</option><option value="public-read-only">Public read-only · profiles, Discover and media details</option></select></label>
            <label class="check"
              ><input type="checkbox" bind:checked={policy.experimentalFeatures} />Enable
              experimental music and gaming</label
            >
            <p class="small">
              Enable music browsing and gaming for signed-in users. These features are still in
              development. Turning this off hides their screens and blocks their APIs without
              deleting existing data.
            </p>
          </fieldset>
          <fieldset class="panel stack" id="sessions" disabled={busy}>
            <legend class="sr-only">Sessions</legend>
            <h3>Sessions</h3>
            <label class="field"
              >Session lifetime in days<input
                type="number"
                min="1"
                max="365"
                bind:value={policy.sessionLifetimeDays}
                required
                step="1"
              /><small
                >Activity refreshes an active session using this lifetime. Applies to new sign-ins
                and refreshed sessions.</small
              ></label
            >
          </fieldset>
          <fieldset class="panel stack" id="playback-policy" disabled={busy}>
            <legend class="sr-only">Playback</legend>
            <h3>Playback</h3>
            <label class="field"
              >Delivery policy<select bind:value={policy.playbackDelivery}
                ><option value="direct-and-relay"
                  >Allow direct and relayed/transcoded playback</option
                ><option value="relay-only">Relay/transcode only</option></select
              ></label
            ><label class="field"
              >Maximum bitrate (Mbps)<input
                type="number"
                min="1"
                max="1000"
                bind:value={policy.maxBitrateMbps}
                required
              /><small>Upper limit used when planning new playback sessions.</small></label
            ><label class="check"
              ><input type="checkbox" bind:checked={policy.allowTranscoding} />Allow Jellyfin
              transcoding</label
            ><label class="field"
              >Default subtitle mode<select bind:value={policy.subtitleDefault}
                ><option value="off">Off</option><option value="preferred"
                  >Preferred languages</option
                ><option value="always">Always enable</option></select
              ></label
            ><label class="field"
              >Default subtitle languages<input
                bind:value={policyLanguagesText}
                placeholder="en, fr"
              /></label
            >
          </fieldset>
          <fieldset class="panel stack" id="metadata" disabled={busy}>
            <legend class="sr-only">Metadata</legend>
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
          </fieldset>
          <fieldset class="panel stack" id="network" disabled={busy}>
            <legend class="sr-only">Integrations & network</legend>
            <h3>Integrations & network</h3>
            <label class="check"
              ><input type="checkbox" bind:checked={policy.enableTrakt} />Allow Trakt
              synchronisation</label
            ><label class="check"
              ><input type="checkbox" bind:checked={policy.enableRequests} />Allow media requests</label
            ><label class="field"
              >Allowed provider ports<input bind:value={portsText} /><small
                >Comma-separated ports (1–65535). Checked when connecting to services; changing this
                does not stop active playback.</small
              ></label
            ><label class="field"
              >Server allowlist<textarea rows="3" bind:value={allowlistText}></textarea><small
                >One hostname per line. Leave empty to use approved instances.</small
              ></label
            >
          </fieldset>
          <fieldset class="panel stack" id="notifications" disabled={busy}>
            <legend class="sr-only">Notifications</legend>
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
            >
          </fieldset>
          {@render saveControls('Save system policies')}
        </form>
      {:else if data.section === 'activity'}
        {#if policy}<form
            class="panel stack form-width"
            style="margin-bottom:24px"
            onsubmit={(e) => {
              e.preventDefault();
              void saveDraft();
            }}
          >
            <label class="field"
              >Diagnostic logging<select disabled={busy} bind:value={policy.diagnosticLevel}>
                <option value="off">Off</option><option value="error">Error</option><option
                  value="warn">Warn</option
                ><option value="info">Info</option><option value="debug">Debug</option><option
                  value="trace">Trace</option
                >
              </select></label
            >
            <p class="small">
              Info is the default. Debug and Trace enable verbose lifecycle and playback timing
              events. Changes apply while Coast is running. Local diagnostics rotate at 1 MiB, keep
              up to four files, and expire after seven days. Security and audit records remain
              independent.
            </p>
            {@render saveControls('Save diagnostic logging')}
            <a href="/api/v1/diagnostics?download">Download recent diagnostics</a>
          </form>{/if}
        <p class="small" style="margin-bottom:24px">
          Administrator diagnostics include application and playback failures. Sensitive credentials
          and personal data are excluded.
        </p>
        {#if data.loggingAudit.length || data.metadataAudit.length}<details
            class="panel"
            style="margin-bottom:24px"
          >
            <summary>Audit activity</summary>
            <div class="stack">
              {#each data.loggingAudit as event}<p>
                  Diagnostic logging changed from {event.previous} to {event.next}
                  · {new Date(event.createdAt).toLocaleString()}
                </p>{/each}{#each data.metadataAudit as event}<p>
                  {event.message} · {new Date(event.createdAt).toLocaleString()}
                </p>{/each}
            </div>
          </details>{/if}
        {#if data.diagnostics.length}<div class="stack">
            {#each data.diagnostics as event}<details class="panel">
                <summary
                  ><strong>{event.kind}</strong> · {event.message}<small
                    style="display:block;margin-top:6px"
                    >{new Date(event.createdAt).toLocaleString()}</small
                  ></summary
                >
                <pre>{JSON.stringify(
                    {
                      level: event.level,
                      correlationId: event.correlationId,
                      ...event.detail,
                    },
                    null,
                    2
                  )}</pre>
              </details>{/each}
          </div>{:else}<EmptyState
            title="No diagnostics to review."
            description="Application and playback errors will appear here when they need your attention."
            icon="shield"
          />{/if}{/if}
    </section>
  </div>
</div>
<Dialog bind:open={resetOpen} title="Restore all personal preferences?">
  <div class="stack">
    <p>
      This resets appearance, notification, playback and conflict resolution preferences. Subtitle
      defaults follow your administrator’s current policy.
    </p>
    <p class="small">
      Your profile, tracking data, passwords and linked service accounts are preserved.
    </p>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    <div class="row">
      <Button
        disabled={busy}
        onclick={async () => {
          if (
            await save(
              'settings/reset',
              {},
              'Personal preferences restored to installation defaults.'
            )
          ) {
            restoreDraft();
            success = 'Personal preferences restored to installation defaults.';
            resetOpen = false;
          }
        }}>{busy ? 'Restoring…' : 'Restore all preferences'}</Button
      ><Button  disabled={busy} onclick={() => (resetOpen = false)}
        >Keep preferences</Button
      >
    </div>
  </div>
</Dialog>
<Dialog onclose={() => (deleteId = '')} open={!!deleteId} title="Delete this Coast account?"
  ><div class="stack">
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    <p>
      This removes the Coast account and its local tracking data. Linked service accounts will
      remain intact.
    </p>
    <p class="small">External account deletion is not supported by the current adapters.</p>
    <div class="row">
      <Button
        danger
        disabled={busy}
        onclick={async () => {
          if (await save(`admin/users/${deleteId}`, {}, 'Account deleted.', 'DELETE'))
            deleteId = '';
        }}>Delete Coast account</Button
      ><Button  disabled={busy} onclick={() => (deleteId = '')}>Cancel</Button>
    </div>
  </div></Dialog
>

<Dialog
  open={!!editing}
  title={editing ? `Edit ${editing.username}` : 'Edit account'}
  onclose={() => {
    if (!busy) editing = null;
  }}
>
  {#if editing}<form
      class="stack"
      onsubmit={async (event) => {
        event.preventDefault();
        if (!editing) return;
        const { email, role, disabled, password, id } = editing;
        if (
          await save(
            `admin/users/${id}`,
            { email, role, disabled, ...(password ? { password } : {}) },
            'Account updated.',
            'PATCH'
          )
        )
          editing = null;
      }}
    >
      {#if error}<p class="notice error" role="alert">{error}</p>{/if}
      <label class="field"
        >Email <small>Optional</small><input
          type="email"
          bind:value={editing.email}
          maxlength="254"
          disabled={busy}
        /></label
      >
      <label class="field"
        >Role<select bind:value={editing.role} disabled={busy || editing.id === page.data.user?.id}
          ><option value="user">User</option><option value="admin">Administrator</option></select
        ></label
      >
      <label class="check"
        ><input
          type="checkbox"
          bind:checked={editing.disabled}
          disabled={busy || editing.id === page.data.user?.id}
        />Disable Coast account</label
      >
      <p class="small">
        Role, access and password changes sign this account out on every device. Jellyfin role sync
        applies again at its next Jellyfin sign-in.
      </p>
      {#if editing.id !== page.data.user?.id}<label class="field"
          >New Coast password <small>Optional · at least 12 characters</small><input
            type="password"
            autocomplete="new-password"
            bind:value={editing.password}
            minlength="12"
            maxlength="128"
            disabled={busy}
          /><small
            >Leave blank to keep the current sign-in method. This does not change the Jellyfin
            password.</small
          ></label
        >{/if}
      <div class="row">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</Button><Button

          disabled={busy}
          onclick={() => (editing = null)}>Cancel</Button
        >
      </div>
    </form>{/if}
</Dialog>

<style>
  .section-description {
    margin: -8px 0 24px;
  }
  fieldset {
    min-width: 0;
    border: 1px solid var(--line);
  }
  fieldset:disabled {
    opacity: 0.75;
  }
  .save-controls {
    display: grid;
    gap: 12px;
  }
  .policy-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .policy-links a:hover {
    color: var(--ink);
  }
  fieldset[id] {
    scroll-margin-top: 100px;
  }
  .settings-main {
    min-width: 0;
    max-width: 1100px;
  }
  .setting {
    display: flex;
    align-items: center;
    gap: 28px;
    padding: 0 0 16px;
    border-bottom: 1px solid var(--line);
  }
  .setting:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }
  .setting > div {
    flex: 1;
  }
  .setting h3 {
    font-size: var(--text-sm);
  }
  .setting p {
    font-size: var(--text-sm);
    margin-top: 6px;
    line-height: var(--leading-relaxed);
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
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    text-transform: capitalize;
  }
  .health-grid h3 {
    font-size: var(--text-sm);
    color: var(--muted);
  }
  .integration-row + .integration-row {
    margin-top: 20px;
  }
  .integration-row span:first-child {
    font-size: var(--text-sm);
  }
  pre {
    font-size: var(--text-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: color-mix(in srgb, var(--canvas) calc(68 / 255 * 100%), transparent);
    padding: 16px;
    border-radius: 8px;
    margin-top: 20px;
  }
  summary {
    font-size: var(--text-sm);
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
