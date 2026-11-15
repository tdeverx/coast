<script lang="ts">
  import { emptyInviteDefaults, scheduleDays, type InviteDefaults, type JellyfinSettings } from '#lib/auth/invites.js';
  import { api } from '#lib/ui/client.js';
  import { actionFeedback } from '#lib/ui/action-feedback.svelte.js';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import { onDestroy } from 'svelte';
  import Button from '#lib/ui/components/Button.svelte';

  let {defaults=$bindable(), connections=[]}: {defaults:InviteDefaults;connections:{id:string;name:string}[]}=$props();
  const libraries=createResource<{ItemId:string;Name?:string}[]>([]);
  let sourceId=$state('');
  const sourcePreview=createResource<{jellyfin:JellyfinSettings;folders:string[]}|null>(null);
  const flags=[
    ['EnableMediaPlayback','Playback'], ['EnableRemoteAccess','Remote access'], ['EnableContentDownloading','Downloads'],
    ['EnableAudioPlaybackTranscoding','Audio transcoding'], ['EnableVideoPlaybackTranscoding','Video transcoding'], ['EnablePlaybackRemuxing','Remuxing'],
  ] as const;
  const capabilities=[['requests','Requests'],['sharing','Playback sharing'],['social','Social features']] as const;
  const unrated=['Movie','Trailer','Series','Music','Book','LiveTvChannel','LiveTvProgram','ChannelContent','Other'] as const;
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
  }
  async function preview() {
    const connection=defaults.connectionId;
    if(!connection||sourcePreview.busy)return;
    const result=await sourcePreview.load(signal=>api('admin/invites/preset-preview?'+new URLSearchParams({connectionId:connection,sourceId}),undefined,'GET',{signal}));
    if(result&&defaults.connectionId===connection){
      defaults.jellyfin=result.jellyfin;defaults.folders=result.folders;
    }else if(sourcePreview.error)actionFeedback.failure(sourcePreview.error);
  }
</script>

<label class="field">Account type
  <select bind:value={defaults.account} onchange={()=>{if(defaults.account!=='managed')delete defaults.access.libraryOnly;}}>
    <option value="coast">Coast account</option><option value="managed">Create a managed Jellyfin account</option><option value="choice">Create or connect a Jellyfin account</option>
  </select>
</label>
{#if defaults.account!=='coast'}
  <label class="field">Jellyfin administrator
    <select value={defaults.connectionId??''} onchange={event=>{defaults.connectionId=event.currentTarget.value||undefined;defaults.folders=[];}}>
      <option value="">Choose an account</option>
      {#each connections as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
    </select>
  </label>
  {#if defaults.connectionId}
    <fieldset class="stack">
      <legend>Jellyfin libraries</legend>
      {#if libraries.busy}<p role="status">Loading libraries…</p>{/if}
      {#if libraries.error}<p role="status">{libraries.error}</p>{/if}
      {#each libraries.data as library (library.ItemId)}
        <label class="row"><input type="checkbox" bind:group={defaults.folders} value={library.ItemId} /> {library.Name??library.ItemId}</label>
      {/each}
    </fieldset>
    {#if defaults.account==='managed'}
      <label class="row"><input type="checkbox" bind:checked={defaults.access.libraryOnly} /> Library-only access in Coast</label>
    {/if}
    <details class="stack">
      <summary>Jellyfin playback and family access</summary>
      {#each flags as [key,label] (key)}
        <label class="field">{label}<select value={defaults.jellyfin[key]===undefined?'default':String(defaults.jellyfin[key])}
          onchange={event=>set(key,event.currentTarget.value==='default'?undefined:event.currentTarget.value==='true')}>
          <option value="default">Use default</option><option value="true">Allow</option><option value="false">Block</option>
        </select></label>
      {/each}
      <label class="field">Remote bitrate limit (Mbps)<input type="number" min="0" max="1000" step="0.1" placeholder="Use default"
        value={defaults.jellyfin.RemoteClientBitrateLimit===undefined?'':defaults.jellyfin.RemoteClientBitrateLimit/1000000}
        oninput={event=>set('RemoteClientBitrateLimit',event.currentTarget.value?Math.round(event.currentTarget.valueAsNumber*1000000):undefined)} /></label>
      <label class="field">Maximum parental rating score<input type="number" min="0" max="1000" value={defaults.jellyfin.MaxParentalRating??''}
        oninput={event=>set('MaxParentalRating',event.currentTarget.value?event.currentTarget.valueAsNumber:null)} /></label>
      <label class="field">Allowed tags (comma-separated)<input value={defaults.jellyfin.AllowedTags?.join(', ')??''}
        onchange={event=>set('AllowedTags',event.currentTarget.value.split(',').map(tag=>tag.trim()).filter(Boolean))} /></label>
      <label class="field">Blocked tags (comma-separated)<input value={defaults.jellyfin.BlockedTags?.join(', ')??''}
        onchange={event=>set('BlockedTags',event.currentTarget.value.split(',').map(tag=>tag.trim()).filter(Boolean))} /></label>
      <fieldset class="stack"><legend>Block unrated items</legend>
        {#each unrated as kind (kind)}
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
    <div class="row">
      <label class="field">Copy settings from a Jellyfin user ID<input bind:value={sourceId} maxlength="36" /></label>
      <Button emphasis="subtle" onclick={preview} disabled={!sourceId||sourcePreview.busy}>Load preview</Button>
    </div>
  {/if}
{/if}
<fieldset class="stack">
  <legend>Coast permissions</legend>
  {#each capabilities as [key,label] (key)}
    <label class="row"><input type="checkbox" checked={defaults.access[key]===false} disabled={defaults.access.libraryOnly && key!=='social'}
      onchange={event=>{if(event.currentTarget.checked)defaults.access[key]=false;else delete defaults.access[key];}} /> Block {label.toLowerCase()}</label>
  {/each}
</fieldset>
<fieldset class="stack">
  <legend>Starting preferences</legend>
  <label class="field">Theme<select value={defaults.preferences.theme??''} onchange={event=>defaults.preferences.theme=(event.currentTarget.value||undefined) as InviteDefaults['preferences']['theme']}>
    <option value="">Use Coast default</option><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
  </select></label>
  <label class="row"><input type="checkbox" bind:checked={defaults.preferences.originalTitles} /> Prefer original titles</label>
  <label class="field">Notifications<select value={defaults.preferences.notificationLevel??''} onchange={event=>defaults.preferences.notificationLevel=(event.currentTarget.value||undefined) as InviteDefaults['preferences']['notificationLevel']}>
    <option value="">Use Coast default</option><option value="normal">Normal</option><option value="silent">Silent</option><option value="persistent">Persistent</option>
  </select></label>
</fieldset>
<label class="field">Membership length (days)<input type="number" min="1" max="3650" placeholder="No expiry"
  value={defaults.membershipDays??''} oninput={event=>defaults.membershipDays=event.currentTarget.value?event.currentTarget.valueAsNumber:emptyInviteDefaults.membershipDays} /></label>
