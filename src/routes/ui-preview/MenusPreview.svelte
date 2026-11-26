<script lang="ts">
  import usage from './usage.json';
  const sharedMenus: Record<string,string> = {media:'WorkMenu',filter:'RowFilter',party:'PartyMenu',subtitles:'SubtitleMenu','profile-background':'ProfileBackgroundMenu','row-appearance':'RowStyleMenu'};
  const mounts: Record<string,number> = usage.mounts;
  const contextualMenus: Record<string,number> = usage.menus;
  import type { Snippet } from 'svelte';
  import PreviewSelect from '#lib/ui/cards/editor/PreviewSelect.svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import PreviewToggle from '#lib/ui/cards/editor/PreviewToggle.svelte';
  import Browser from './Browser.svelte';
  import PreviewExample from './PreviewExample.svelte';
  import MenuPreviewScope from './MenuPreviewScope.svelte';
  import type { MenuConditions } from '#lib/ui/controls/menu-preview.js';
  import MenuFilterExample from './MenuFilterExample.svelte';
  import { menuConditions, menuEntries } from './menu-examples';
  import type { WorkspaceParts } from './workspace';

  let { menu, variant, select, layout }: {
    menu: string | null;
    variant: string | null;
    select: (menu: string, variant: string | null) => void;
    layout: Snippet<[WorkspaceParts]>;
  } = $props();
  const current = $derived(menuEntries.find(entry => entry.value === menu) ?? menuEntries[0]);
  const example = $derived(current.examples.find(entry => entry.value === variant) ?? current.examples[0]);
  const controls = $derived(menuConditions(current, example));
  let rowContext=$state('general');
  const rowContexts=$derived(['general','recommendations','progress','activity','title-activity','statistics',...('filters' in example&&example.medium==='watch'?['episodes','seasons','requests','credits','community']:[])]);
  const effectiveContext=$derived(rowContexts.includes(rowContext)?rowContext:'general');
  let overrides = $state<Record<string, MenuConditions>>({});
  const scope = $derived(`${current.value}:${example.value}`);
  const values = $derived(Object.fromEntries(controls.map(control => [
    control.id, overrides[scope]?.[control.id] ?? control.initial,
  ])) as MenuConditions);
  const fixtureKey = $derived(`${scope}:${JSON.stringify(values)}`);
</script>

{@render layout({ title: example.label, specimenKey:scope, canvas, inspector, browser })}

{#snippet canvas()}
  <div class="menu-example">
    <p class="small" data-approval={example.approval}>{example.approval === 'approved' ? 'Approved' : 'Unapproved'}</p>
    {#key fixtureKey}
      <MenuPreviewScope conditions={values} inline={current.inline} wrappers={current.wrappers}>
        {#if 'filters' in example}
          <MenuFilterExample filters={example.filters} medium={example.medium} {values} context={effectiveContext} />
        {:else}
          <PreviewExample name={example.component} scenario={example.scenario} initialOpen />
        {/if}
      </MenuPreviewScope>
    {/key}
  </div>
{/snippet}

{#snippet inspector()}
  {#if 'filters' in example && example.filters==='rows'}
    <PreviewSelect topLayer label="Row context" value={effectiveContext}
      options={rowContexts.map(id => ({id, label:id.replace('-', ' ').replace(/^./,letter=>letter.toUpperCase())}))}
      onchange={value => rowContext = value} />
  {/if}
  {#if current.examples.length > 1}
    <PreviewSelect topLayer label={`${current.label} example`} value={example.value}
      options={current.examples.map(option => ({id:option.value,label:option.label,detail:option.approval === 'approved' ? 'Approved' : 'Unapproved'}))}
      onchange={value => select(current.value,value)} />
  {/if}
  {#if controls.length}
    <fieldset class="condition-options">
      <legend>Conditions</legend>
      <AuthSurface>
        {#each controls as control (control.id)}
          <PreviewToggle label={control.label} icon="sliders" checked={values[control.id] === true}
            onchange={checked => { overrides[scope] = { ...overrides[scope], [control.id]: checked }; }} />
        {/each}
      </AuthSurface>
    </fieldset>
  {/if}
{/snippet}

{#snippet browser({ heading }: { heading: Snippet })}
  <Browser title="Browse menus" {heading} options={menuEntries.map(item => ({...item,uses:contextualMenus[item.value] ?? mounts['src/lib/ui/components/'+sharedMenus[item.value]+'.svelte'] ?? 0}))} value={current.value}
    change={value => select(value, null)} />
{/snippet}

<style>
  .menu-example { position: relative; display: grid; justify-items: center; gap: var(--preview-control-gap); }
  .condition-options { display: grid; gap: 4px; border: 0; padding: 0; margin: 16px 0 0; }
  .condition-options legend { font-weight: var(--weight-semibold); margin-bottom: 4px; }
  .menu-example p { margin: 0; }
  .menu-example [data-approval=approved] { color: var(--success); }
  .menu-example [data-approval=unapproved] { color: var(--rating); }
</style>
