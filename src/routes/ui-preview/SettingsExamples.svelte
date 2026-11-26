<script lang="ts">
  import Button from '#lib/ui/components/Button.svelte';
  import Sidebar from '#lib/settings/SettingsSidebar.svelte';
  import Overview from '#lib/settings/SettingsOverview.svelte';
  import Invites from '#lib/auth/ui/AdminInviteSettings.svelte';
  import InlineInvites from '#lib/settings/redesign/AdminInviteSettings.svelte';
  import Member from '#lib/auth/ui/AccountAccessControls.svelte';
  import InlineMember from '#lib/settings/redesign/AccountAccessControls.svelte';
  import MemberInvites from '#lib/auth/ui/MemberInvites.svelte';
  import Permissions from '#lib/settings/MemberFeaturePermissions.svelte';
  import Demand from '#lib/settings/AdminDemand.svelte';
  import Connection from '#lib/settings/redesign/ConnectionCard.svelte';
  import Integration from '#lib/settings/redesign/IntegrationSettings.svelte';
  import Automation from '#lib/settings/redesign/ProviderAutomation.svelte';
  import Projection from '#lib/settings/redesign/CollectionProjectionSettings.svelte';
  import {id, provider} from './demo/fixtures';
  let {name,scenario}: {name:string;scenario:string} = $props();
  let open = $state(false);
  const sources = [{id,name:'Home'}];
  const config = {experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true,experimentalParties:true,experimentalPlanning:true,allowPlaybackSharing:false,enableRequests:true};
</script>
<div class="settings-example">
  {#if name === 'settings.sidebar'}
    <Button onclick={()=>open=true}>Open settings</Button>
    <Sidebar {open} onclose={()=>open=false}><Overview requestedArea={scenario} requestedGroup={null} identity={{name:'Alex'}}
      appearanceNote="Dark" privacyNote="Friends" admin libraryOnly={false} busy={false} dirty={false} onclose={()=>open=false}>{#snippet children()}{/snippet}</Overview></Sidebar>
  {:else if name === 'admin.invites'}
    {#if scenario.startsWith('sidebar')}<InlineInvites inline view={scenario.endsWith('defaults')?'defaults':'invites'} connections={sources}/>
    {:else}<Invites view={scenario==='defaults'?'defaults':'invites'} connections={sources}/>{/if}
  {:else if name === 'admin.member'}
    {#if scenario.startsWith('sidebar')}<InlineMember inline userId={scenario.endsWith('account')?id:undefined} selection={[id]} onclose={()=>{}} onchange={()=>{}}/>
    {:else}<Button onclick={()=>open=true}>Open member access</Button>
      {#if open}<Member userId={scenario==='account'?id:undefined} selection={[id]} onclose={()=>open=false} onchange={()=>{}}/>{/if}
    {/if}
  {:else if name === 'admin.permissions'}
    <Permissions account={{id,username:'Alex',role:'user',settings:{}}} {config} classic={scenario==='classic'}/>
  {:else if name === 'admin.demand'}<Demand query=""/>
  {:else if name === 'account.invites'}<MemberInvites/>
  {:else if name === 'settings.connection'}<Connection provider={{...provider,configured:true,connection:{id,username:'Alex',status:'connected',settings:{}}}}/>
  {:else if name === 'settings.projection'}<Projection connectionId={id} settings={{}} {sources}/>
  {:else if name === 'settings.integration'}<Integration providers={[provider]} inline/>
  {:else if name === 'settings.automation'}<Automation instance={provider}/>
  {/if}
</div>
<style>.settings-example {width:min(100%,48rem);}</style>
