<script lang="ts">
  import { untrack } from 'svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import AccountIdentity from '#lib/auth/ui/AccountIdentity.svelte';
  import SegmentPanels from '#lib/auth/ui/SegmentPanels.svelte';
  import SegmentedControl from '#lib/ui/components/SegmentedControl.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import GlassSeparator from '#lib/auth/ui/GlassSeparator.svelte';
  import ServiceHeader from '#lib/auth/ui/ServiceHeader.svelte';
  import ServiceDisclosure from '#lib/auth/ui/ServiceDisclosure.svelte';
  import ProfileFields from '#lib/auth/ui/ProfileFields.svelte';
  import JellyfinFields from '#lib/auth/ui/JellyfinFields.svelte';
  import ImportRow from '#lib/auth/ui/ImportRow.svelte';
  import PairingCode from '#lib/providers/trakt/PairingCode.svelte';
  import AccessFields from '#lib/providers/trakt/AccessFields.svelte';
  import { initialTraktSync } from '#lib/providers/trakt/access.js';
  import PreviewSelect from '#lib/ui/cards/editor/PreviewSelect.svelte';
  import PreviewDisclosure from '#lib/ui/cards/editor/PreviewDisclosure.svelte';
  import PreviewToggle from '#lib/ui/cards/editor/PreviewToggle.svelte';
  import PreviewValueInput from '#lib/ui/cards/editor/PreviewValueInput.svelte';
  import SettingsCarousel from '#lib/ui/cards/editor/SettingsCarousel.svelte';
  import SettingsPanels from '#lib/ui/cards/editor/SettingsPanels.svelte';
  import { cardLayoutKey, type CardLayouts } from '#lib/ui/cards/layout.js';
  import { useClient } from '#lib/ui/client-context.js';
  let { name, scenario, options = {}, onoption }: { name:string; scenario:string; options?:Record<string,unknown>; onoption?:(key:string,value:unknown)=>void } = $props();
  const client = useClient();
  const fields = [{id:'title', label:'Title', icon:'list'}, {id:'runtime', label:'Runtime', icon:'clock'}] as const;
  const sections = [{value:'sample',label:'Sample'}, {value:'badges',label:'Badges'}, {value:'metadata',label:'Metadata'}];
  let selected = $state<string>('title'), text = $state('Title'), checked = $state(true);
  let section = $state('sample'), direction = $state<-1|1>(1);
  const currentSection = $derived(String(options.section??section));
  function changeSection(value:string,step:-1|1) {
    section=value;
    direction=step;
    onoption?.('section',value);
  }
  function changeChecked(value:boolean) {
    checked=value;
    onoption?.('checked',value);
  }
  let open = $state(true), sync = $state(initialTraktSync());
  let layouts:CardLayouts = {};
  const disclosureId = $props.id();
  const editor = untrack(() => name === 'editor.personalise' ? import('#lib/ui/cards/editor/CardLayoutEditor.svelte') : undefined);
</script>
{#if name === 'editor.personalise'}
  {#if editor}{#await editor then module}
    <div class="editor-preview"><module.default inOverlay={options.inOverlay!==false} initialLayouts={layouts} transport={client.fetch} save={async (target, layout) => {
      const key = cardLayoutKey(target);
      if (layout) layouts[key] = layout;
      else delete layouts[key];
      return {...layouts};
    }} /></div>
  {/await}{/if}
{:else}
  <div class="production-example">
    {#if name === 'account.surface'}
      {#if scenario==='anchor'}<AuthSurface anchor><Button size="segment" icon="arrow" label="Continue"/></AuthSurface>
      {:else}
        <AuthSurface invite={scenario==='invite'} expanded={scenario==='expandable'?open:undefined}>
          {#if scenario==='expandable'}<button class="menu-row" onclick={()=>open=!open} aria-expanded={open}>Profile</button>
          {:else}<div class="menu-row"><AccountIdentity name="Alex" detail={options.detail===false?undefined:scenario==='invite'?'Invited you':'Administrator'}/></div>{/if}
        </AuthSurface>
      {/if}
    {:else if name === 'account.identity'}
      <AuthSurface><div class="menu-row"><AccountIdentity name="Alex" detail={options.detail===false?undefined:'Administrator'} avatar={scenario==='artwork'?'/coast-mark.png':null} status={scenario==='status'?'online':undefined}/></div></AuthSurface>
    {:else if name === 'onboarding.panels'}
      <SegmentedControl label="Onboarding sections" value={section} options={sections} onchange={value=>section=value}/>
      <SegmentPanels index={sections.findIndex(option=>option.value===section)} vertical={scenario==='vertical'}>
        {#snippet children(index)}<AuthSurface><div class="menu-row">{sections[index].label}</div></AuthSurface>{/snippet}
      </SegmentPanels>
    {:else if name === 'editor.picker'}
      <PreviewSelect label="Metadata field" options={options.icons===false?fields.map(({id,label})=>({id,label})):fields} bind:value={selected} disabled={scenario==='disabled'}
        presentation={scenario==='centered'?'centered':'pinned'} topLayer
        valueEditor={scenario==='inline-value'?{value:text,placeholder:'Title',defaultValue:'Title',update:value=>text=value}:undefined} />
    {:else if name === 'editor.disclosure'}
      <PreviewDisclosure label="Artwork" icon="image" note={options.note===false?undefined:'Options'}><AuthSurface><PreviewToggle label="Dim artwork" icon="image" {checked} onchange={value=>checked=value}/></AuthSurface></PreviewDisclosure>
    {:else if name === 'editor.separator'}
      <GlassSeparator/>
    {:else if name === 'editor.toggle'}
      <AuthSurface><PreviewToggle label="Show artwork" icon="image" checked={Boolean(options.checked??checked)} onchange={changeChecked} onreset={(options.checked??checked)?undefined:()=>changeChecked(true)}/></AuthSurface>
    {:else if name === 'editor.value'}
      <AuthSurface><PreviewValueInput label="Title" value={text} defaultValue="Title" placeholder="Title" update={value=>text=value} resettable/></AuthSurface>
    {:else if name === 'editor.carousel'}
      <SettingsPanels section={currentSection} {direction}>{#snippet children(value)}<p>{sections.find(item=>item.value===value)?.label}</p>{/snippet}</SettingsPanels>
      <SettingsCarousel options={sections} value={currentSection} onchange={changeSection}/>
    {:else if name === 'onboarding.services'}
      {#if scenario==='profile-fields'}<AuthSurface><ProfileFields displayName="Alex"/></AuthSurface>
      {:else if scenario==='trakt-pairing'}
        <ServiceHeader provider="trakt" note="" activateLabel="Waiting for approval">{#snippet trailing()}<PairingCode code="COAST123"/>{/snippet}</ServiceHeader>
      {:else}
        <ServiceHeader provider={scenario==='jellyfin'?'jellyfin':'trakt'} note={scenario==='jellyfin'?'Optional':'Connected'} controls={disclosureId} expanded={open} onactivate={()=>open=!open}/>
        <ServiceDisclosure id={disclosureId} expanded={open}>
          {#if scenario==='jellyfin'}<AuthSurface><JellyfinFields mode="credentials"/></AuthSurface>
          {:else}<AccessFields bind:sync>{#snippet group(rows)}<AuthSurface>{@render rows()}</AuthSurface>{/snippet}</AccessFields>{/if}
        </ServiceDisclosure>
      {/if}
    {:else if name === 'onboarding.import'}
      <AuthSurface><ImportRow provider="jellyfin" label="Library import" processed={24} total={60}
        state={scenario==='queued'?'pending':scenario==='completed'?'succeeded':'running'}/></AuthSurface>
    {/if}
  </div>
{/if}
<style>
  .production-example {width:min(100%,var(--auth-width));display:grid;gap:var(--auth-gap);}
  .editor-preview {width:100%;height:min(68dvh,680px);position:relative;contain:layout paint;overflow:auto;}
</style>
