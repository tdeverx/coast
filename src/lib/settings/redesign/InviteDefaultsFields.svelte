<script lang="ts">
  import SettingsChoice from '#lib/settings/SettingsChoice.svelte';
  import SettingsSwitch from '#lib/settings/SettingsSwitch.svelte';
  import { emptyInviteDefaults, scheduleDays, type InviteDefaults, type JellyfinSettings } from '#lib/auth/invites.js';
  import { jellyfinHasFamilyLimits, jellyfinPermissionFlags, jellyfinPlaybackFlags, jellyfinPreferenceFlags, subtitleModes, syncPlayOptions, unratedItems, type JellyfinConfiguration } from '#lib/auth/jellyfin-preset.js';
  import { audiences } from '#lib/social/model.js';
  import { api } from '#lib/ui/client.js';
  import { actionFeedback } from '#lib/ui/action-feedback.svelte.js';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import { onDestroy } from 'svelte';
  import Button from '#lib/ui/components/Button.svelte';

  let {defaults=$bindable(), connections=[], accessOnly=false}: {defaults:InviteDefaults;connections?:{id:string;name:string}[];accessOnly?:boolean}=$props();
  const libraries=createResource<{ItemId:string;Name?:string}[]>([]);
  let sourceId=$state('');
  const sourcePreview=createResource<{jellyfin:JellyfinSettings;configuration?:JellyfinConfiguration;folders:string[]}|null>(null);
  const playbackFlags=Object.entries(jellyfinPlaybackFlags) as [keyof typeof jellyfinPlaybackFlags,string][];
  const permissionFlags=Object.entries(jellyfinPermissionFlags) as [keyof typeof jellyfinPermissionFlags,string][];
  const preferenceFlags=Object.entries(jellyfinPreferenceFlags) as [keyof typeof jellyfinPreferenceFlags,string][];
  const capabilities=[['requests','Requests'],['social','Social features'],['parties','Parties']] as const;
  const policyLists=[['BlockedMediaFolders','Blocked library IDs'],['EnabledDevices','Allowed device IDs'],
    ['EnabledChannels','Allowed Live TV channel IDs'],['BlockedChannels','Blocked Live TV channel IDs'],
    ['EnableContentDeletionFromFolders','Libraries where deletion is allowed (IDs)']] as const;
  const configurationLists=[['GroupedFolders','Grouped library IDs'],['OrderedViews','Library display order (IDs)'],
    ['LatestItemsExcludes','Exclude library IDs from Latest'],['MyMediaExcludes','Exclude library IDs from My Media']] as const;
  const configurationText=[['AudioLanguagePreference','Preferred audio language'],['SubtitleLanguagePreference','Preferred subtitle language'],
    ['CastReceiverId','Cast receiver ID']] as const;
  const accountTypes = [
    { id: 'coast', label: 'Coast account', icon: 'user' },
    { id: 'managed', label: 'Create a managed Jellyfin account', icon: 'jellyfin' },
    { id: 'choice', label: 'Create or connect a Jellyfin account', icon: 'jellyfin' },
  ] as const;
  const inheritedSwitches = [{ id: '', label: 'Use default' }, { id: 'true', label: 'On' }, { id: 'false', label: 'Off' }];
  const dayOptions = scheduleDays.map(id => ({ id, label: id }));
  const subtitleOptions = [{ id: '', label: 'Use default' },
    ...subtitleModes.map(id => ({ id, label: id === 'OnlyForced' ? 'Only forced' : id }))] as const;
  const audienceOptions = [{ id: '', label: 'Use Coast default' },
    ...audiences.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) }))] as const;
  const configuration=$derived(defaults.jellyfinConfiguration??{});
  const list=(value:string)=>value.split(',').map(item=>item.trim()).filter(Boolean);
  const checkboxValue=(value:string)=>value===''?undefined:value==='true';
  const restricted=$derived(defaults.access.libraryOnly||jellyfinHasFamilyLimits(defaults.jellyfin));
  $effect(()=>{
    if(restricted&&defaults.sharingGrant)delete defaults.sharingGrant;
  });
  const schedule = $derived(defaults.jellyfin.AccessSchedules ?? []);
  $effect(()=>{
    const connection=defaults.account!=='coast' && defaults.connectionId;
    if(connection)void libraries.load(signal=>api('admin/invites/libraries?connectionId='+connection,undefined,'GET',{signal}));
    return libraries.cancel;
  });
  onDestroy(()=>{libraries.dispose();sourcePreview.dispose();});
  function set<K extends keyof JellyfinSettings>(key:K,value:JellyfinSettings[K]) {
    if(value===undefined)delete defaults.jellyfin[key];
    else defaults.jellyfin[key]=value;
    if(jellyfinHasFamilyLimits(defaults.jellyfin)&&defaults.jellyfin.EnableAllFolders)delete defaults.jellyfin.EnableAllFolders;
  }
  function setConfiguration<K extends keyof JellyfinConfiguration>(key:K,value:JellyfinConfiguration[K]) {
    if(value===undefined) {
      if(defaults.jellyfinConfiguration)delete defaults.jellyfinConfiguration[key];
    } else {
      defaults.jellyfinConfiguration??={};
      defaults.jellyfinConfiguration[key]=value;
    }
  }
  async function preview() {
    const connection=defaults.connectionId;
    if(!connection||sourcePreview.busy)return;
    const result=await sourcePreview.load(signal=>api('admin/invites/preset-preview?'+new URLSearchParams({connectionId:connection,sourceId}),undefined,'GET',{signal}));
    if(result&&defaults.connectionId===connection){
      defaults.jellyfin=result.jellyfin;defaults.jellyfinConfiguration=result.configuration;defaults.folders=result.folders;
    }else if(sourcePreview.error)actionFeedback.failure(sourcePreview.error);
  }
</script>

{#if !accessOnly}
  <SettingsChoice label="Account type" bind:value={defaults.account} options={accountTypes}
    onchange={account=>{if(account!=='managed')delete defaults.access.libraryOnly;}} />
{/if}
{#if defaults.account!=='coast'}
  {#if !accessOnly}
    <SettingsChoice label="Jellyfin management access" icon="jellyfin" value={defaults.connectionId??''}
      options={[{ id: '', label: 'Choose a server API key or Jellyfin admin account' }, ...connections.map(item=>({ id: item.id, label: item.name }))]}
      onchange={id=>{defaults.connectionId=id||undefined;defaults.folders=[];}} />
  {/if}
  {#if defaults.connectionId}
    <fieldset class="stack">
      <legend>Jellyfin libraries</legend>
      <SettingsSwitch label="All libraries" checked={defaults.jellyfin.EnableAllFolders===true&&!restricted} disabled={restricted}
        onchange={checked=>{set('EnableAllFolders',checked||undefined);if(checked)defaults.folders=[];}} />
      {#if libraries.busy}<p role="status">Loading libraries…</p>{/if}
      {#if libraries.error}<p role="status">{libraries.error}</p>{/if}
      {#each libraries.data as library (library.ItemId)}
        <label class="row"><input type="checkbox" bind:group={defaults.folders} disabled={defaults.jellyfin.EnableAllFolders&&!restricted} value={library.ItemId} /> {library.Name??library.ItemId}</label>
      {/each}
    </fieldset>
    {#if defaults.account==='managed'}
      <SettingsSwitch label="Library-only access in Coast" bind:checked={defaults.access.libraryOnly}
        onchange={checked=>{if(checked)set('EnableAllFolders',undefined);}} />
    {/if}
    <details class="stack">
      <summary>Jellyfin playback and family access</summary>
      {#each playbackFlags as [key,label] (key)}
        {@render policyToggle(key,label)}
      {/each}
      <label class="field">Remote bitrate limit (Mbps)<input type="number" min="0" max="1000" step="0.1" placeholder="Use default"
        value={defaults.jellyfin.RemoteClientBitrateLimit===undefined?'':defaults.jellyfin.RemoteClientBitrateLimit/1000000}
        oninput={event=>set('RemoteClientBitrateLimit',event.currentTarget.value?Math.round(event.currentTarget.valueAsNumber*1000000):undefined)} /></label>
      <label class="field">Maximum parental rating score<input type="number" min="0" max="1000" value={defaults.jellyfin.MaxParentalRating??''}
        oninput={event=>set('MaxParentalRating',event.currentTarget.value?event.currentTarget.valueAsNumber:null)} /></label>
      <label class="field">Maximum parental subrating score<input type="number" min="0" max="1000" value={defaults.jellyfin.MaxParentalSubRating??''}
        oninput={event=>set('MaxParentalSubRating',event.currentTarget.value?event.currentTarget.valueAsNumber:null)} /></label>
      <label class="field">Allowed tags (comma-separated)<input value={defaults.jellyfin.AllowedTags?.join(', ')??''}
        onchange={event=>set('AllowedTags',event.currentTarget.value.split(',').map(tag=>tag.trim()).filter(Boolean))} /></label>
      <label class="field">Blocked tags (comma-separated)<input value={defaults.jellyfin.BlockedTags?.join(', ')??''}
        onchange={event=>set('BlockedTags',event.currentTarget.value.split(',').map(tag=>tag.trim()).filter(Boolean))} /></label>
      <fieldset class="stack"><legend>Block unrated items</legend>
        {#each unratedItems as kind (kind)}
          <label class="row"><input type="checkbox" checked={defaults.jellyfin.BlockUnratedItems?.includes(kind)}
            onchange={event=>{const values=new Set(defaults.jellyfin.BlockUnratedItems);if(event.currentTarget.checked)values.add(kind);else values.delete(kind);set('BlockUnratedItems',[...values]);}} /> {kind}</label>
        {/each}
      </fieldset>
      <fieldset class="stack"><legend>Access hours in the Jellyfin server’s time zone</legend>
        {#if schedule.length}<label class="field">Jellyfin server time zone<input placeholder="Europe/London" maxlength="80" value={defaults.jellyfinTimeZone??''}
          oninput={event=>defaults.jellyfinTimeZone=event.currentTarget.value||undefined} /></label>{/if}
        {#each schedule as window,index}
          <div class="row">
            <SettingsChoice label="Day" icon="calendar" bind:value={window.DayOfWeek} options={dayOptions} />
            <label class="field">Start hour<input type="number" min="0" max="24" step="0.25" bind:value={window.StartHour} /></label>
            <label class="field">End hour<input type="number" min="0" max="24" step="0.25" bind:value={window.EndHour} /></label>
            <Button emphasis="subtle" onclick={()=>set('AccessSchedules',schedule.filter((_,i)=>i!==index))}>Remove</Button>
          </div>
        {/each}
        <div class="row"><Button emphasis="subtle" disabled={schedule.length>=35} onclick={()=>set('AccessSchedules',[...schedule,{DayOfWeek:'Everyday',StartHour:8,EndHour:20}])}>Add access window</Button></div>
      </fieldset>
    </details>
    <details class="stack">
      <summary>Jellyfin permissions, devices and channels</summary>
      {#each permissionFlags as [key,label] (key)}
        {@render policyToggle(key,label)}
      {/each}
      {@render policyToggle('EnableAllDevices','Allow all devices')}
      {#if defaults.jellyfin.EnableAllDevices===false}<p>Coast is included alongside the devices you allow.</p>{/if}
      {@render policyToggle('EnableAllChannels','Allow all Live TV channels')}
      {@render policyToggle('EnableContentDeletion','Allow media deletion in all libraries')}
      {#each policyLists as [key,label] (key)}
        <label class="field">{label}<input value={defaults.jellyfin[key]?.join(', ')??''}
          onchange={event=>set(key,list(event.currentTarget.value))} /></label>
      {/each}
      <SettingsChoice label="SyncPlay access" icon="party" value={defaults.jellyfin.SyncPlayAccess??''}
        options={[{ id: '', label: 'Use default' }, { id: syncPlayOptions[0], label: 'Disabled' },
          { id: syncPlayOptions[1], label: 'Join groups' }, { id: syncPlayOptions[2], label: 'Create and join groups' }]}
        onchange={value=>set('SyncPlayAccess',value||undefined)} />
      <label class="field">Failed attempts before lockout<input type="number" min="-1" placeholder="Use default" value={defaults.jellyfin.LoginAttemptsBeforeLockout??''}
        oninput={event=>set('LoginAttemptsBeforeLockout',event.currentTarget.value?event.currentTarget.valueAsNumber:undefined)} /></label>
      <label class="field">Maximum active sessions<input type="number" min="0" placeholder="Use default" value={defaults.jellyfin.MaxActiveSessions??''}
        oninput={event=>set('MaxActiveSessions',event.currentTarget.value?event.currentTarget.valueAsNumber:undefined)} /></label>
      <label class="field">Jellyfin password reset provider ID<input maxlength="200" value={defaults.jellyfin.PasswordResetProviderId??''}
        onchange={event=>set('PasswordResetProviderId',event.currentTarget.value.trim()||undefined)} /></label>
      <p>Invited accounts use Jellyfin’s local password sign-in. Suspension is managed in Users.</p>
    </details>
    <details class="stack">
      <summary>Jellyfin starting preferences</summary>
      {#each preferenceFlags as [key,label] (key)}
        <SettingsChoice {label} value={String(configuration[key]??'')} options={inheritedSwitches}
          onchange={value=>setConfiguration(key,checkboxValue(value))} />
      {/each}
      {#each configurationText as [key,label] (key)}
        <label class="field">{label}<input maxlength="200" value={configuration[key]??''}
          onchange={event=>setConfiguration(key,event.currentTarget.value.trim()||null)} /></label>
      {/each}
      <SettingsChoice label="Subtitle mode" icon="subtitles" value={configuration.SubtitleMode??''} options={subtitleOptions}
        onchange={value=>setConfiguration('SubtitleMode',value||undefined)} />
      {#each configurationLists as [key,label] (key)}
        <label class="field">{label}<input value={configuration[key]?.join(', ')??''} onchange={event=>setConfiguration(key,list(event.currentTarget.value))} /></label>
      {/each}
    </details>
    {#if !accessOnly}<div class="row">
      <label class="field">Copy settings from a Jellyfin user ID<input bind:value={sourceId} maxlength="36" /></label>
      <Button emphasis="subtle" onclick={preview} disabled={!sourceId||sourcePreview.busy}>Load preview</Button>
    </div>{/if}
  {/if}
{/if}
<fieldset class="stack">
  <legend>Coast permissions</legend>
  <SettingsChoice label="Coast playback sharing" icon="share" disabled={restricted}
    value={defaults.access.sharing===false?'block':defaults.sharingGrant?'grant':''}
    options={[{ id: '', label: 'Use account permission' }, { id: 'grant', label: 'Grant sharing' }, { id: 'block', label: 'Block sharing' }]}
    onchange={choice=>{
      if(choice==='block')defaults.access.sharing=false;
      else delete defaults.access.sharing;
      if(choice==='grant')defaults.sharingGrant=true;
      else delete defaults.sharingGrant;
    }} />
  {#each capabilities as [key,label] (key)}
    <SettingsSwitch label={`Block ${label.toLowerCase()}`} checked={defaults.access[key]===false} disabled={restricted && key!=='social'}
      onchange={checked=>{if(checked)defaults.access[key]=false;else delete defaults.access[key];}} />
  {/each}
</fieldset>
{#if !accessOnly}<fieldset class="stack">
  <legend>Starting preferences</legend>
  <SettingsChoice label="Theme" icon="layers" value={defaults.preferences.theme??''}
    options={[{ id: '', label: 'Use Coast default' }, { id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]}
    onchange={value=>defaults.preferences.theme=value||undefined} />
  <SettingsSwitch label="Prefer original titles" bind:checked={defaults.preferences.originalTitles} />
  <SettingsChoice label="Notifications" icon="bell" value={defaults.preferences.notificationLevel??''}
    options={[{ id: '', label: 'Use Coast default' }, { id: 'normal', label: 'Normal' }, { id: 'persistent', label: 'Persistent' }]}
    onchange={value=>defaults.preferences.notificationLevel=value||undefined} />
  <SettingsChoice label="Profile audience" icon="shield" value={defaults.preferences.social?.audience??''}
    options={audienceOptions} onchange={audience=>defaults.preferences.social=audience?{audience}:undefined} />
  <label class="field">Preferred subtitle languages (comma-separated)<input value={defaults.preferences.subtitleLanguages?.join(', ')??''}
    onchange={event=>defaults.preferences.subtitleLanguages=list(event.currentTarget.value)} /></label>
  <SettingsSwitch label="Always show subtitles" bind:checked={defaults.preferences.subtitlesAlways} />
  <SettingsSwitch label="Prompt for subtitles when available" bind:checked={defaults.preferences.subtitlePrompt} />
</fieldset>
<label class="field">Membership length (days)<input type="number" min="1" max="3650" placeholder="No expiry"
  value={defaults.membershipDays??''} oninput={event=>defaults.membershipDays=event.currentTarget.value?event.currentTarget.valueAsNumber:emptyInviteDefaults.membershipDays} /></label>{/if}


{#snippet policyToggle(key: keyof typeof jellyfinPlaybackFlags | keyof typeof jellyfinPermissionFlags | 'EnableAllDevices' | 'EnableAllChannels' | 'EnableContentDeletion',label:string)}
  <SettingsChoice {label} value={String(defaults.jellyfin[key]??'')} options={inheritedSwitches}
    onchange={value=>set(key,checkboxValue(value))} />
{/snippet}
