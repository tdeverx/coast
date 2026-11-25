<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import AdminInviteSettings from '#lib/auth/ui/AdminInviteSettings.svelte';
  import AccountAccessControls from '#lib/auth/ui/AccountAccessControls.svelte';
  import { metadataFamilies, metadataProviders, sourcePreference, type MetadataFamily, type MetadataProviderName } from '#lib/catalogue/metadata/resolve.js';
  import type { Snippet } from 'svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import GlassSeparator from '#lib/auth/ui/GlassSeparator.svelte';
  import AccountIdentity from '#lib/auth/ui/AccountIdentity.svelte';
  import Field from '#lib/ui/components/Field.svelte';
  import { profilePath } from '#lib/profile/url.js';
  import { diagnosticLevels } from '#lib/diagnostics.js';
  import PreviewSelect from '#lib/ui/cards/editor/PreviewSelect.svelte';
  import SettingsChoice from '#lib/settings/SettingsChoice.svelte';
  import SettingsSwitch from '#lib/settings/SettingsSwitch.svelte';
  import SettingsOverview from '#lib/settings/SettingsOverview.svelte';
  import MemberFeaturePermissions from '#lib/settings/MemberFeaturePermissions.svelte';
  import SettingsSidebar from '#lib/settings/SettingsSidebar.svelte';
  import { detailPanelHref } from '#lib/media/detail-target.js';
  import type { PageData } from './$types';
  import Toggle from '#lib/ui/components/Toggle.svelte';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
  import SettingsRow from '#lib/ui/components/SettingsRow.svelte';
  import { featureDefinitions, type Feature, type FeatureChoices } from '#lib/features.js';
  import {apiScopes,apiScopeLabels,type ApiScope} from '#lib/public-api.js';
  import { collectionCategories, collectionRules } from '#lib/collection/preferences.js';
  import { categoryEnabled } from '#lib/experimental.js';
  import { traktPreferences } from '#lib/providers/trakt/access.js';
  import {audiences,socialSections,socialCategories} from '#lib/social/model.js';
  import {
    settingsTitles as titles,
    settingsDescriptions as descriptions,
    preferenceFields,
    policyFields,
    policySegments,
    policySegmentForGroup,
    personalSettings, administratorSettings,
    selectSettings,
  } from '#lib/settings/sections.js';
  import Heading from '#lib/ui/components/Heading.svelte';
  import JobsSettings from '#lib/ui/components/JobsSettings.svelte';
  import BackupSettings from '#lib/backups/BackupSettings.svelte';
  import BenchmarkSettings from '#lib/benchmarks/BenchmarkSettings.svelte';
  import Pagination from '#lib/ui/components/Pagination.svelte';
  import IntegrationSettings from '#lib/ui/components/IntegrationSettings.svelte';
  import ConflictList from '#lib/ui/components/ConflictList.svelte';
  import { page } from '$app/state';
  import { tick, untrack } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { navigateMedia } from '#lib/ui/media-navigation.js';

  import { notifyAction } from '#lib/ui/action-feedback.svelte.js';
  import { change, message, refreshRouteDependencies } from '#lib/ui/client.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Icon, { type IconName } from '#lib/ui/components/Icon.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import ConnectionCard from '#lib/ui/components/ConnectionCard.svelte';
  import QueueList from '#lib/ui/components/QueueList.svelte';
  import EmptyState from '#lib/ui/components/EmptyState.svelte';
  let { data, target, open = true, onclose, onclosed }: {
    data: PageData; target?: string; open?: boolean; onclose?: () => void; onclosed?: () => void;
  } = $props();
  const settingsUrl = $derived(target ? new URL(target, page.url.href) : page.url);
  const redesigned = $derived(target ? data.capabilities?.settingsSidebar === true : page.data.capabilities?.settingsSidebar === true);
  const activeSection = $derived(redesigned && settingsUrl.pathname === '/settings' ? undefined : data.section);
  const viewer = $derived(target ? data.user : page.data.user);
  const identity = $derived({
    name: viewer?.settings.profile?.displayName || viewer?.username || 'Account',
    avatar: viewer?.settings.profile?.avatar,
  });
  let undoReset = $state<Record<string, unknown>>();
  const draftForm = 'coast-settings-draft';
  const accountSegments = [
    { id: 'users', label: 'Members', icon: 'friends', href: '/settings/users' },
    { id: 'invites', label: 'Invitations', icon: 'ticket', href: '/settings/users?view=invites' },
    { id: 'defaults', label: 'Invitation defaults', icon: 'sliders', href: '/settings/users?view=defaults' },
  ] as const;
  const policyOptions = policySegments.map(({ value: id, label }) => ({ id, label }));
  const privacyOptions = [{ id: 'audience', label: 'Audience' }, { id: 'notifications', label: 'Notifications' }];
  const diagnosticOptions = [{ id: 'logging', label: 'Logging' }, { id: 'events', label: 'Events' }];
  let policyPanel = $state<ReturnType<typeof policySegmentForGroup>>('access');
  let privacyPanel = $state('audience');
  let diagnosticPanel = $state('logging');
  const panelKey = $derived(activeSection === 'policies' ? policyPanel : activeSection === 'privacy' ? privacyPanel
    : activeSection === 'activity' ? diagnosticPanel : activeSection === 'users' ? data.usersTab : undefined);

  $effect(() => {
    if (activeSection === 'policies') {
      const group = settingsUrl.hash.slice(1);
      policyPanel = policySegmentForGroup(group);
      if (group && policySegments.some(segment => (segment.groups as readonly string[]).includes(group))) {
        void tick().then(() => document.getElementById(group)?.scrollIntoView({ block: 'start' }));
      }
    }
  });

  let revealingInvalid = false;
  function revealInvalid(event: Event) {
    if (revealingInvalid) { event.preventDefault(); return; }
    const field = event.target;
    if (!(field instanceof HTMLInputElement)) return;
    if (activeSection === 'activity' && diagnosticPanel === 'events') {
      diagnosticPanel = 'logging';
    } else if (activeSection === 'policies') {
      const segment = policySegmentForGroup(field.closest('fieldset[id]')?.id ?? '');
      if (segment === policyPanel) return;
      policyPanel = segment;
    } else return;
    event.preventDefault();
    revealingInvalid = true;
    void tick().then(() => {
      revealingInvalid = false;
      field.reportValidity();
    });
  }
  const canEditName = $derived(activeSection === 'account' && !!viewer && !viewer.access?.libraryOnly);
  let displayName = $state(untrack(() => viewer?.settings.profile?.displayName ?? ''));
  const choices = <const Value extends string>(pairs: readonly (readonly [Value, string])[], icon?: IconName) =>
    pairs.map(([id, label]) => ({ id, label, icon }));
  const regions = choices([
    ['GB', 'United Kingdom'], ['US', 'United States'], ['CA', 'Canada'], ['AU', 'Australia'],
    ['DE', 'Germany'], ['FR', 'France'], ['JP', 'Japan'], ['IN', 'India'],
  ], 'discover');
  const audiencesOptions = audiences.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1), icon: 'shield' as const }));
  const profileAudiences = [{ id: 'default', label: 'Use profile audience', icon: 'user' }, ...audiencesOptions] as const;
  const categoryAudiences = audiencesOptions.map(option => option.id === 'public' ? { ...option, label: 'Use section audience' } : option);
  const socialNotificationOptions = [
    ['friend-accepted', 'Friend requests accepted'],
    ['recommendation', 'Recommendations'],
    ['reaction', 'Reactions'],
    ['synced-invite', 'Synced session invitations'],
  ] as const;
  const notificationOptions = choices([
    ['normal', 'Dismiss automatically'], ['persistent', 'Keep until dismissed'],
  ], 'bell');
  const personalNotifications = [{ id: 'default', label: 'Use installation default', icon: 'bell' }, ...notificationOptions] as const;
  const roles = choices([['user', 'User'], ['admin', 'Administrator']], 'user');
  let newAccountRole = $state<'user' | 'admin'>('user');
  let noticePresentation = $state<'normal' | 'persistent'>('normal');
  const diagnosticsOptions = diagnosticLevels.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1), icon: 'list' as const }));
  const siteAccessOptions = choices([
    ['private', 'Private · sign-in required'], ['public-profiles', 'Private site · public profiles only'],
    ['public-read-only', 'Public read-only · profiles, Discover and media details'],
  ], 'shield');
  const registrationOptions = choices([['invite', 'Invite code required'], ['open', 'Open sign-ups']], 'ticket');
  const providerOptions = [
    { id: 'jellyfin', label: 'Jellyfin', icon: 'jellyfin' },
    { id: 'trakt', label: 'Trakt', icon: 'trakt' },
    { id: 'either', label: 'Jellyfin or Trakt', icon: 'link' },
    { id: 'none', label: 'None', icon: 'link' },
  ] as const;
  const deliveryOptions = choices([
    ['direct-and-relay', 'Direct and relayed/transcoded playback'], ['relay-only', 'Relay/transcode only'],
  ], 'play');
  const subtitleOptions = choices([['off', 'Off'], ['preferred', 'Preferred languages'], ['always', 'Always enable']], 'subtitles');


  let accountDetail=$state(''),bulkAccess=$state(false),selectingAccounts=$state(false),selectedAccounts=$state<string[]>([]);
  const membersPage = $derived(settingsUrl.searchParams.get('before'));
  $effect(() => {
    // Route changes drop the previous list's selection, while a data refresh preserves it.
    data.usersTab;
    membersPage;
    selectedAccounts = [];
    bulkAccess = false;
    accountDetail = '';
    editing = null;
  });

  let apiToken = $state(''),
    apiName = $state(''),
    apiDays = $state(90),
    apiGrants = $state<ApiScope[]>(['catalogue:read']);

  let error = $state(''),
    busy = $state(false),
    prefs = $state(untrack(() => readPreferences())),
    policy = $state(untrack(() => readPolicy())),
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
    personalBitrateMbps: number;
    sharedBitrateMbps: number;
  } | null>(null);
  let initializedSection = untrack(() => activeSection);
  const fields = $derived(
    data.section === 'policies'
      ? policyFields
      : data.section === 'activity'
        ? ['diagnosticLevel', 'diagnosticMaxSizeMiB', 'diagnosticMaxAgeDays']
        : preferenceFields[data.section as keyof typeof preferenceFields] ?? []);

  let saved = $state(untrack(() => JSON.stringify(selectSettings(['policies', 'activity', 'users'].includes(data.section) ? policy ?? {} : prefs, fields))));

  const draft = $derived({
    ...selectSettings(['policies', 'activity', 'users'].includes(data.section) ? policy ?? {} : prefs, fields),
    ...data.section === 'playback'
      ? { subtitleLanguages: splitValues(subtitleLanguagesText, ',') }
      : {},
    ...data.section === 'policies'
      ? {
        subtitleLanguages: splitValues(policyLanguagesText, ','),
        allowedProviderPorts: splitValues(portsText, ',').map(Number),
          serverAllowlist: splitValues(allowlistText, '\n'),
      }
      : {}
  });
  const dirty = $derived(canEditName ? displayName.trim() !== (viewer?.settings.profile?.displayName ?? '')
    : fields.length > 0 && JSON.stringify(draft) !== saved);
  function readPreferences() {
    const defaults = data.defaults;
    const settings = viewer?.settings;
    const preferences = structuredClone({
      ...defaults, ...settings,
      subtitleLanguages: settings?.subtitleLanguages ?? defaults.subtitleLanguages,
    });
    if (preferences.notificationLevel === 'silent') preferences.notificationLevel = null;
    if (data.section === 'privacy') {
      const notifications = { ...preferences.social.notifications };
      for (const [kind] of socialNotificationOptions) notifications[kind] ??= true;
      preferences.social.notifications = notifications;
    }
    return preferences;
  }
  function readPolicy() {
    const config = data.config ? structuredClone(data.config) : null;
    if (config?.notificationLevel === 'silent') config.notificationLevel = 'normal';
    return config;
  }
  const sourceLabels = { jellyfin: 'Jellyfin', tmdb: 'TMDB', trakt: 'Trakt' };
  const sourceOrders = metadataProviders.flatMap(first =>
    metadataProviders.filter(second => second !== first).map(second => [first, second,
      metadataProviders.find(third => third !== first && third !== second)!] satisfies [MetadataProviderName, MetadataProviderName, MetadataProviderName]));
  const metadataOptions = choices<string>([
    ['local-preferred', 'Coast default'], ['tmdb-only', 'TMDB snapshots only'],
    ...sourceOrders.map(order => [order.join(','), order.map(source => sourceLabels[source]).join(' → ')] as const),
  ], 'layers');
  const familyLabels = { details: 'Details and genres', artwork: 'Artwork', release: 'Release dates and airtimes' };
  function chooseSourceOrder(family: MetadataFamily, value: string) {
    if (!policy) return;
    const order = value === 'local-preferred' || value === 'tmdb-only' ? value
      : sourceOrders.find(sources => sources.join(',') === value);
    if (!order) return;
    const current = policy.metadataSource;
    const settings = typeof current === 'object' ? current : {details:current,artwork:current,release:current};
    policy.metadataSource = {...settings,[family]:order};
  }
  function restoreDraft() {
    displayName = viewer?.settings.profile?.displayName ?? '';
    prefs = readPreferences();
    policy = readPolicy();
    subtitleLanguagesText = prefs.subtitleLanguages.join(', ');
    policyLanguagesText = policy?.subtitleLanguages.join(', ') ?? '';
    portsText = policy?.allowedProviderPorts.join(', ') ?? '';
    allowlistText = policy?.serverAllowlist.join('\n') ?? '';
    saved = JSON.stringify(selectSettings(['policies', 'activity', 'users'].includes(data.section) ? policy ?? {} : prefs, fields));
    error = '';
    apiToken = '';
  }

  function canLeave() {
    return !busy && (!dirty || window.confirm('Discard unsaved settings?'));
  }

  function closeSettings() {
    if (onclose) {
      if (canLeave()) onclose();
    } else {
      void goto('/library');
    }
  }

  beforeNavigate(({ cancel, to, shallow, willUnload }) => {
    if (!open || !busy && !dirty) return;
    if (willUnload) { cancel(); return; }
    if (target && shallow) {
      const next = to && detailPanelHref(to.url, {});
      if (!next || new URL(next, page.url.href).pathname === settingsUrl.pathname) return;
    } else if (to?.url.pathname === settingsUrl.pathname) return;
    if (!canLeave()) cancel();
  });
  const conflictOptions = $derived.by(() => {
    const options = choices<string>([['manual', 'Manual · review every conflict'], ['coast', 'Coast wins automatically']], 'refresh');
    for (const provider of data.providers) {
      if (!provider.enabled || ['tmdb', 'igdb'].includes(provider.provider) || provider.connection?.status !== 'connected') continue;
      const account = provider.connection.username ? ` · ${provider.connection.username}` : '';
      options.push({ id: provider.connection.id, label: `${provider.name}${account} wins automatically`, icon: 'link' });
    }
    if (!options.some(option => option.id === prefs.syncConflictWinner)) {
      options.push({ id: prefs.syncConflictWinner, label: 'Preferred account unavailable · manual review', icon: 'info' });
    }
    return options;
  });
  $effect(() => {
    // Background refreshes must not erase unsaved edits on the current page.
    if (activeSection === initializedSection) return;
    initializedSection = activeSection;
    resetOpen = false;
    untrack(restoreDraft);
  });
  async function saveDraft() {
    const submitted: Record<string, unknown> = $state.snapshot(draft);
    if (data.section === 'features') {
      const previous = JSON.parse(saved).features as FeatureChoices | undefined;
      submitted.features = Object.fromEntries(Object.entries(prefs.features ?? {}).filter(([key, value]) =>
        data.featurePermissions[key] && value !== previous?.[key as Feature]));
    }
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
    ) restoreDraft();
  }
  async function save(path: string, body: unknown, label = 'Saved.', method = 'POST') {
    if (busy) return false;
    busy = true;
    error = '';
    apiToken = '';
    try {
      await change(path, body, method);
      notifyAction(label);
      return true;
    } catch (e) {
      error = message(e);
      return false;
    } finally {
      busy = false;
    }
  }
  async function resetPreferences() {
    if (busy) return;
    busy = true;
    try {
      const result = await change<{preferences: Record<string, unknown>}>('settings/reset', {});
      undoReset = Object.keys(result.preferences).length ? result.preferences : undefined;
      restoreDraft();
      resetOpen = false;
      notifyAction('Personal preferences restored to installation defaults.');
    } catch (cause) { error = message(cause); }
    finally { busy = false; }
  }

  const values = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));
  reportFailure(()=>error);
  let demandError=$state('');
  $effect(()=>{const pending=data.demand;demandError='';let current=true;void pending?.catch(()=>{if(current)demandError='Demand could not be loaded. Try again.';});return()=>{current=false;};});
  reportFailure(()=>data.section==='admin' ? demandError : '');
</script>

{#snippet settingsGroup(rows: Snippet)}
  <AuthSurface>{@render rows()}</AuthSurface>
{/snippet}

{#snippet saveControls()}
  {#if dirty}
    <div class="save-controls">
      <div class="row">
        <Button size="segment" emphasis="subtle" disabled={busy} onclick={restoreDraft}>Discard changes</Button>
      </div>
      {#if !busy}<p class="small" role="status">Unsaved changes</p>{/if}
    </div>
  {/if}
{/snippet}

{#snippet editMember(showTitle = true)}
  {#if editing}
    <form class="stack" aria-label={`Edit ${editing.username}`} onsubmit={async (event) => {
      event.preventDefault();
      if (!editing) return;
      const { email, role, disabled, password, id, personalBitrateMbps, sharedBitrateMbps } = editing;
      const patch = { email, role, disabled, personalBitrateMbps, sharedBitrateMbps,
        ...(password ? { password } : {}) };
      if (await save(`admin/users/${id}`, patch, 'Account updated.', 'PATCH')) editing = null;
    }}>
      {#if showTitle}<h3>Edit {editing.username}</h3>{/if}
      <label class="field">
        Email <small>Optional</small>
        <input type="email" bind:value={editing.email} maxlength="254" disabled={busy} />
      </label>
      <SettingsChoice label="Role" options={roles} bind:value={editing.role} disabled={busy || editing.id === viewer?.id} />
      <SettingsSwitch label="Disable Coast account" bind:checked={editing.disabled} disabled={busy || editing.id === viewer?.id} />
      <label class="field">
        Personal stream limit (Mbps)
        <input type="number" min="1" max="1000" bind:value={editing.personalBitrateMbps} disabled={busy} />
      </label>
      <label class="field">
        Shared links budget (Mbps)
        <input type="number" min="1" max="1000" bind:value={editing.sharedBitrateMbps} disabled={busy} />
        <small>Shared across this account’s active link viewers. Each targets the personal stream limit; headroom is reserved for transport and bitrate bursts.</small>
      </label>
      <p class="small">
        Role, access and password changes sign this account out on every device. Jellyfin role sync
        applies again at its next Jellyfin sign-in.
      </p>
      {#if editing.id !== viewer?.id}
        <label class="field">
          New Coast password <small>Optional · 8+ characters, uppercase, lowercase and special character</small>
          <input type="password" autocomplete="new-password" bind:value={editing.password}
            minlength="8" maxlength="128" disabled={busy} />
          <small>Leave blank to keep the current sign-in method. This does not change the Jellyfin password.</small>
        </label>
      {/if}
      <div class="row">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</Button>
        <Button disabled={busy} onclick={() => editing = null}>Cancel</Button>
      </div>
    </form>
  {/if}
{/snippet}

<svelte:head>{#if !target}<title>{activeSection ? titles[activeSection] : 'Settings'} · Coast</title>{/if}</svelte:head>
{#if redesigned}
  <SettingsSidebar {open} onclose={closeSettings} {onclosed}>
    <SettingsOverview section={activeSection} requestedArea={settingsUrl.searchParams.get('area')} requestedGroup={settingsUrl.searchParams.get('group')} {panelKey} onclose={closeSettings}
      appearanceNote={viewer?.settings.liquidGlass === false ? 'Standard' : 'Liquid glass'}
      privacyNote={audiencesOptions.find(option => option.id === (viewer?.settings.social?.audience ?? 'friends'))?.label ?? 'Friends'}
      {identity} admin={viewer?.role === 'admin'} libraryOnly={viewer?.access?.libraryOnly === true}
      saveForm={activeSection && (fields.length || canEditName) ? draftForm : undefined} {busy} {dirty}
      {subnavigation} {dialogs}>
      {@render settingsContent()}
    </SettingsOverview>
  </SettingsSidebar>
{:else if !target}
  <div class="content page legacy-settings">
    <Heading variant="page" title="Settings" description="Manage your preferences, connections and account." />
    <div class="settings-grid">
      <nav class="settings-nav" aria-label="Settings">
        <span class="group">You</span>
        {#each personalSettings.filter(([key]) => !viewer?.access?.libraryOnly || ['account','appearance','features'].includes(key)) as [key, label]}
          <a class:active={data.section === key} aria-current={data.section === key ? 'page' : undefined}
            href={key === 'appearance' ? '/settings' : `/settings/${key}`}>{label}</a>
        {/each}
        {#if viewer?.role === 'admin'}
          <span class="group">Administration</span>
          {#each administratorSettings as [key, label]}
            <a class:active={data.section === key} aria-current={data.section === key ? 'page' : undefined}
              href={`/settings/${key}`}>{label}</a>
          {/each}
          <a href="/ui-preview">UI reference</a>
        {/if}
      </nav>
      <div class="legacy-settings-content">
        <Heading title={titles[data.section]} />
        {@render subnavigation()}
        {@render settingsContent()}
        {#if fields.length || canEditName}
          <Button type="submit" form={draftForm} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</Button>
        {/if}
      </div>
    </div>
    {@render dialogs()}
  </div>
{/if}

  {#snippet subnavigation()}
    {#if activeSection === 'users'}
      <SettingsChoice label="Accounts" options={accountSegments} value={data.usersTab}
        onchange={value => { const destination = accountSegments.find(option => option.id === value); if (destination) void navigateMedia(destination.href); }} />
    {:else if activeSection === 'policies'}
      <SettingsChoice label="Policy group" options={policyOptions} bind:value={policyPanel} />
    {:else if activeSection === 'privacy'}
      <SettingsChoice label="Privacy settings" options={privacyOptions} bind:value={privacyPanel} />
    {:else if activeSection === 'activity'}
      <SettingsChoice label="Diagnostic settings" options={diagnosticOptions} bind:value={diagnosticPanel} />
    {/if}
  {/snippet}
{#snippet settingsContent()}
  <section class="settings-main" aria-label={titles[data.section]}>
    <p class="section-description small">{descriptions[data.section]}</p>

      {#if data.section === 'features'}
        <form id={draftForm} class="stack form-width" onsubmit={event => { event.preventDefault(); void saveDraft(); }}>
          {#if featureDefinitions.some(([key]) => data.featurePermissions[key])}
            <AuthSurface>
              {#each featureDefinitions.filter(([key]) => data.featurePermissions[key]) as [key, title, description] (key)}
                <SettingsSwitch label={title} {description} checked={prefs.features?.[key] !== false}
                  onchange={checked => { prefs.features = { ...prefs.features, [key]: checked }; }} />
              {/each}
            </AuthSurface>
            {@render saveControls()}
          {:else}
            <p class="small">There are no optional features available for your account.</p>
          {/if}
        </form>
      {:else if data.section === 'features-policy' && data.installationFeatureDefaults}
        <div class="stack">
          {#each data.accounts.items as member (member.id)}
            <MemberFeaturePermissions account={member} config={data.installationFeatureDefaults} />
          {/each}
          {#if data.accounts.next}<Button href={`/settings/features-policy?before=${data.accounts.next}`}>Next page</Button>{/if}
        </div>
      {:else if data.section === 'collection'}
        <form id={draftForm}
          class="stack form-width"
          onsubmit={(event) => {
            event.preventDefault();
            void saveDraft();
          }}
        >
          <p class="small">Explicitly collected items always stay in Collection. These rules only control automatic membership.</p>
          {#each collectionCategories.filter((category) => categoryEnabled({ ...data, features: page.data.capabilities }, category.value)) as category}
            <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} disabled={busy}>
              <legend class="sr-only">{category.label}</legend>
              <h3>{category.label}</h3>

              {#each collectionRules.filter((rule) => !['book', 'comic'].includes(category.value) || rule.value !== 'queue') as rule}
                <SettingsSwitch label={rule.label}
                  bind:checked={prefs.collection[category.value][rule.value]} />
              {/each}
            </fieldset>
          {/each}
          {@render saveControls()}
        </form>
      {:else if data.section === 'privacy'}
        <form id={draftForm}
          class="stack form-width"
          onsubmit={(event) => {
            event.preventDefault();
            void saveDraft();
          }}
        >
          <fieldset data-settings-panel hidden={privacyPanel !== 'audience'} class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} disabled={busy}>
            <legend class="sr-only">Audience</legend>

            <PreviewSelect topLayer disabled={busy} label="Profile audience" options={audiencesOptions} bind:value={prefs.social.audience} />
            <p class="small">A private profile is hidden from everyone else. Other sections can have their own audience.</p>

            {#each socialSections as section (section)}
              <PreviewSelect topLayer disabled={busy} label={section} options={profileAudiences}
                value={prefs.social.sections?.[section] ?? 'default'}
                onchange={value => {
                  prefs.social = {
                    ...prefs.social,
                    sections: { ...prefs.social.sections, [section]: value === 'default' ? undefined : value },
                  };
                }} />
            {/each}

            {#each socialCategories.filter(category => categoryEnabled({ ...data, features: page.data.capabilities }, category)) as category (category)}
              <PreviewSelect topLayer disabled={busy} label={`${category} sharing`} options={categoryAudiences}
                value={prefs.social.categories?.[category] ?? 'public'}
                onchange={value => {
                  prefs.social = { ...prefs.social, categories: { ...prefs.social.categories, [category]: value } };
                }} />
            {/each}

          </fieldset>
          <fieldset data-settings-panel hidden={privacyPanel !== 'notifications'} class="panel stack glass settings-glass"
            use:liquidGlass={{ variant: 'clear', renderer: 'css' }} disabled={busy}>
            <legend class="sr-only">Notifications</legend>

            {#each socialNotificationOptions as [kind, label]}
              <SettingsSwitch {label}
                checked={prefs.social.notifications?.[kind] !== false}
                onchange={checked => {
                  prefs.social = {
                    ...prefs.social,
                    notifications: { ...prefs.social.notifications, [kind]: checked },
                  };
                }} />
            {/each}

            <p class="small">Incoming friend requests appear in Friends.</p>
          </fieldset>
          {@render saveControls()}
        </form>
      {:else if data.section === 'appearance'}<form id={draftForm}
          class="stack form-width"
          onsubmit={(e) => {
            e.preventDefault();
            void saveDraft();
          }}
        >
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} disabled={busy}>
            <legend class="sr-only">Display</legend>
            <h3>Display</h3>

            <SettingsRow
              title="Liquid glass"
              description="Use glass effects where supported. Turn off to use the blur fallback."
            >
              <Toggle label="Liquid glass"
                bind:checked={prefs.liquidGlass}
              />
            </SettingsRow>

            <SettingsRow
              title="Full-width content"
              description="Let your library make the most of the screen. Heroes always stay edge-to-edge."
            >
              <Toggle label="Full-width content"
                bind:checked={prefs.fullWidth}
              /></SettingsRow>
            <SettingsRow title="Prefer original titles" description="Use a title’s original language where it is available."><Toggle label="Prefer original titles"
                bind:checked={prefs.originalTitles}
              /></SettingsRow>
          <SettingsRow title="Black and white missing artwork" description="Show unavailable media in black and white."><Toggle label="Black and white missing artwork" bind:checked={prefs.monochromeMissing}/></SettingsRow>
          <SettingsRow title="Sanitize odd page counts" description="Remove an unmatched final comic face after splitting spreads. Turn off to keep every face and add unprinted binding pages. Applies the next time you open the reader."><Toggle label="Sanitize odd page counts" bind:checked={prefs.sanitizeOddReadingPages}/></SettingsRow>
          </fieldset>
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} disabled={busy}>
            <legend class="sr-only">Regional metadata</legend>
            <h3>Regional metadata</h3>
            <PreviewSelect topLayer disabled={busy} label="Region" options={regions.some(option => option.id === prefs.region)
              ? regions : [...regions, { id: prefs.region, label: prefs.region, icon: 'discover' }]} bind:value={prefs.region} />
            <p class="small">Used for age certificates and regional metadata.</p>
          </fieldset>
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} disabled={busy}>
            <legend class="sr-only">Notifications</legend>
            <h3>Notifications</h3>
            <SettingsSwitch label="Share missing demand with administrators" bind:checked={prefs.shareDemand} />
            <p class="small">Administrators can see your needed titles and request status. This does not change profile visibility.</p>
            <PreviewSelect topLayer disabled={busy || !data.allowNotificationSilencing} label="Toast duration"
              options={personalNotifications} value={prefs.notificationLevel ?? 'default'}
              onchange={value => prefs.notificationLevel = value === 'default' ? null : value} />
            <p class="small">Important notices stay visible until dismissed.</p>
          </fieldset>
          {@render saveControls()}
        </form>
      {:else if data.section === 'playback'}<form id={draftForm}
          class="stack form-width"
          onsubmit={(e) => {
            e.preventDefault();
            void saveDraft();
          }}
        >
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} disabled={busy}>
            <legend class="sr-only">Subtitles</legend>
            <h3>Subtitles</h3>
            {#if data.experimentalMusic}<label class="field">Listen threshold (%)<input type="number" min="1" max="100" step="1" bind:value={prefs.listenThreshold} /><small>Count a listen after this percentage is actually played. Captured when playback starts.</small></label>{/if}
            <SettingsRow title="Always enable subtitles" description="Enable your preferred track, or the first available track if no language matches."><Toggle label="Always enable subtitles"
                bind:checked={prefs.subtitlesAlways}
              /></SettingsRow>
            <label class="field"
              >Preferred subtitle languages<input
                bind:value={subtitleLanguagesText}
                placeholder="en, fr"
              />

              <small>Language codes in preference order, separated by commas.</small>
            </label>

            <SettingsRow
              title="Ask before playback"
              description="Choose subtitle preferences before starting a title."
            >
              <Toggle label="Ask before playback"
                bind:checked={prefs.subtitlePrompt}
              /></SettingsRow>
            <p class="small">
              When Always enable is off, the administrator’s default subtitle mode applies.
            </p>
          </fieldset>
          <p class="small">
            Quality and delivery follow the administrator’s server policy. You can choose an
            available edition on a title’s details page.
          </p>
          {@render saveControls()}
        </form>

        {#if data.playbackLinks.length}
          <div class="stack form-width">
            <Heading title="Playback invitations" />

            {#each data.playbackLinks as link}
              <div class="panel spread">
                <div>
                  <a href={`/share?id=${link.id}`}>Open invitation</a>

                  <p class="small muted">
                    {link.revokedAt
                      ? 'Revoked'
                      : new Date(link.expiresAt) <= new Date() ? 'Expired' : link.claimedAt ? 'Opened' : 'Available'} · {link.together ? 'Together' : 'Single item'} · {new Date(link.expiresAt).toLocaleString()}
                  </p>
                </div>

                <Button
                  disabled={busy || !!link.revokedAt}
                  onclick={async () => {
                    if (busy) return;

                    busy = true;

                    try {
                      await change(`sharing/${link.id}`, undefined, 'DELETE');
                      await refreshRouteDependencies(['settings']);
                    } catch(cause) {
                      error = message(cause);
                    } finally {
                      busy = false;
                    }
                  }}
                >Revoke</Button>
              </div>
            {/each}
          </div>
        {/if}
      {:else if data.section === 'api'}
        <div class="stack form-width">
          <AuthSurface>
            <div class="menu-row"><Icon name="key" size={16} /><span>Active tokens</span>
              <span class="menu-row-note account-note">{data.apiActivity?.tokens ?? 0}</span></div>
            <div class="menu-row"><Icon name="link" size={16} /><span>Active webhooks</span>
              <span class="menu-row-note account-note">{data.apiActivity?.webhooks ?? 0}</span></div>
          </AuthSurface>
          <form
            class="panel stack"
            onsubmit={async (event) => {
              event.preventDefault();

              if (busy) return;

              busy = true;
              error = '';
              apiToken = '';

              try {
                const result = await change<{ token: string }>('settings/tokens', { name: apiName, scopes: apiGrants, days: apiDays });

                apiToken = result.token;
                apiName = '';
              } catch(cause) {
                error = message(cause);
              } finally {
                busy = false;
              }
            }}
          >
            <label class="field">
              Token name
              <input required maxlength="60" bind:value={apiName} />
            </label>

            <label class="field">
              Expires in days

              <input
                type="number"
                min="1"
                max="365"
                required
                bind:value={apiDays}
              />
            </label>

            <fieldset class="stack">
              <legend>Permissions</legend>

              {#each apiScopes as scope}
                <label class="check">
                  <input
                    type="checkbox"
                    bind:group={apiGrants}
                    value={scope}
                  />

                  {apiScopeLabels[scope]}
                </label>
              {/each}
            </fieldset>

            <Button
              type="submit"
              disabled={busy || !apiGrants.length || page.data.capabilities?.api === false}
            >Create token</Button>
          </form>

          {#if apiToken}
            <div class="panel stack">
              <p role="status">Copy this token now. It will not be shown again.</p>

              <label class="field">
                API token

                <input
                  readonly
                  autocomplete="off"
                  spellcheck={false}
                  value={apiToken}
                  onclick={(event) => event.currentTarget.select()}
                />
              </label>

              <Button emphasis="subtle" onclick={() => apiToken = ''}>Hide</Button>
            </div>
          {/if}

          {#each data.apiTokens as token (token.id)}
            <div class="panel stack">
              <div class="spread">
                <strong>{token.name}</strong>

                <Button
                  emphasis="subtle"
                  danger
                  disabled={busy || !!token.revokedAt}
                  onclick={async () => {
                    if (busy) return;

                    busy = true;
                    error = '';

                    try {
                      await change(`settings/tokens/${token.id}`, undefined, 'DELETE');
                    } catch(cause) {
                      error = message(cause);
                    } finally {
                      busy = false;
                    }
                  }}
                >{token.revokedAt ? 'Revoked' : 'Revoke'}</Button>
              </div>

              <p class="small muted">{token.scopes.join(', ')} · Expires {new Date(token.expiresAt).toLocaleDateString()}</p>
            </div>
          {/each}

          <p class="small muted">
            Use Bearer authentication at /api/public/v1.

            <a
              href="/api/public/v1/openapi.json"
              target="_blank"
              rel="noopener"
            >OpenAPI reference</a>

            covers the endpoints.
          </p>
        </div>
      {:else if data.section === 'account'}
        <div class="stack form-width">
          <AuthSurface>
            <div class="menu-row">
              <AccountIdentity {...identity} detail={viewer?.role === 'admin' ? 'Administrator' : 'Coast account'} />
            </div>
            <div class="menu-row"><Icon name="atSign" size={16} /><span>Username</span>
              <span class="menu-row-note account-note">{viewer?.username}</span></div>
            <div class="menu-row"><Icon name="user" size={16} /><span>Email</span>
              <span class="menu-row-note account-note">{viewer?.email ?? 'No email address'}</span></div>
            {#if viewer && !viewer.access?.libraryOnly}
              <a class="menu-row" href={profilePath(viewer.username)}>
                <Icon name="userCheck" size={16} /><span>Profile</span><span class="menu-chevron"><Icon name="right" size={16} /></span>
              </a>
            {/if}
            {#if data.initialImports}
              <a class="menu-row" href="/onboarding?step=imports">
                <Icon name="history" size={16} /><span>Initial imports</span><span class="menu-chevron"><Icon name="right" size={16} /></span>
              </a>
            {/if}
          </AuthSurface>
          {#if canEditName}
            <form id={draftForm} class="stack" onsubmit={async event=>{
              event.preventDefault();
              if (await save('profile', { action: 'display-name', displayName }, 'Display name saved.')) restoreDraft();
            }}>
              <AuthSurface>
                <Field label="Display name" class="menu-row" hideLabel>
                  <Icon name="user" size={16} />
                  <input aria-label="Display name" bind:value={displayName} placeholder="Display name"
                    maxlength="60" autocomplete="nickname" disabled={busy} />
                </Field>
              </AuthSurface>
              {#if dirty}{@render saveControls()}{/if}
            </form>
          {/if}
          <div class="panel stack">
            {#if data.hasLocalPassword}<h3>Change password</h3>
              <p class="small">
                Use at least 8 characters with uppercase, lowercase and a special character. Changing your password signs you out on every device and revokes your API tokens.
              </p>
              <form
                class="stack"
                onsubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  if (busy) return;
                  busy = true;
                  error = '';
                  try {
                    await change('settings/password', values(form));
                    form.reset();
                    busy = false;
                    await goto('/login?passwordChanged=1', {
                      refreshAll: true,
                    });
                  } catch (e) {
                    error = message(e);
                  } finally {
                    busy = false;
                  }
                }}
              >

                <label class="field">
                  Current password
                  <input
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
                    minlength="8"
                    required
                  /></label
                ><Button type="submit" disabled={busy}>Update password</Button>
              </form>{:else}<h3>Coast password</h3>
              <p class="small">Ask an administrator to set your Coast password before using local sign-in.</p>{/if}
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
              {#if redesigned && undoReset}<Button disabled={busy} onclick={async () => {
                if (await save('settings/undo-reset', undoReset, 'Preference restore undone.')) {
                  undoReset = undefined;
                  restoreDraft();
                }
              }}>Undo restore</Button>{/if}
            </div>
            {#if redesigned && resetOpen}{@render resetConfirmation()}{/if}
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
          <h2 class="section-label">Linked services</h2>
          {#each data.providers.filter((p) => p.enabled && !['tmdb', 'igdb'].includes(p.provider)) as p (p.id)}<ConnectionCard
              provider={p}
              {settingsGroup}
              dynamicCollectionExports={data.providers.filter((source) => source.provider === 'trakt' && source.connection?.status === 'connected' && traktPreferences(source.connection.settings).export.collection && (source.connection.settings.collectionProjection as {
                enabled?: boolean;
                scope?: string;
                source?: string;
                availableOnly?: boolean
               })?.enabled && (source.connection.settings.collectionProjection as { scope?: string }).scope !== 'fixed' && ((source.connection.settings.collectionProjection as { source?: string }).source === 'server' || (source.connection.settings.collectionProjection as { availableOnly?: boolean }).availableOnly)).map((source) => source.name)}
              sources={data.providers.filter((source) => source.provider === 'jellyfin' && source.connection?.status === 'connected').map((source) => ({ id: (source.connection!).id, name: source.name }))}
            />
          {/each}{#if !data.providers.some((p) => p.enabled && !['tmdb', 'igdb'].includes(p.provider))}
            <EmptyState
              title="Connect your world."
              description="An administrator can add Jellyfin, Trakt, and Seerr integrations. Then you can link your own accounts here."
              icon="server"
              >{#if page.data.user?.role === 'admin'}<Button href="/settings/integrations"
                  >Add an integration</Button
                >{/if}</EmptyState
            >{/if}
          <GlassSeparator />
          <AuthSurface>
            <a class="menu-row" href="/settings/pending">
              <Icon name="refresh" size={16} /><span>Sync conflicts</span><span class="menu-chevron"><Icon name="right" size={16} /></span>
            </a>
          </AuthSurface>
          <p class="small">Your tracking stays in Coast when you disconnect.</p>
          <form id={draftForm}
            class="panel stack"
            onsubmit={(event) => {
              event.preventDefault();
              void saveDraft();
            }}
          >
            <h3>Conflict resolution</h3>
            <PreviewSelect topLayer disabled={busy} label="Preferred winner" options={conflictOptions} bind:value={prefs.syncConflictWinner} />
            <p class="small">
              The winner replaces conflicting values in Coast and other enabled sync destinations.
              Your choice applies when syncing; conflicts the preferred account cannot resolve stay
              in Sync conflicts. Sync permissions and enabled categories still apply.
            </p>
            {@render saveControls()}
          </form>
        </div>
      {:else if data.section === 'jobs'}<JobsSettings commands={data.taskCommands}
          tasteJob={data.tasteJob}
          timing={data.jobTiming}
          providers={data.providers}
          actions={data.actions}
        />
      {:else if data.section === 'backups' && data.backups}<BackupSettings initial={data.backups} />
      {:else if data.section === 'benchmarks' && data.benchmarks}<BenchmarkSettings history={data.benchmarks} />
      {:else if data.section === 'pending'}
        <div class="stack">
          <AuthSurface>
            <div class="menu-row"><Icon name="refresh" size={16} /><span>Pending conflicts</span>
              <span class="menu-row-note account-note">{data.conflicts.length}</span></div>
            <a href="/settings/connections" class="menu-row">
              <Icon name="sliders" size={16} /><span>Change preferred winner</span>
              <span class="menu-chevron"><Icon name="right" size={16} /></span>
            </a>
          </AuthSurface>
          <ConflictList conflicts={data.conflicts} />
        </div>
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

          {#await data.demand}
            <p class="small" role="status">Checking personal demand…</p>
          {:then demand}
            {#if demand?.users.length}
              <div class="overflow">
                <table class="table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Needed title</th>
                      <th>Reason</th>
                      <th>Availability</th>
                      <th>Source coverage</th>
                      <th>Request</th>
                    </tr>
                  </thead>

                  <tbody>
                    {#each demand.users as person}
                      {#each person.items as item}
                        <tr>
                          <td>
                            <a
                              href={`/library?collection=true&username=${encodeURIComponent(person.username)}`}
                            >{person.username}</a>
                          </td>

                          <td>
                            <a href={item.href}>{item.neededTitle}</a>

                            {#if item.dateUnknown}
                              <small>· Release date unknown</small>
                            {/if}
                          </td>

                          <td>{item.reason}</td>
                          <td>{item.availability === 'unknown' ? 'Uncertain' : 'Missing for this user'}</td>
                          <td>{item.sources.map((source: { name: string; fresh: boolean }) => `${source.name}: ${source.fresh ? 'current' : 'not current'}`).join(', ') || 'No applicable sources'}</td>
                          <td>{item.requests.map((request: { state: string }) => request.state).join(', ') || 'No request'}</td>
                        </tr>
                      {/each}{#if person.pages > 1}
                        <tr>
                          <td colspan="6">
                            <Pagination
                              page={person.page}
                              pages={person.pages}
                              pageUrl={(number) => `/settings/admin?userId=${person.userId}&itemsPage=${number}`}
                              label={`${person.username} demand pages`}
                            />
                          </td>
                        </tr>
                      {/if}
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <p class="small">No missing demand on this page.</p>
            {/if}

            {#if demand}
              <Pagination
                page={demand.page}
                pages={demand.pages}
                pageUrl={(number) => `/settings/admin?page=${number}`}
                label="Demand pages"
              />
            {/if}
          {:catch}
            <!-- Failure is delivered by the scoped toast. -->
          {/await}

          <h3>Requests needing attention</h3>
          {#if data.requests.filter((r) => r.request.state === 'pending').length}<div
              class="overflow"
            >
              <table class="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>User</th>
                    <th>Destination</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {#each data.requests.filter((r) => r.request.state === 'pending') as r}
                    <tr>
                      <td>{r.title}</td>
                      <td>{r.username}</td>
                      <td>{r.destination}</td>

                      <td>
                        {#if r.blocked}
                          <span class="quiet">{r.blocked}</span>
                        {:else}
                        <div class="row">
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
                        </div>
                        {/if}
                      </td
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
                  { ...body, level: noticePresentation, locked: body.locked === 'on' },
                  'Notice delivered.'
                )
              ) {
                form.reset();
                noticePresentation = 'normal';
              }
            }}
          >
            <label class="field">Title<input name="title" required maxlength="160" /></label><label
              class="field"
              >Message<textarea name="body" rows="3" maxlength="2000"></textarea></label
            >
            <SettingsChoice label="Presentation" options={notificationOptions} bind:value={noticePresentation} />
            <SettingsSwitch name="locked" label="Mark as important" /><Button type="submit" disabled={busy}>Send notice</Button>
          </form>
        </div>
      {:else if data.section === 'integrations'}<IntegrationSettings inline={redesigned}
            editId={settingsUrl.searchParams.get('integration') ?? undefined}
          providers={data.providers}
          experimentalGaming
          experimentalComics
        />
      {:else if data.section === 'users'}<div class="stack">
          {#if data.usersTab!=='users'}
            {#key data.usersTab}<AdminInviteSettings inline={redesigned} view={data.usersTab} connections={data.inviteAuthorities} />{/key}
          {:else}
          <div class="row">
            <Button size="segment" emphasis="subtle" pressed={selectingAccounts} onclick={() => {
              selectingAccounts = !selectingAccounts;
              if (!selectingAccounts) { selectedAccounts = []; bulkAccess = false; }
            }}>{selectingAccounts ? 'Done selecting' : 'Select members'}</Button>
            {#if selectedAccounts.length}
              <Button size="segment" emphasis="subtle" onclick={() => { bulkAccess = !bulkAccess; accountDetail = ''; editing = null; }}>
                Apply access to {selectedAccounts.length} selected
              </Button>
            {/if}
          </div>
          {#if bulkAccess}
            <AccountAccessControls inline={redesigned} selection={selectedAccounts} onclose={() => { bulkAccess = false; }}
              onchange={() => void refreshRouteDependencies(['settings'])} />
          {/if}
          {#each data.accounts.items as user (user.id)}
            {@const role = user.role === 'admin' ? 'Administrator' : 'Member'}
            {@const status = user.disabled ? 'Suspended' : user.expired ? 'Expired' : 'Active'}
            {@const name = user.settings.profile?.displayName || user.username}
            {@const opened = accountDetail === user.id || editing?.id === user.id}
            <div class="stack member">
              <AuthSurface>
                {#if selectingAccounts && user.role === 'user'}
                  <label class="menu-row member-identity">
                    <AccountIdentity {name} avatar={user.settings.profile?.avatar} detail={`${role} · ${status}`} />
                    <input type="checkbox" bind:group={selectedAccounts} value={user.id} aria-label={`Select ${user.username}`}
                      disabled={selectedAccounts.length >= 20 && !selectedAccounts.includes(user.id)} />
                  </label>
                {:else}
                  <button type="button" class="menu-row member-identity" aria-expanded={opened}
                    onclick={() => {
                      if (busy) return;
                      editing = null;
                      bulkAccess = false;
                      accountDetail = opened ? '' : user.id;
                    }}>
                    <AccountIdentity {name} avatar={user.settings.profile?.avatar} detail={`${role} · ${status}`} />
                    <span class="menu-chevron member-chevron" class:expanded={opened}><Icon name="right" size={16} /></span>
                  </button>
                {/if}
              </AuthSurface>
              {#if opened}
                <p class="small member-summary">{user.username}{user.email ? ` · ${user.email}` : ''}</p>
                <div class="row">
                  <Button size="segment" emphasis="subtle" disabled={busy} onclick={() => {
                    error = '';
                    accountDetail = '';
                    editing = { id: user.id, username: user.username, email: user.email ?? '', role: user.role,
                      disabled: user.disabled, password: '',
                      personalBitrateMbps: user.settings.personalBitrateMbps ?? data.config?.maxBitrateMbps ?? 120,
                      sharedBitrateMbps: user.settings.sharedBitrateMbps ?? 20 };
                  }}>Edit</Button>
                  {#if user.id !== viewer?.id}
                    <Button size="segment" emphasis="subtle" onclick={() => { error = ''; deleteId = user.id; }}>Delete</Button>
                  {/if}
                </div>
                {#if editing?.id === user.id}
                  {#if redesigned}
                    {@render editMember()}
                  {:else}
                    <Dialog open={true} title={`Edit ${user.username}`} onclose={() => { if (!busy) editing = null; }}>
                      {@render editMember(false)}
                    </Dialog>
                  {/if}
                {:else if accountDetail === user.id}
                  {#if data.installationFeatureDefaults}
                    <MemberFeaturePermissions account={user} config={data.installationFeatureDefaults} />
                  {/if}
                  <AccountAccessControls inline={redesigned} userId={user.id} onclose={() => { accountDetail = ''; }}
                    onchange={() => void refreshRouteDependencies(['settings'])} />
                {/if}
              {/if}
            </div>
          {/each}
          {#if data.accounts.next}<div class="row"><Button emphasis="subtle" href={'/settings/users?before='+data.accounts.next}>Next page</Button></div>{/if}
          {#if settingsUrl.searchParams.has('before')}<div class="row"><Button emphasis="subtle" href="/settings/users">First page</Button></div>{/if}
          <details class="member-create">
            <summary>Create a Coast account</summary>
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
                    { ...body, role: newAccountRole, email: body.email || undefined },
                    'Account created.'
                  )
                ) {
                  form.reset();
                  newAccountRole = 'user';
                }
              }}
            >
              <label class="field">
                Username

                <input
                  name="username"
                  required
                  minlength="3"
                  maxlength="32"
                />
              </label>

              <label class="field">
                Password

                <input
                  name="password"
                  type="password"
                  required
                  minlength="8"
                  autocomplete="new-password"
                /></label
              ><label class="field"
                >Email <small>Optional</small><input name="email" type="email" /></label
              >
              <SettingsChoice label="Role" options={roles} bind:value={newAccountRole} />
              <Button type="submit" disabled={busy}>Create account</Button>
            </form>
          </details>
        {/if}
        </div>
      {:else if data.section === 'policies' && policy}<form id={draftForm}
          class="stack form-width" oninvalidcapture={revealInvalid}
          onsubmit={(e) => {
            e.preventDefault();
            void saveDraft();
          }}
        >
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} id="development" data-settings-panel hidden={policyPanel !== 'system'} disabled={busy}>
            <legend class="sr-only">Development</legend>
            <SettingsRow title="Developer mode" description="Pause automatic jobs, queued background work and retention cleanup. Run and Retry remain available, as do actions you explicitly take. Running jobs finish their current run."><Toggle label="Developer mode" bind:checked={policy.developerMode}/></SettingsRow>
          </fieldset>
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} id="access" data-settings-panel hidden={policyPanel !== 'access'} disabled={busy}>
            <legend class="sr-only">Access & registration</legend>
            <h3>Access & registration</h3>
            <PreviewSelect topLayer disabled={busy} label="Website access" options={siteAccessOptions} bind:value={policy.siteAccess} />
            <p class="small">Public profiles respect each user’s privacy settings.</p>
            <PreviewSelect topLayer disabled={busy} label="Registration" options={registrationOptions} bind:value={policy.registrationMode} />
            <PreviewSelect topLayer disabled={busy} label="Required connection" options={providerOptions} bind:value={policy.registrationProvider} />
            <p class="small">New accounts complete their selected imports before entering Coast. Manage providers in Integrations.</p>
          </fieldset>
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} id="sessions" data-settings-panel hidden={policyPanel !== 'access'} disabled={busy}>
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
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} id="playback-policy" data-settings-panel hidden={policyPanel !== 'media'} disabled={busy}>
            <legend class="sr-only">Playback</legend>
            <h3>Playback</h3>
            <PreviewSelect topLayer disabled={busy} label="Delivery policy" options={deliveryOptions} bind:value={policy.playbackDelivery} />
            <label class="field"
              >Maximum bitrate (Mbps)<input
                type="number"
                min="1"
                max="1000"
                bind:value={policy.maxBitrateMbps}
                required
              /><small>Per-stream ceiling for normal playback and shared viewers. Shared links have a separate aggregate budget.</small></label
            ><SettingsSwitch label="Allow Jellyfin transcoding" bind:checked={policy.allowTranscoding} /><SettingsRow title="H.265 VRChat sharing" description="Allow an experimental H.265 / AAC fMP4 HLS option. H.264 remains the default; support depends on the world player and device."><Toggle label="H.265 VRChat sharing" bind:checked={policy.allowVrchatHevc}/></SettingsRow
            ><label class="field"
              >VRChat idle timeout (minutes)<input
                type="number"
                min="1"
                max="120"
                step="1"
                bind:value={policy.vrchatViewerIdleMinutes}
                required
              /><small>How long an idle VRChat viewer keeps its stream and bandwidth reservation. Link expiration and auto-revoke can end it sooner.</small>
            </label
            >
            <PreviewSelect topLayer disabled={busy} label="Default subtitle mode" options={subtitleOptions} bind:value={policy.subtitleDefault} />
            <label class="field"
              >Default subtitle languages<input
                bind:value={policyLanguagesText}
                placeholder="en, fr"
              /></label
            >
          </fieldset>
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} id="metadata" data-settings-panel hidden={policyPanel !== 'media'} disabled={busy}>
            <legend class="sr-only">Metadata</legend>
            <h3>Metadata</h3>
            <p class="small muted">Film and TV sources are checked in order for each field. Personal choices and admin overrides still apply. Jellyfin artwork requires server access.</p>
            {#each metadataFamilies as family (family)}
              {@const preference = sourcePreference(policy.metadataSource, family)}
              <PreviewSelect topLayer disabled={busy} label={familyLabels[family]} options={metadataOptions}
                value={Array.isArray(preference) ? preference.join(',') : preference}
                onchange={value => chooseSourceOrder(family, value)} />
            {/each}
            <SettingsSwitch label="Cache TMDB artwork on this server" bind:checked={policy.cacheTmdbArtwork} />
            <SettingsSwitch label="Cache media server artwork on this server" bind:checked={policy.cacheServerArtwork} /><p class="small muted">Save local copies when viewed. Media server images remain permission checked and served through Coast. Turning either cache off bypasses saved copies and stops new disk writes.</p>
          </fieldset>
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} id="network" data-settings-panel hidden={policyPanel !== 'system'} disabled={busy}>
            <legend class="sr-only">Integrations & network</legend>
            <h3>Integrations & network</h3>
            <SettingsSwitch label="Allow Trakt synchronisation" bind:checked={policy.enableTrakt} /><label class="field"
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
          <fieldset class="panel stack glass settings-glass" use:liquidGlass={{ variant: 'clear', renderer: 'css' }} id="notifications" data-settings-panel hidden={policyPanel !== 'system'} disabled={busy}>
            <legend class="sr-only">Notifications</legend>
            <h3>Notifications</h3>
            <PreviewSelect topLayer disabled={busy} label="Default presentation" options={notificationOptions}
              value={policy.notificationLevel === 'silent' ? 'normal' : policy.notificationLevel}
              onchange={value => policy && (policy.notificationLevel = value)} />
            <SettingsSwitch label="Allow personal toast duration preferences" bind:checked={policy.allowNotificationSilencing} />
          </fieldset>
          {@render saveControls()}
        </form>
      {:else if data.section === 'activity'}
        {#if policy}<form id={draftForm}
            class="panel stack form-width" data-settings-panel hidden={diagnosticPanel !== 'logging'}
            oninvalidcapture={revealInvalid}
            onsubmit={(e) => {
              e.preventDefault();
              void saveDraft();
            }}
          >
            <PreviewSelect topLayer disabled={busy} label="Diagnostic logging" options={diagnosticsOptions} bind:value={policy.diagnosticLevel} />
            <label class="field">Maximum diagnostic log size (MiB)
              <input type="number" min="4" max="4096" step="1" required disabled={busy} bind:value={policy.diagnosticMaxSizeMiB} />
            </label>
            <label class="field">Maximum diagnostic log age (days)
              <input type="number" min="1" max="365" step="1" required disabled={busy} bind:value={policy.diagnosticMaxAgeDays} />
            </label>
            <p class="small">
              Info includes routine outcomes and slow requests. Warn shows problems Coast can
              recover from, and Error shows failed operations that need attention. Debug adds
              lifecycle and cancelled requests. Trace adds playback samples and provider starts.
              Changes apply while Coast is running. The defaults are 256 MiB and seven days.
              Oldest application diagnostics are removed when either limit is reached. Lowering
              a limit removes older logs on the next read or write. Resource history, security
              and audit records are kept separately.
            </p>
            {@render saveControls()}
          </form>{/if}
        <div class="stack" data-settings-panel hidden={diagnosticPanel !== 'events'}>
        <AuthSurface>
          <a class="menu-row" href="/api/v1/diagnostics?download">
            <Icon name="download" size={16} /><span>Download recent diagnostics</span>
            <span class="menu-chevron"><Icon name="right" size={16} /></span>
          </a>
        </AuthSurface>
        <p class="small">
          Administrator diagnostics include application and playback failures. Sensitive credentials
          and personal data are excluded.
        </p>
        {#if data.loggingAudit.length || data.metadataAudit.length}<details
            class="panel"
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
                  ><strong>{event.level} · {event.kind}</strong> · {event.message}<small
                    style="display:block;margin-block-start:var(--row-text-gap)"
                    >{new Date(event.createdAt).toLocaleString()}</small
                  ></summary
                >
                <pre>{JSON.stringify(
                    {
                      level: event.level,
                      correlationId: event.correlationId,
                      requestId: event.requestId,
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
          />{/if}
        </div>
      {/if}
  </section>
{/snippet}
{#snippet resetConfirmation()}
  <div class="stack">
    <p>
      This resets appearance, notification, playback and conflict resolution preferences. Subtitle
      defaults follow your administrator’s current policy.
    </p>
    <p class="small">
      Your profile, tracking data, passwords and linked service accounts are preserved.
    </p>
    <div class="row">
      <Button
        disabled={busy}
        onclick={resetPreferences}
      >{busy ? 'Restoring…' : 'Restore all preferences'}</Button>

      <Button disabled={busy} onclick={() => resetOpen = false}>Keep preferences</Button>
    </div>
  </div>
{/snippet}
{#snippet dialogs()}
  <div class="settings-dialog">
  {#if !redesigned}<Dialog bind:open={resetOpen} title="Restore all personal preferences?">
    {@render resetConfirmation()}
  </Dialog>{/if}


<Dialog
  onclose={() => deleteId = ''}
  open={!!deleteId}
  title="Delete this Coast account?"
>
  <div class="stack">
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
          if (await save(`admin/users/${deleteId}`, {}, 'Account deleted.', 'DELETE')) deleteId = '';
        }}
      >Delete Coast account</Button>
      <Button disabled={busy} onclick={() => deleteId = ''}>Cancel</Button>
    </div>
  </div></Dialog
>



  </div>
{/snippet}


<style>
  .legacy-settings-content { display: grid; align-content: start; gap: var(--auth-gap); min-inline-size: 0; }
  .legacy-settings-content > :global(.button) { justify-self: start; }

  .section-description {
    margin: 0 0 var(--auth-gap);
    color: var(--muted);
  }
  fieldset {
    min-width: 0;
    border: 1px solid var(--line);
  }
  fieldset:disabled {
    opacity: 0.75;
  }
  .member-identity { min-block-size: 60px; text-align: start; }
  .member-identity input { margin-inline-start: auto; flex: none; }
  .member-chevron.expanded { transform: rotate(90deg); }
  .member-summary { overflow-wrap: anywhere; }
  .member-create > .small { margin-block-end: var(--auth-gap); }
  .save-controls {
    display: grid;
    gap: var(--auth-action-gap);
  }
  fieldset[id] {
    scroll-margin-block-start: var(--auth-gap);
  }
  .settings-main {
    min-width: 0;
  }
  .section-label { margin: 0; padding-inline: var(--auth-gap); color: var(--muted); font-size: var(--text-sm); font-weight: var(--weight-semibold); }
  .account-note { margin-inline-start: auto; overflow-wrap: anywhere; text-align: end; }
  .settings-main .settings-glass {
    background: var(--coast-glass-fill);
    border: 0;
  }
  .settings-main .settings-glass > h3 {
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }
  .settings-main .settings-glass :global(.setting) {
    padding: 0;
    border: 0;
    gap: var(--auth-gap);
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
  }
</style>
