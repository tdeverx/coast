<script lang="ts">
  import { featureDefinitions, featureGranted, experimentalFeatures, type Feature, type FeatureChoices, type FeatureConfiguration, type FeaturePermissions } from '#lib/features.js';
  import type { UserSettings } from '#lib/server/db/schema.js';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  import { api, change, message } from '#lib/ui/client.js';
  import { notifyAction } from '#lib/ui/action-feedback.svelte.js';

  type Snapshot = { permissions: FeaturePermissions; preferences: FeatureChoices };
  let { account, config }: { account: {id: string; username: string; role: string; settings: UserSettings}; config: FeatureConfiguration } = $props();
  let expanded = $state(false);
  let pending = $state(false);
  let error = $state('');
  let snapshot = $state<Snapshot>();
  let permissions = $state<FeaturePermissions>({});
  let preferences = $state<FeatureChoices>({});
  const dirty = $derived(Object.keys(permissions).length > 0 || Object.keys(preferences).length > 0);
  const endpoint = $derived(`admin/users/${account.id}/features`);
  const id = $props.id();

  function granted(key: Feature) {
    return featureGranted(config, key, snapshot?.permissions ?? account.settings.featurePermissions ?? {},
      account.role === 'admin' || account.settings.allowPlaybackSharing === true);
  }

  function selected(key: Feature) {
    return snapshot?.preferences[key] ?? (!snapshot ? account.settings.features?.[key] : undefined) ?? granted(key);
  }

  function setPermission(key: Feature, allowed: boolean) {
    if (allowed === granted(key)) delete permissions[key];
    else permissions[key] = allowed;
  }

  function setPreference(key: Feature, enabled: boolean) {
    if (enabled === selected(key)) delete preferences[key];
    else preferences[key] = enabled;
  }

  async function toggle() {
    if (pending) return;
    if (expanded) {
      if (dirty && !window.confirm('Discard unsaved feature permissions?')) return;
      permissions = {};
      preferences = {};
      expanded = false;
      return;
    }
    pending = true;
    error = '';
    try {
      snapshot = await api<Snapshot>(endpoint, undefined, 'GET');
      expanded = true;
    } catch (cause) { error = message(cause); }
    finally { pending = false; }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (pending || !dirty) return;
    pending = true;
    error = '';
    try {
      snapshot = await change<Snapshot>(endpoint, { permissions: $state.snapshot(permissions), preferences: $state.snapshot(preferences) }, 'PATCH');
      permissions = {};
      preferences = {};
      notifyAction('Feature permissions saved.');
    } catch (cause) { error = message(cause); }
    finally { pending = false; }
  }
</script>

<div class="permission-editor">
  <AuthSurface>
    <button type="button" class="menu-row" aria-expanded={expanded} aria-controls={expanded ? id : undefined} disabled={pending} onclick={toggle}>
      <Icon name="shield" size={16} />
      <span class="permission-name">Feature permissions for {account.username}</span>
      <span class="menu-chevron" class:expanded><Icon name="right" size={16} /></span>
    </button>
  </AuthSurface>
  {#if error}<p class="small" role="alert">{error}</p>{/if}
  {#if expanded}
    <form id={id} class="permission-editor" onsubmit={save}>
      <p class="small">Allow makes the feature available in the member’s Settings. Enabled sets the member’s current preference. Members can change it themselves.</p>
      <fieldset disabled={pending} class="permission-editor">
        {#each [false, true] as experimental}
          <h3>{experimental ? 'Experimental features' : 'Features'}</h3>
          {#each featureDefinitions.filter(([key]) => experimentalFeatures.includes(key) === experimental) as [key, label] (key)}
            {@const allowed = permissions[key] ?? granted(key)}
            <div class="permission-row">
              <span>{label}</span>
              <label><input type="checkbox" aria-label={`Allow ${label}`} checked={allowed}
                onchange={event => setPermission(key, event.currentTarget.checked)} /> Allow</label>
              <label><input type="checkbox" aria-label={`Enable ${label}`} checked={preferences[key] ?? selected(key)}
                disabled={!allowed} onchange={event => setPreference(key, event.currentTarget.checked)} /> Enabled</label>
            </div>
          {/each}
        {/each}
      </fieldset>
      <Button size="segment" type="submit" disabled={pending || !dirty}>Save feature permissions</Button>
    </form>
  {/if}
</div>

<style>
  .permission-editor { display: grid; gap: var(--auth-gap); min-inline-size: 0; }
  .permission-name { flex: 1; text-align: start; }
  .menu-chevron.expanded { transform: rotate(90deg); }
  fieldset { border: 0; padding: 0; }
  h3 { font-size: var(--text-md); }
  .permission-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: var(--auth-gap); align-items: center; }
  label { display: flex; align-items: center; gap: var(--auth-action-gap); font-size: var(--text-sm); }
  input { accent-color: var(--accent); }
</style>
