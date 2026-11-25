<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import AccountIdentity from '#lib/auth/ui/AccountIdentity.svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import GlassSeparator from '#lib/auth/ui/GlassSeparator.svelte';
  import SettingsPanels from '#lib/ui/cards/editor/SettingsPanels.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Icon, { type IconName } from '#lib/ui/components/Icon.svelte';
  import SegmentedControl from '#lib/ui/components/SegmentedControl.svelte';
  import { administratorSettings, settingsTitles, type SettingsSection } from './sections';
  import './settings-surface.css';

  let { section, requestedArea, requestedGroup, identity, appearanceNote, privacyNote,
    admin, libraryOnly, saveForm, busy, dirty, onclose, children: content, dialogs, subnavigation, panelKey }: {
    section?: SettingsSection;
    requestedArea: string | null;
    requestedGroup: string | null;
    identity: { name: string; avatar?: string | null };
    appearanceNote: string;
    privacyNote: string;
    admin: boolean;
    libraryOnly: boolean;
    saveForm?: string;
    busy: boolean;
    dirty: boolean;
    onclose: () => void;
    children: Snippet;
    dialogs?: Snippet;
    subnavigation?: Snippet;
    panelKey?: string;
  } = $props();

  const icons: Record<SettingsSection, IconName> = {
    account: 'user', api: 'key', appearance: 'image', collection: 'collection', connections: 'link',
    features: 'sparkle', pending: 'retry', playback: 'play', privacy: 'shield', users: 'friends',
    activity: 'list', admin: 'home', backups: 'download', benchmarks: 'ruler', 'features-policy': 'sparkle',
    integrations: 'server', jobs: 'clock', policies: 'shield',
  };
  const options = [
    { value: 'personal', label: 'Personal', href: '/settings' },
    { value: 'admin', label: 'Admin', href: '/settings?area=admin' },
  ];
  const inlinePersonal = new Set<SettingsSection>(['account', 'appearance', 'playback', 'collection', 'privacy', 'features', 'api']);
  const expanded = $derived(section && inlinePersonal.has(section) ? section : undefined);
  const overview = $derived(!section || !!expanded);
  const showAdmin = $derived(admin && !libraryOnly);
  const area = $derived(showAdmin && (section
    ? administratorSettings.some(([id]) => id === section)
    : ['admin', 'accounts', 'system'].includes(requestedArea ?? '')) ? 'admin' : 'personal');
  const direction = $derived(area === 'admin' ? 1 : -1);
  const title = $derived(section === 'users' && panelKey === 'invites' ? 'Invitations'
    : section === 'users' && panelKey === 'defaults' ? 'Invitation defaults'
    : section === 'users' ? 'Members' : section ? settingsTitles[section] : 'Settings');
  const installation = ['admin', 'features-policy', 'policies'] as const;
  const operations = ['jobs', 'backups', 'benchmarks', 'activity'] as const;
  const systemGroup = $derived((installation as readonly SettingsSection[]).some(id => id === section) ? 'installation'
    : (operations as readonly SettingsSection[]).some(id => id === section) ? 'operations' : undefined);
  const activeGroup = $derived(systemGroup ?? (requestedGroup === 'installation' || requestedGroup === 'operations' ? requestedGroup : undefined));
  const backHref = $derived(section === 'pending' ? '/settings/connections'
    : systemGroup ? `/settings?area=admin&group=${systemGroup}`
      : area === 'admin' ? '/settings?area=admin' : '/settings');
  let scroller = $state<HTMLDivElement>();
  const pageKey = $derived(`${section ?? area}:${panelKey ?? ''}`);

  $effect(() => {
    pageKey;
    const scroll = scroller;
    if (!scroll) return;
    if (systemGroup || expanded && expanded !== 'account') {
      void tick().then(() => scroll.querySelector<HTMLElement>('[data-settings-expanded]')?.scrollIntoView({ block: 'nearest' }));
    } else {
      scroll.scrollTop = 0;
    }
  });

</script>

{#snippet row(label: string, icon: IconName, href: string, note?: string)}
  {@const descriptionId = note ? `settings-note-${encodeURIComponent(href)}` : undefined}
  <a class="menu-row overview-row" {href} aria-label={label} aria-describedby={descriptionId}>
    <Icon name={icon} size={16} />
    <span class="overview-label">{label}</span>
    {#if note}<span id={descriptionId} class="menu-row-note overview-note">{note}</span>{/if}
    <span class="menu-chevron"><Icon name="right" size={16} /></span>
  </a>
{/snippet}

{#snippet sectionRow(id: SettingsSection)}
  {@render row(settingsTitles[id], icons[id], `/settings/${id}`)}
{/snippet}

{#snippet group(label: string, rows: Snippet)}
  <section class="overview-group">
    <h2>{label}</h2>
    <AuthSurface>{@render rows()}</AuthSurface>
  </section>
{/snippet}

{#snippet sectionBody()}
  <div class="section-heading">
    <h2>{title}</h2>
    {#if saveForm}
      <AuthSurface anchor>
        <Button size="segment" type="submit" form={saveForm} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</Button>
      </AuthSurface>
    {/if}
  </div>
  {@render subnavigation?.()}
  {@render content()}
{/snippet}

{#snippet personalRow(id: SettingsSection, label = settingsTitles[id], note?: string, showContent = true)}
  {@const selected = showContent && expanded === id}
  {@const descriptionId = note ? `settings-note-${id}` : undefined}
  <div class="personal-group" data-settings-expanded={selected ? '' : undefined}>
    <AuthSurface>
      <a class="menu-row overview-row" href={selected ? '/settings' : `/settings/${id}`}
        aria-label={label} aria-describedby={descriptionId} aria-expanded={selected} aria-controls={selected ? 'settings-section-content' : undefined}>
        <Icon name={icons[id]} size={16} />
        <span class="overview-label">{label}</span>
        {#if note}<span id={descriptionId} class="menu-row-note overview-note">{note}</span>{/if}
        <span class="menu-chevron identity-chevron" class:expanded={selected}><Icon name="right" size={16} /></span>
      </a>
    </AuthSurface>
    {#if selected}
      {#key pageKey}
        <div id="settings-section-content" class="inline-section">{@render sectionBody()}</div>
      {/key}
    {/if}
  </div>
{/snippet}

{#snippet personal(showContent: boolean)}
  {#if showContent && expanded === 'account'}
    <div id="settings-section-content" class="inline-section">{@render sectionBody()}</div>
    <GlassSeparator />
  {/if}
  {#if !libraryOnly}
    <AuthSurface>{@render sectionRow('connections')}</AuthSurface>
    <GlassSeparator />
  {/if}
  <section class="overview-group" aria-label="Preferences">
    <h2>Preferences</h2>
    {@render personalRow('appearance', 'Appearance', appearanceNote, showContent)}
    {#if !libraryOnly}
      {@render personalRow('playback', 'Playback', undefined, showContent)}
      {@render personalRow('collection', 'Collection', undefined, showContent)}
      {@render personalRow('privacy', 'Privacy & social', privacyNote, showContent)}
    {/if}
    {@render personalRow('features', 'Features', undefined, showContent)}
  </section>
  {#if !libraryOnly}
    <GlassSeparator />
    <section class="overview-group" aria-label="Account access">
      <h2>Account access</h2>
      {@render personalRow('api', 'API access', undefined, showContent)}
    </section>
  {/if}
{/snippet}

{#snippet administrator(showContent: boolean)}
  {#snippet accounts()}
    {@render row('Members', 'friends', '/settings/users')}
    {@render row('Invitations', 'ticket', '/settings/users?view=invites')}
    {@render row('Invitation defaults', 'sliders', '/settings/users?view=defaults')}
  {/snippet}
  {@render group('Accounts', accounts)}
  <GlassSeparator />
  <section class="overview-group" aria-label="System">
    <h2>System</h2>
    <AuthSurface>{@render sectionRow('integrations')}</AuthSurface>
    {#each [{ id: 'installation', title: 'Installation', icon: 'settings', sections: installation },
      { id: 'operations', title: 'Operations', icon: 'clock', sections: operations }] as item (item.id)}
      {@const selected = showContent && activeGroup === item.id}
      <AuthSurface>
        <a class="menu-row overview-row" href={selected ? '/settings?area=admin' : `/settings?area=admin&group=${item.id}`}
          aria-expanded={selected}>
          <Icon name={item.icon as IconName} size={16} />
          <span class="overview-label">{item.title}</span>
          <span class="menu-chevron identity-chevron" class:expanded={selected}><Icon name="right" size={16} /></span>
        </a>
      </AuthSurface>
      {#if selected}
        <div class="inline-section">
          {#each item.sections as id (id)}
            <AuthSurface>
              <a class="menu-row overview-row" aria-expanded={section === id}
                href={section === id ? `/settings?area=admin&group=${item.id}` : `/settings/${id}`}>
                <Icon name={icons[id]} size={16} />
                <span class="overview-label">{settingsTitles[id]}</span>
                <span class="menu-chevron identity-chevron" class:expanded={section === id}><Icon name="right" size={16} /></span>
              </a>
            </AuthSurface>
            {#if section === id}
              {#key pageKey}<div class="inline-section" data-settings-expanded>{@render sectionBody()}</div>{/key}
            {/if}
          {/each}
        </div>
      {/if}
    {/each}
  </section>
  <GlassSeparator />
  <AuthSurface>{@render row('UI reference', 'sliders', '/ui-preview')}</AuthSurface>
{/snippet}

<div class="settings-frame">
  <header class="settings-chrome">
    <h1 class="visually-hidden" tabindex="-1">{title}</h1>
    <AuthSurface>
      <a class="menu-row overview-identity" href={expanded === 'account' ? '/settings' : '/settings/account'} aria-label={`Account settings for ${identity.name}`}
        aria-expanded={expanded === 'account'} aria-controls={expanded === 'account' ? 'settings-section-content' : undefined}>
        <AccountIdentity {...identity} detail={libraryOnly ? 'Library-only account' : admin ? 'Administrator' : 'Coast account'} />
        <span class="identity-chevron" class:expanded={section === 'account'}><Icon name="right" size={16} /></span>
      </a>
    </AuthSurface>
    <nav aria-label="Settings navigation">
      <AuthSurface anchor>
        <Button href={section ? backHref : undefined} onclick={section ? undefined : onclose}
          size="segment" icon="arrowLeft" label={section ? `Back to ${area === 'admin' ? 'Admin' : section === 'pending' ? 'Connections' : 'Personal'}` : 'Close Settings'} />
      </AuthSurface>
      {#if showAdmin}
        <AuthSurface anchor>
          <SegmentedControl label="Settings area" {options} value={area} material="clear" />
        </AuthSurface>
      {/if}
    </nav>
  </header>

  <SettingsPanels section={area} {direction} liveBackdrop>
    {#snippet children(panel)}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keep the scroll region keyboard accessible.) -->
      <div class="settings-scroll" role="region" aria-label={`${title} content`} tabindex="0" data-select-viewport
        bind:this={scroller}>
        <div class="settings-content">
          {#if section && !overview && !systemGroup && panel === area}
            {#key pageKey}
              {@render sectionBody()}
              {#if section === 'connections' && !libraryOnly}
                <GlassSeparator />
                <AuthSurface>{@render sectionRow('pending')}</AuthSurface>
              {/if}
            {/key}
          {:else if panel === 'personal'}
            {@render personal(panel === area)}
          {:else if showAdmin}
            {@render administrator(panel === area)}
          {/if}
        </div>
      </div>
    {/snippet}
  </SettingsPanels>
  {#if section}{@render dialogs?.()}{/if}
</div>

<style>
  .settings-frame {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    inline-size: min(100%, var(--auth-width));
    block-size: 100%;
    min-block-size: 0;
  }
  .settings-chrome { display: grid; position: relative; z-index: 2; gap: var(--auth-gap); }
  .settings-chrome nav { display: flex; align-items: center; justify-content: space-between; gap: var(--auth-action-gap); }
  .visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
  .settings-scroll {
    min-block-size: 0;
    overflow: hidden auto;
    overscroll-behavior-y: contain;
    scrollbar-width: none;
    scroll-padding-block: var(--auth-gap);
  }
  .settings-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .settings-content {
    display: grid;
    align-content: start;
    gap: var(--auth-gap);
    padding-block: calc(2 * var(--auth-gap)) var(--auth-gap);
    min-inline-size: 0;
  }
  .section-heading { display: flex; justify-content: space-between; align-items: center; gap: var(--auth-gap); }
  .section-heading h2 { color: var(--ink); font-size: var(--text-xl); font-weight: var(--weight-semibold); margin: 0; }
  .overview-group, .personal-group { display: grid; gap: var(--auth-action-gap); }
  .inline-section { display: grid; gap: var(--auth-gap); min-inline-size: 0; margin-block: var(--auth-gap); }
  .overview-group h2 {
    margin: 0;
    padding-inline: calc(var(--menu-frame-inset) + var(--menu-item-inset));
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-menu);
  }
  .overview-row { min-block-size: var(--editor-row-height); }
  .overview-label { flex: 1; min-inline-size: 0; }
  .overview-note { flex: 0 1 auto; max-inline-size: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .overview-note + .menu-chevron { margin-inline-start: 0; }
  .overview-identity { min-block-size: 60px; }
  .identity-chevron { display: flex; margin-inline-start: auto; }
  .identity-chevron.expanded { transform: rotate(90deg); }
</style>
