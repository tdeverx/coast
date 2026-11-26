<script lang="ts">
  import { emptyInviteDefaults, scheduleDays, type InviteDefaults, type JellyfinSettings } from '#lib/auth/invites.js';
  import { jellyfinHasFamilyLimits, jellyfinPermissionFlags, jellyfinPlaybackFlags, jellyfinPreferenceFlags, subtitleModes, syncPlayOptions, unratedItems, type JellyfinConfiguration } from '#lib/auth/jellyfin-preset.js';
  import { audiences } from '#lib/social/model.js';
  import { useClient } from '#lib/ui/client-context.js';
  const { api, feedback:actionFeedback } = useClient('current-viewer');
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

{#if !accessOnly}<label class="field">Account type
  <select bind:value={defaults.account} onchange={()=>{if(defaults.account!=='managed')delete defaults.access.libraryOnly;}}>
    <option value="coast">Coast account</option><option value="managed">Create a managed Jellyfin account</option><option value="choice">Create or connect a Jellyfin account</option>
  </select>
</label>{/if}
{#if defaults.account!=='coast'}
  {#if !accessOnly}<label class="field">Jellyfin management access
    <select value={defaults.connectionId??''} onchange={event=>{defaults.connectionId=event.currentTarget.value||undefined;defaults.folders=[];}}>
      <option value="">Choose a server API key or Jellyfin admin account</option>
      {#each connections as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
    </select>
  </label>{/if}
  {#if defaults.connectionId}
    <fieldset class="stack">
      <legend>Jellyfin libraries</legend>
      <label class="row"><input type="checkbox" checked={defaults.jellyfin.EnableAllFolders===true&&!restricted} disabled={restricted}
        onchange={event=>{set('EnableAllFolders',event.currentTarget.checked||undefined);if(event.currentTarget.checked)defaults.folders=[];}} /> All libraries</label>
      {#if libraries.busy}<p role="status">Loading libraries…</p>{/if}
      {#if libraries.error}<p role="status">{libraries.error}</p>{/if}
      {#each libraries.data as library (library.ItemId)}
        <label class="row"><input type="checkbox" bind:group={defaults.folders} disabled={defaults.jellyfin.EnableAllFolders&&!restricted} value={library.ItemId} /> {library.Name??library.ItemId}</label>
      {/each}
    </fieldset>
    {#if defaults.account==='managed'}
      <label class="row"><input type="checkbox" bind:checked={defaults.access.libraryOnly} onchange={()=>{if(defaults.access.libraryOnly)set('EnableAllFolders',undefined);}} /> Library-only access in Coast</label>
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
            <label class="field">Day<select bind:value={window.DayOfWeek}>{#each scheduleDays as day}<option value={day}>{day}</option>{/each}</select></label>
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
      <label class="field">SyncPlay access<select value={defaults.jellyfin.SyncPlayAccess??''} onchange={event=>set('SyncPlayAccess',(event.currentTarget.value||undefined) as JellyfinSettings['SyncPlayAccess'])}>
        <option value="">Use default</option><option value={syncPlayOptions[0]}>Disabled</option><option value={syncPlayOptions[1]}>Join groups</option><option value={syncPlayOptions[2]}>Create and join groups</option>
      </select></label>
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
        <label class="field">{label}<select value={String(configuration[key]??'')} onchange={event=>setConfiguration(key,checkboxValue(event.currentTarget.value))}>
          <option value="">Use default</option><option value="true">On</option><option value="false">Off</option>
        </select></label>
      {/each}
      {#each configurationText as [key,label] (key)}
        <label class="field">{label}<input maxlength="200" value={configuration[key]??''}
          onchange={event=>setConfiguration(key,event.currentTarget.value.trim()||null)} /></label>
      {/each}
      <label class="field">Subtitle mode<select value={configuration.SubtitleMode??''}
        onchange={event=>setConfiguration('SubtitleMode',(event.currentTarget.value||undefined) as JellyfinConfiguration['SubtitleMode'])}>
        <option value="">Use default</option>{#each subtitleModes as mode}<option value={mode}>{mode==='OnlyForced'?'Only forced':mode}</option>{/each}
      </select></label>
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
  <label class="field">Coast playback sharing<select disabled={restricted} value={defaults.access.sharing===false?'block':defaults.sharingGrant?'grant':''}
    onchange={event=>{
      const choice=event.currentTarget.value;
      if(choice==='block')defaults.access.sharing=false;
      else delete defaults.access.sharing;
      if(choice==='grant')defaults.sharingGrant=true;
      else delete defaults.sharingGrant;
    }}>
    <option value="">Use account permission</option><option value="grant">Grant sharing</option><option value="block">Block sharing</option>
  </select></label>
  {#each capabilities as [key,label] (key)}
    <label class="row"><input type="checkbox" checked={defaults.access[key]===false} disabled={restricted && key!=='social'}
      onchange={event=>{if(event.currentTarget.checked)defaults.access[key]=false;else delete defaults.access[key];}} /> Block {label.toLowerCase()}</label>
  {/each}
</fieldset>
{#if !accessOnly}<fieldset class="stack">
  <legend>Starting preferences</legend>
  <label class="field">Theme<select value={defaults.preferences.theme??''} onchange={event=>defaults.preferences.theme=(event.currentTarget.value||undefined) as InviteDefaults['preferences']['theme']}>
    <option value="">Use Coast default</option><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
  </select></label>
  <label class="row"><input type="checkbox" bind:checked={defaults.preferences.originalTitles} /> Prefer original titles</label>
  <label class="field">Notifications<select value={defaults.preferences.notificationLevel??''} onchange={event=>defaults.preferences.notificationLevel=(event.currentTarget.value||undefined) as InviteDefaults['preferences']['notificationLevel']}>
    <option value="">Use Coast default</option><option value="normal">Normal</option><option value="persistent">Persistent</option>
  </select></label>
  <label class="field">Profile audience<select value={defaults.preferences.social?.audience??''} onchange={event=>{
    const audience=event.currentTarget.value as typeof audiences[number];
    defaults.preferences.social=audience?{audience}:undefined;
  }}><option value="">Use Coast default</option>{#each audiences as audience}<option value={audience}>{audience[0].toUpperCase()+audience.slice(1)}</option>{/each}</select></label>
  <label class="field">Preferred subtitle languages (comma-separated)<input value={defaults.preferences.subtitleLanguages?.join(', ')??''}
    onchange={event=>defaults.preferences.subtitleLanguages=list(event.currentTarget.value)} /></label>
  <label class="row"><input type="checkbox" bind:checked={defaults.preferences.subtitlesAlways} /> Always show subtitles</label>
  <label class="row"><input type="checkbox" bind:checked={defaults.preferences.subtitlePrompt} /> Prompt for subtitles when available</label>
</fieldset>
<label class="field">Membership length (days)<input type="number" min="1" max="3650" placeholder="No expiry"
  value={defaults.membershipDays??''} oninput={event=>defaults.membershipDays=event.currentTarget.value?event.currentTarget.valueAsNumber:emptyInviteDefaults.membershipDays} /></label>{/if}


{#snippet policyToggle(key: keyof typeof jellyfinPlaybackFlags | keyof typeof jellyfinPermissionFlags | 'EnableAllDevices' | 'EnableAllChannels' | 'EnableContentDeletion',label:string)}
  <label class="field">{label}<select value={String(defaults.jellyfin[key]??'')} onchange={event=>set(key,checkboxValue(event.currentTarget.value))}>
    <option value="">Use default</option><option value="true">On</option><option value="false">Off</option>
  </select></label>
{/snippet}
