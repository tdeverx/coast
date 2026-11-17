<script lang="ts">
  import type { Snippet } from 'svelte';
  import Field from '#lib/ui/components/Field.svelte';
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

{@render layout({ title: example.label, canvas, inspector, browser })}

{#snippet canvas()}
  <div class="menu-example">
    <p class="small" data-approval={example.approval}>{example.approval === 'approved' ? 'Approved' : 'Unapproved'}</p>
    {#key fixtureKey}
      <MenuPreviewScope conditions={values} inline={current.inline} wrappers={current.wrappers}>
        {#if 'filters' in example}
          <MenuFilterExample filters={example.filters} medium={example.medium} {values} context={effectiveContext} />
        {:else}
          <PreviewExample name={example.component} scenarioValue={example.scenario} initialOpen />
        {/if}
      </MenuPreviewScope>
    {/key}
  </div>
{/snippet}

{#snippet inspector()}
  {#if 'filters' in example && example.filters==='rows'}
    <Field label="Row context"><select value={effectiveContext} onchange={event=>rowContext=event.currentTarget.value}>
      {#each rowContexts as context}
        <option value={context}>{context.replace('-', ' ').replace(/^./,letter=>letter.toUpperCase())}</option>
      {/each}
    </select></Field>
  {/if}
  {#if current.examples.length > 1}
    <Field label={`${current.label} example`}>
      <select value={example.value} onchange={event => select(current.value, event.currentTarget.value)}>
        {#each current.examples as option (option.value)}
          <option value={option.value}>{option.label} · {option.approval === 'approved' ? 'Approved' : 'Unapproved'}</option>
        {/each}
      </select>
    </Field>
  {/if}
  {#if controls.length}
    <fieldset class="condition-options">
      <legend>Conditions</legend>
      {#each controls as control (control.id)}
        <label class="check"><input type="checkbox" checked={values[control.id]}
          onchange={event => { overrides[scope] = { ...overrides[scope], [control.id]: event.currentTarget.checked }; }} />
          {control.label}</label>
      {/each}
    </fieldset>
  {/if}
{/snippet}

{#snippet browser({ heading }: { heading: Snippet })}
  <Browser title="Browse menus" {heading} options={menuEntries} value={current.value} showApproval={false}
    change={value => select(value, null)} />
{/snippet}

<style>
  .menu-example { display: grid; justify-items: center; gap: var(--preview-control-gap); }
  .condition-options { display: grid; gap: 4px; border: 0; padding: 0; margin: 16px 0 0; }
  .condition-options legend { font-weight: var(--weight-semibold); margin-bottom: 4px; }
  .menu-example p { margin: 0; }
  .menu-example [data-approval=approved] { color: var(--success); }
  .menu-example [data-approval=unapproved] { color: var(--rating); }
</style>
