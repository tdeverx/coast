<script module lang="ts">
  import Button from './Button.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  type Requirement = { label: string; icon?: IconName; met: boolean | undefined; detail?: string };
  export type FieldValidation = { state: 'info' | 'pending' | 'valid' | 'verified' | 'invalid'; message: string };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, hint, children, validation, requirements, hideLabel = false, class: className = 'field' }: {
    label: string; hint?: string; children: Snippet; validation?: FieldValidation | null; hideLabel?: boolean; class?: string;
    requirements?: Requirement[];
  } = $props();
</script>

{#snippet fieldInfo(label: string, validation: FieldValidation, requirements?: Requirement[])}
  {@const success = validation.state === 'valid' || validation.state === 'verified'}
  <div class="field-status-control menu-row-indicator" class:invalid={validation.state === 'invalid'} class:success>
    <Button menu align="end" icon={success ? 'checkCircle' : 'info'} iconSize={16} label={label} title={validation.message} triggerClass="icon-button field-info">
      {#if requirements?.length}
        {#each requirements as rule (rule.label)}
          <Button item keepOpen icon={rule.icon}>
            <span class="requirement">
              <span class="menu-row-copy">
                <span>{rule.label}<span class="sr-only"> {rule.met === undefined ? 'not checked' : rule.met ? 'met' : 'not met'}</span></span>
                {#if rule.detail}<small>{rule.detail}</small>{/if}
              </span>
              <span class="requirement-check" class:met={rule.met} class:unmet={rule.met === false}><Icon name={rule.met === undefined ? 'info' : rule.met ? 'checkCircle' : 'closeCircle'} size={16} /></span>
            </span>
          </Button>
        {/each}
      {:else}
        <Button item text={validation.message} />
      {/if}
    </Button>
  </div>
{/snippet}

{#snippet field()}
  <label class={className} data-field>{#if hideLabel}<span class="sr-only">{label}</span>{:else}{label}{/if}{#if hint} <small>{hint}</small>{/if}{@render children()}</label>
{/snippet}

{#if validation !== undefined}
  <div class="field-status" class:has-status={!!validation}>
    {@render field()}
    {#if validation}
      {@render fieldInfo(`${label} validation`, validation, requirements)}
    {/if}
  </div>
{:else}
  {@render field()}
{/if}

<style>
  .requirement { display: flex; align-items: center; justify-content: space-between; gap: var(--menu-item-inset); }
  .requirement small { white-space:pre-line; }
  .requirement-check { display: grid; place-items: center; flex: 0 0 var(--icon-inline); color: var(--muted); }
  .requirement-check.unmet { color: var(--danger); }
  .requirement-check.met { color: var(--field-success, var(--success)); }
  .field-status { position: relative; }
  .field-status.has-status > :global(label.menu-row > :is(input, textarea)) {
    padding-inline-end: calc(var(--control-height) + var(--menu-item-inset));
  }
  .field-status-control {
    position: absolute;
    inset-block: 0;
    inset-inline-end: var(--menu-inset);
  }
  .field-status-control:is(.success, .invalid) { --field-info-opacity: 1; }
  .field-status-control.success { --field-info-color: var(--field-success, var(--success)); }
  .field-status-control.invalid { --field-info-color: var(--danger); }
</style>
